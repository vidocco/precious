import {
  type Bindings,
  type ComputedField,
  coerceToField,
  EMPTY_BINDINGS,
  type FieldDefinition,
  type FieldMeta,
  formatAccession,
  nextRun,
  scheduleKey,
} from '@precious/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { evaluate } from '../connectors/map.ts';
import { type ConnectorRuntime, runEndpoint } from '../connectors/runner.ts';
import type { Db } from '../db/client.ts';
import { collections, computedState, computedValues, items, templates } from '../db/schema.ts';
import { buildSearchText } from './items.ts';
import { loadBound } from './pipeline.ts';
import { endpointData } from './sources.ts';

/**
 * Values kept up to date: fields looked up in a data source on a schedule (a daily
 * price), and fields calculated from the item's other values with a formula.
 */

type SourceComputed = Extract<ComputedField, { kind: 'source' }>;
export interface TemplateLike {
  fields: FieldDefinition[];
  bindings: Bindings;
}

/** Failed lookups are retried after an hour, up to this many times in a row, then wait for the schedule. */
const QUICK_RETRIES = 3;
const RETRY_MS = 3600_000;
/** A claimed run that never finishes (the server stopped) is picked up again after this. */
const CLAIM_MS = 15 * 60_000;

const bindingsOf = (b: Bindings | undefined): Bindings => ({ ...EMPTY_BINDINGS, ...b });
const sourceComputed = (b: Bindings) => b.computed.filter((c): c is SourceComputed => c.kind === 'source');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- formulas

/**
 * Recalculates formula fields from the item's other values, in order (a formula can
 * use one before it). A formula that fails keeps its last value and records why.
 */
export async function applyFormulas(
  t: TemplateLike,
  title: string,
  data: Record<string, unknown>,
  meta: Record<string, FieldMeta>,
  now = new Date(),
): Promise<{ data: Record<string, unknown>; meta: Record<string, FieldMeta>; changed: string[] }> {
  const out = { ...data };
  const outMeta = { ...meta };
  const changed: string[] = [];
  const at = now.toISOString();
  for (const c of bindingsOf(t.bindings).computed) {
    if (c.kind !== 'formula') continue;
    const field = t.fields.find((f) => f.id === c.field);
    if (!field || field.hidden) continue;
    let error: string | undefined;
    let value: unknown;
    try {
      const coerced = coerceToField(field, await evaluate(c.formula, { title, ...out }, field.label));
      if (coerced.ok) value = coerced.value;
      else error = coerced.reason;
    } catch (err) {
      error = (err as Error).message;
    }
    const prev = meta[c.field];
    if (error) {
      outMeta[c.field] = { source: 'Formula', step: 'formula', at: prev?.at ?? at, error, errorAt: at };
      continue;
    }
    if (!same(out[c.field], value)) {
      if (value === undefined) delete out[c.field];
      else out[c.field] = value;
      changed.push(c.field);
    }
    outMeta[c.field] = {
      source: 'Formula',
      step: 'formula',
      at: changed.includes(c.field) || prev?.source !== 'Formula' ? at : (prev.at ?? at),
    };
  }
  return { data: out, meta: outMeta, changed };
}

/** Recalculates formulas for every item of a template (after its formulas change). */
export async function recalculateTemplate(db: Db, templateId: string) {
  const [t] = await db.select().from(templates).where(eq(templates.id, templateId));
  if (!t) return;
  const tpl = { fields: t.fields, bindings: bindingsOf(t.bindings) };
  if (!tpl.bindings.computed.some((c) => c.kind === 'formula')) return;
  const rows = await db
    .select({ item: items, prefix: collections.accessionPrefix })
    .from(items)
    .innerJoin(collections, eq(collections.id, items.collectionId))
    .where(eq(collections.templateId, templateId));
  for (const { item, prefix } of rows) {
    const r = await applyFormulas(tpl, item.title, item.data, item.fieldMeta);
    if (r.changed.length === 0 && same(r.meta, item.fieldMeta)) continue;
    const accession = formatAccession(prefix, item.accessionNo);
    await db
      .update(items)
      .set({
        data: r.data,
        fieldMeta: r.meta,
        searchText: buildSearchText({ title: item.title, accession, data: r.data }, t.fields),
        updatedAt: sql`${items.updatedAt}`,
      })
      .where(eq(items.id, item.id));
  }
}

// ---------------------------------------------------------------- schedule bookkeeping

/**
 * Brings the schedule in line with a template's settings: adds a row for every item
 * and scheduled field, reschedules fields whose schedule changed and drops fields no
 * longer kept up to date. With `itemIds` (new items), only those items are added.
 */
export async function syncComputed(db: Db, templateId: string, opts: { itemIds?: string[]; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const [t] = await db.select({ bindings: templates.bindings }).from(templates).where(eq(templates.id, templateId));
  if (!t) return;
  const list = sourceComputed(bindingsOf(t.bindings));
  const ofTemplate = sql`select ${items.id} from ${items} join ${collections} on ${collections.id} = ${items.collectionId} where ${collections.templateId} = ${templateId}`;
  if (!opts.itemIds) {
    const fields = list.map((c) => c.field);
    await db.delete(computedState).where(
      and(
        sql`${computedState.itemId} in (${ofTemplate})`,
        fields.length
          ? sql`not (${computedState.field} = any(${sql`array[${sql.join(
              fields.map((f) => sql`${f}`),
              sql`, `,
            )}]::text[]`}))`
          : sql`true`,
      ),
    );
  }
  for (const c of list) {
    const key = scheduleKey(c.schedule);
    // New items look their value up right away unless told to wait; so does a newly added field.
    const first = opts.itemIds && !c.runOnCreate ? nextRun(c.schedule, now) : now;
    const only = opts.itemIds?.length
      ? sql` and ${items.id} = any(${sql`array[${sql.join(
          opts.itemIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::uuid[]`})`
      : sql``;
    await db.execute(sql`
      insert into ${computedState} (item_id, field, schedule_key, next_run_at)
      select ${items.id}, ${c.field}, ${key}, ${first.toISOString()}::timestamptz
      from ${items} join ${collections} on ${collections.id} = ${items.collectionId}
      where ${collections.templateId} = ${templateId}${only}
      on conflict do nothing`);
    await db
      .update(computedState)
      .set({ scheduleKey: key, nextRunAt: nextRun(c.schedule, now) })
      .where(
        and(
          eq(computedState.field, c.field),
          sql`${computedState.scheduleKey} <> ${key}`,
          sql`${computedState.itemId} in (${ofTemplate})`,
        ),
      );
  }
}

/** Every template with scheduled fields, synced (at startup). */
export async function syncAllComputed(db: Db) {
  const all = await db.select({ id: templates.id }).from(templates);
  for (const t of all) await syncComputed(db, t.id);
}

// ---------------------------------------------------------------- running

export interface ComputeEnv {
  db: Db;
  rt: ConnectorRuntime;
}

export interface ComputeOutcome {
  updated: string[];
  failed: { field: string; message: string }[];
  skipped: string[];
}

/**
 * Looks up the given scheduled fields of one item now: writes the values that came back
 * (and their history), keeps the last good value where a lookup failed, recalculates
 * formulas and schedules the next run. Fields edited by hand (locked) are left alone.
 */
export async function updateValues(
  env: ComputeEnv,
  itemId: string,
  fields: string[] | 'all',
  now = new Date(),
): Promise<ComputeOutcome> {
  const { db, rt } = env;
  const outcome: ComputeOutcome = { updated: [], failed: [], skipped: [] };
  const [row] = await db
    .select({ item: items, prefix: collections.accessionPrefix, template: templates })
    .from(items)
    .innerJoin(collections, eq(collections.id, items.collectionId))
    .innerJoin(templates, eq(templates.id, collections.templateId))
    .where(eq(items.id, itemId));
  if (!row) return outcome;
  const tpl = { fields: row.template.fields, bindings: bindingsOf(row.template.bindings) };
  const configs = sourceComputed(tpl.bindings).filter((c) => fields === 'all' || fields.includes(c.field));
  if (configs.length === 0) return outcome;
  const bound = await loadBound(db, { ...EMPTY_BINDINGS, computed: configs });
  const item = row.item;
  let data = { ...item.data };
  let meta = { ...item.fieldMeta };
  const at = now.toISOString();
  const history: { field: string; value: unknown }[] = [];
  const states: (typeof computedState.$inferInsert)[] = [];
  const prevStates = await db.select().from(computedState).where(eq(computedState.itemId, itemId));

  for (const c of configs) {
    const field = tpl.fields.find((f) => f.id === c.field);
    const prev = prevStates.find((s) => s.field === c.field);
    const base = { itemId, field: c.field, scheduleKey: scheduleKey(c.schedule) };
    const scheduled = nextRun(c.schedule, now);
    if (!field || field.hidden || meta[c.field]?.locked) {
      outcome.skipped.push(c.field);
      states.push({ ...base, nextRunAt: scheduled, lastRunAt: prev?.lastRunAt ?? null, failures: 0 });
      continue;
    }
    const b = bound.get(c.endpointId);
    let error: string | undefined;
    let value: unknown;
    if (b?.endpoint.role !== 'compute') {
      error = 'Its data source endpoint no longer exists';
    } else {
      const s = b.source;
      const res = await runEndpoint(rt, { ...s, userAgent: s.userAgent ?? undefined }, endpointData(b.endpoint), {
        query: item.title,
        refs: item.externalRefs,
        item: { title: item.title, ...data },
      });
      if (!res.ok) error = res.errors[0]?.message ?? 'The lookup failed';
      else {
        const coerced = coerceToField(field, res.output);
        if (!coerced.ok) error = coerced.reason;
        else if (coerced.value === undefined) error = 'The data source has no value for this item';
        else value = coerced.value;
      }
    }
    if (error === undefined) {
      data = { ...data, [c.field]: value };
      meta = { ...meta, [c.field]: { source: b?.source.name ?? 'Data source', step: 'computed', at } };
      history.push({ field: c.field, value });
      outcome.updated.push(c.field);
      states.push({ ...base, nextRunAt: scheduled, lastRunAt: now, failures: 0 });
    } else {
      // The last good value stays; the field shows why it couldn't be updated.
      meta = {
        ...meta,
        [c.field]: {
          ...(meta[c.field] ?? { source: b?.source.name ?? 'Data source', step: 'computed' }),
          error,
          errorAt: at,
        },
      };
      outcome.failed.push({ field: c.field, message: error });
      const failures = (prev?.failures ?? 0) + 1;
      const retry = new Date(now.getTime() + RETRY_MS);
      states.push({
        ...base,
        nextRunAt: failures <= QUICK_RETRIES && retry < scheduled ? retry : scheduled,
        lastRunAt: now,
        failures,
      });
    }
  }

  const formulas = await applyFormulas(tpl, item.title, data, meta, now);
  data = formulas.data;
  meta = formulas.meta;
  const accession = formatAccession(row.prefix, item.accessionNo);
  await db.transaction(async (tx) => {
    await tx
      .update(items)
      .set({
        data,
        fieldMeta: meta,
        searchText: buildSearchText({ title: item.title, accession, data }, tpl.fields),
        // A value updated on schedule isn't an edit, so the item keeps its "updated" time.
        updatedAt: sql`${items.updatedAt}`,
      })
      .where(eq(items.id, itemId));
    if (history.length) {
      await tx.insert(computedValues).values(history.map((h) => ({ itemId, field: h.field, value: h.value, at: now })));
    }
    for (const s of states) {
      await tx
        .insert(computedState)
        .values(s)
        .onConflictDoUpdate({
          target: [computedState.itemId, computedState.field],
          set: { scheduleKey: s.scheduleKey, nextRunAt: s.nextRunAt, lastRunAt: s.lastRunAt, failures: s.failures },
        });
    }
  });
  return outcome;
}

/** Claims the runs that are due and does them, a few items at a time. Returns how many it claimed. */
export async function runDue(env: ComputeEnv, opts: { limit?: number; now?: Date; concurrency?: number } = {}) {
  const { limit = 50, now = new Date(), concurrency = 4 } = opts;
  // Claiming pushes the next run out, so overlapping ticks never run the same field twice.
  const claimed = await env.db.execute<{ item_id: string; field: string }>(sql`
    update ${computedState} s set next_run_at = ${new Date(now.getTime() + CLAIM_MS).toISOString()}::timestamptz
    from (
      select item_id, field from ${computedState}
      where next_run_at <= ${now.toISOString()}::timestamptz
      order by next_run_at limit ${limit}
      for update skip locked
    ) due
    where s.item_id = due.item_id and s.field = due.field
    returning s.item_id, s.field`);
  const byItem = new Map<string, string[]>();
  for (const r of claimed) byItem.set(r.item_id, [...(byItem.get(r.item_id) ?? []), r.field]);
  const queue = [...byItem.entries()];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        await updateValues(env, next[0], next[1], now);
      } catch {
        // Left claimed: it's tried again once the claim runs out.
      }
    }
  });
  await Promise.all(workers);
  return claimed.length;
}

/** Runs due lookups every minute, and straight away when poked (an item was added, "run now"). */
export class Scheduler {
  readonly env: ComputeEnv;
  readonly onError: (err: unknown) => void;
  timer: ReturnType<typeof setInterval> | undefined;
  running = false;
  again = false;

  constructor(env: ComputeEnv, onError: (err: unknown) => void = () => {}) {
    this.env = env;
    this.onError = onError;
  }

  start(intervalMs = 60_000) {
    this.timer = setInterval(() => this.poke(), intervalMs);
    this.timer.unref();
    this.poke();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Before start() (as in tests) runs only happen when asked for. */
  poke() {
    if (!this.timer) return;
    if (this.running) {
      this.again = true;
      return;
    }
    void this.tick();
  }

  async tick() {
    this.running = true;
    try {
      do {
        this.again = false;
        while ((await runDue(this.env)) >= 50) {
          // A full batch: there may be more due.
        }
      } while (this.again);
    } catch (err) {
      this.onError(err);
    } finally {
      this.running = false;
    }
  }
}

/** Marks a template's scheduled field (or all of an item's) as due now. */
export async function dueNow(db: Db, where: { templateId: string; field: string } | { itemIds: string[] }) {
  if ('itemIds' in where) {
    if (where.itemIds.length === 0) return;
    await db.update(computedState).set({ nextRunAt: new Date() }).where(inArray(computedState.itemId, where.itemIds));
    return;
  }
  await db
    .update(computedState)
    .set({ nextRunAt: new Date() })
    .where(
      and(
        eq(computedState.field, where.field),
        sql`${computedState.itemId} in (select ${items.id} from ${items} join ${collections} on ${collections.id} = ${items.collectionId} where ${collections.templateId} = ${where.templateId})`,
      ),
    );
}
