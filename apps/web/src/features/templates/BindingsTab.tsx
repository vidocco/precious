import {
  BINDING_SYSTEM_TARGETS,
  type Bindings,
  type EndpointDto,
  type EnrichStep,
  type FieldDefinition,
  type Fill,
  type FillResult,
  formatValue,
  makeFieldId,
  type SearchProvider,
  type SourceDto,
  suggestFill,
  type TemplateData,
  type TryBindingsResult,
} from '@precious/shared';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { ApiError, errorMessage } from '../../api/client.ts';
import { useLookupMutations, useSources } from '../../api/queries.ts';
import { Icon } from '../../components/Icon.tsx';
import { MatchChooser } from '../../components/MatchChooser.tsx';
import {
  Button,
  Caps,
  cx,
  EmptyState,
  ErrorBox,
  IconButton,
  Select,
  Spinner,
  TextInput,
} from '../../components/ui.tsx';
import { ComputedSection } from './ComputedSection.tsx';
import { move } from './editorUtils.ts';

type SetT = (patch: Partial<TemplateData>) => void;

interface EndpointInfo {
  endpoint: EndpointDto;
  source: SourceDto;
}

/** The keys an endpoint's mapping produces, i.e. what can fill a field. */
function outputKeys(e: EndpointDto): string[] {
  return Object.keys(e.map).filter((k) => !(e.role === 'search' && k === 'results'));
}

/** The refs an endpoint's request uses, e.g. ["openlibrary"] for {{ refs.openlibrary }}. */
function refsUsed(e: EndpointDto): string[] {
  const text = JSON.stringify([e.path, e.query, e.headers, e.body, e.graphql]);
  return [...new Set([...text.matchAll(/refs\.([a-z][a-z0-9_]*)/g)].map((m) => m[1] as string))];
}

function indexEndpoints(sources: SourceDto[]) {
  const byId = new Map<string, EndpointInfo>();
  for (const source of sources) for (const endpoint of source.endpoints) byId.set(endpoint.id, { endpoint, source });
  return byId;
}

export function EndpointSelect({
  sources,
  endpointRole: role,
  value,
  onChange,
  label,
}: {
  sources: SourceDto[];
  endpointRole: EndpointDto['role'];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const known = sources.some((s) => s.endpoints.some((e) => e.id === value));
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!known}>
      {!known && <option value={value}>Missing endpoint</option>}
      {sources
        .filter((s) => s.endpoints.some((e) => e.role === role))
        .map((s) => (
          <optgroup key={s.id} label={s.name}>
            {s.endpoints
              .filter((e) => e.role === role)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {s.name} · {e.name}
                </option>
              ))}
          </optgroup>
        ))}
    </Select>
  );
}

/** Output key → field. Stored the other way round (field → key), one key per field. */
function FillTable({
  keys,
  fill,
  fields,
  onChange,
}: {
  keys: string[];
  fill: Fill;
  fields: FieldDefinition[];
  onChange: (fill: Fill) => void;
}) {
  const targetOf = (key: string) => Object.entries(fill).find(([, k]) => k === key)?.[0] ?? '';
  const stale = Object.values(fill).filter((k) => !keys.includes(k));
  const setTarget = (key: string, target: string) => {
    const next = Object.fromEntries(Object.entries(fill).filter(([t, k]) => k !== key && t !== target));
    if (target) next[target] = key;
    onChange(next);
  };
  const usable = fields.filter((f) => !f.hidden && f.type !== 'person');
  if (keys.length === 0 && stale.length === 0) {
    return <p className="text-[0.85rem] text-ink-faint">This endpoint’s mapping has no outputs yet.</p>;
  }
  return (
    <div className="grid gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2 px-0.5 text-[0.72rem] font-semibold tracking-[0.08em] text-ink-muted uppercase">
        <span>Value</span>
        <span>Fills</span>
      </div>
      {[...keys, ...stale].map((key) => (
        <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-2">
          <code className={cx('truncate text-[0.85rem]', stale.includes(key) && 'text-danger line-through')}>
            {key}
          </code>
          <Select
            aria-label={`Field filled by ${key}`}
            value={targetOf(key)}
            onChange={(e) => setTarget(key, e.target.value)}
            className="py-1 text-[0.86rem]"
          >
            <option value="">Not used</option>
            {Object.entries(BINDING_SYSTEM_TARGETS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
            {usable.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
      ))}
      {stale.length > 0 && (
        <p className="text-[0.8rem] text-danger">Struck-out values are no longer in the endpoint’s mapping.</p>
      )}
    </div>
  );
}

export function Card({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-3 rounded-[12px] border border-line bg-surface p-3.5">
      <div className="flex items-center gap-2">
        <b className="min-w-0 flex-1 truncate text-[0.95rem]">{title}</b>
        {actions}
      </div>
      {children}
    </div>
  );
}

function MoveButtons({ onMove, onRemove, what }: { onMove: (d: -1 | 1) => void; onRemove: () => void; what: string }) {
  return (
    <span className="flex">
      <IconButton icon="up" label={`Move ${what} up`} onClick={() => onMove(-1)} className="size-7" />
      <IconButton icon="down" label={`Move ${what} down`} onClick={() => onMove(1)} className="size-7" />
      <IconButton icon="x" label={`Remove ${what}`} onClick={onRemove} className="size-7" />
    </span>
  );
}

const small = 'text-[0.85rem] text-ink-muted';

export function BindingsTab({
  t,
  set,
  templateId,
  saved,
}: {
  t: TemplateData;
  set: SetT;
  /** The saved template, for the status of values kept up to date. */
  templateId?: string;
  saved?: Bindings;
}) {
  const sources = useSources();
  if (sources.isPending) return <Spinner />;
  if (sources.isError) return <ErrorBox>{errorMessage(sources.error)}</ErrorBox>;
  const list = sources.data;
  const byId = indexEndpoints(list);
  const searchEps = list.flatMap((s) => s.endpoints.filter((e) => e.role === 'search'));
  const lookupEps = list.flatMap((s) => s.endpoints.filter((e) => e.role === 'lookup'));
  const b = t.bindings;
  const setB = (patch: Partial<Bindings>) => set({ bindings: { ...b, ...patch } });
  const takenIds = () => [...b.search.map((p) => p.id), ...b.steps.map((s) => s.id)];

  const setProvider = (i: number, p: Partial<SearchProvider>) =>
    setB({ search: b.search.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const setStep = (i: number, s: Partial<EnrichStep>) =>
    setB({ steps: b.steps.map((x, j) => (j === i ? { ...x, ...s } : x)) });

  function addProvider() {
    const e = searchEps[0];
    if (!e) return;
    const info = byId.get(e.id) as EndpointInfo;
    const id = makeFieldId(info.source.name, takenIds());
    // Use the ref name the source's own lookups expect, so they find the picked result.
    const ref = info.source.endpoints.filter((x) => x.role === 'lookup').flatMap(refsUsed)[0] ?? id;
    setB({ search: [...b.search, { id, endpointId: e.id, ref, fill: suggestFill(outputKeys(e), t.fields) }] });
  }

  function addStep() {
    // Prefer a lookup not used yet, from a source the searches already use.
    const used = new Set(b.steps.map((x) => x.endpointId));
    const searched = new Set(b.search.map((p) => byId.get(p.endpointId)?.source.id));
    const fresh = lookupEps.filter((x) => !used.has(x.id));
    const e = fresh.find((x) => searched.has(x.sourceId)) ?? fresh[0] ?? lookupEps[0];
    if (!e) return;
    const info = byId.get(e.id) as EndpointInfo;
    const id = makeFieldId(info.source.name, takenIds());
    setB({ steps: [...b.steps, stepFor(e, id)] });
  }

  /**
   * A new step for a lookup: from the same source as a search, it uses that search's
   * picked result; from another source, it searches that source for a match first.
   */
  function stepFor(e: EndpointDto, id: string): EnrichStep {
    const info = byId.get(e.id) as EndpointInfo;
    // The title and cover usually come from the picked result; a lookup only suggests them when nothing else does.
    const searched = new Set(b.search.flatMap((p) => Object.keys(p.fill)));
    const fill = Object.fromEntries(
      Object.entries(suggestFill(outputKeys(e), t.fields)).filter(
        ([target]) => !target.startsWith('$') || !searched.has(target),
      ),
    );
    const sameSource = b.search.find((p) => byId.get(p.endpointId)?.source.id === info.source.id);
    if (sameSource) return { id, endpointId: e.id, ref: sameSource.ref, fill };
    const wanted = refsUsed(e)[0];
    if (!wanted) return { id, endpointId: e.id, fill };
    if (b.search.some((p) => p.ref === wanted)) return { id, endpointId: e.id, ref: wanted, fill };
    const search = info.source.endpoints.find((x) => x.role === 'search') ?? (searchEps[0] as EndpointDto);
    return {
      id,
      endpointId: e.id,
      ref: wanted,
      match: { endpointId: search.id, query: '{{ item.title }}', threshold: 0.85 },
      fill,
    };
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
      <div className="grid content-start gap-6">
        <section className="grid gap-2.5">
          <div>
            <Caps>Search with</Caps>
            <p className={small}>
              The <b>+</b> on a collection searches these; the first one is the default. Picking a result fills in what
              it can.
            </p>
          </div>
          {searchEps.length === 0 && (
            <EmptyState
              title="No search endpoints yet"
              action={
                <Link to="/data/sources" className="font-semibold">
                  Go to data sources
                </Link>
              }
            >
              Add a data source with a search endpoint (or install a preset) first. Then come back to choose which one
              finds items of this template.
            </EmptyState>
          )}
          {b.search.map((p, i) => {
            const info = byId.get(p.endpointId);
            return (
              <Card
                key={p.id}
                title={info ? info.source.name : 'Missing endpoint'}
                actions={
                  <MoveButtons
                    what="search"
                    onMove={(d) => setB({ search: move(b.search, i, d) })}
                    onRemove={() => setB({ search: b.search.filter((_, j) => j !== i) })}
                  />
                }
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
                  <EndpointSelect
                    sources={list}
                    endpointRole="search"
                    label="Search endpoint"
                    value={p.endpointId}
                    onChange={(endpointId) => {
                      const next = byId.get(endpointId);
                      if (!next) return;
                      const ref = next.source.endpoints.filter((x) => x.role === 'lookup').flatMap(refsUsed)[0];
                      setProvider(i, {
                        endpointId,
                        fill: suggestFill(outputKeys(next.endpoint), t.fields),
                        ...(ref && { ref }),
                      });
                    }}
                  />
                  <label className="flex items-center gap-2 text-[0.85rem] text-ink-muted">
                    <span className="whitespace-nowrap">Saves id as</span>
                    <TextInput
                      aria-label="Ref name"
                      value={p.ref}
                      onChange={(e) => setProvider(i, { ref: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                      className="py-1 text-[0.85rem]"
                    />
                  </label>
                </div>
                <FillTable
                  keys={info ? outputKeys(info.endpoint) : []}
                  fill={p.fill}
                  fields={t.fields}
                  onChange={(fill) => setProvider(i, { fill })}
                />
              </Card>
            );
          })}
          {searchEps.length > 0 && (
            <div>
              <Button icon="plus" onClick={addProvider}>
                Add a search
              </Button>
            </div>
          )}
        </section>

        <section className="grid gap-2.5">
          <div>
            <Caps>Then fill in with</Caps>
            <p className={small}>
              Lookups run in order after you pick a result, and each can use what earlier ones found. When two fill the
              same field, the later one wins.
            </p>
          </div>
          {b.steps.map((s, i) => {
            const info = byId.get(s.endpointId);
            const mode = s.match ? 'match' : s.ref ? `ref:${s.ref}` : 'none';
            const refOptions = [
              ...b.search.map((p) => ({
                ref: p.ref,
                label: `the result picked in ${byId.get(p.endpointId)?.source.name ?? p.id}`,
              })),
              ...b.steps
                .slice(0, i)
                .filter((x) => x.match && x.ref)
                .map((x) => ({
                  ref: x.ref as string,
                  label: `the match found for ${byId.get(x.endpointId)?.source.name ?? x.id}`,
                })),
            ].filter((o, k, all) => all.findIndex((y) => y.ref === o.ref) === k);
            return (
              <Card
                key={s.id}
                title={info ? `${info.source.name} · ${info.endpoint.name}` : 'Missing endpoint'}
                actions={
                  <MoveButtons
                    what="lookup"
                    onMove={(d) => setB({ steps: move(b.steps, i, d) })}
                    onRemove={() => setB({ steps: b.steps.filter((_, j) => j !== i) })}
                  />
                }
              >
                <EndpointSelect
                  sources={list}
                  endpointRole="lookup"
                  label="Lookup endpoint"
                  value={s.endpointId}
                  onChange={(endpointId) => {
                    const e = byId.get(endpointId)?.endpoint;
                    if (e) setB({ steps: b.steps.map((x, j) => (j === i ? stepFor(e, s.id) : x)) });
                  }}
                />
                <label className="grid gap-1 text-[0.85rem] text-ink-muted">
                  Find the item by
                  <Select
                    value={mode}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'none') setStep(i, { ref: undefined, match: undefined });
                      else if (v === 'match') {
                        const own =
                          (info && refsUsed(info.endpoint)[0]) ??
                          makeFieldId(info?.source.name ?? s.id, [
                            ...b.search.map((p) => p.ref),
                            ...b.steps.filter((_, j) => j !== i).flatMap((x) => (x.ref ? [x.ref] : [])),
                          ]);
                        setStep(i, {
                          ref: own,
                          match: {
                            endpointId:
                              searchEps.find((x) => x.sourceId === info?.source.id)?.id ??
                              (searchEps[0] as EndpointDto).id,
                            query: '{{ item.title }}',
                            threshold: 0.85,
                          },
                        });
                      } else setStep(i, { ref: v.slice(4), match: undefined });
                    }}
                  >
                    {refOptions.map((o) => (
                      <option key={o.ref} value={`ref:${o.ref}`}>
                        {o.label} (refs.{o.ref})
                      </option>
                    ))}
                    {s.ref && !s.match && !refOptions.some((o) => o.ref === s.ref) && (
                      <option value={`ref:${s.ref}`}>refs.{s.ref} (nothing earlier provides it)</option>
                    )}
                    <option value="match">searching for it in another source…</option>
                    <option value="none">nothing: it doesn’t need an id</option>
                  </Select>
                </label>
                {info && s.ref && refsUsed(info.endpoint).length > 0 && !refsUsed(info.endpoint).includes(s.ref) && (
                  <p className="text-[0.82rem] text-danger">
                    This lookup’s request uses{' '}
                    {refsUsed(info.endpoint)
                      .map((r) => `refs.${r}`)
                      .join(', ')}
                    , not refs.
                    {s.ref}. Rename the ref so it gets the id.
                  </p>
                )}
                {s.match && (
                  <div className="grid gap-2 rounded-[10px] bg-surface-sunk p-2.5">
                    <EndpointSelect
                      sources={list}
                      endpointRole="search"
                      label="Match search endpoint"
                      value={s.match.endpointId}
                      onChange={(endpointId) =>
                        setStep(i, { match: { ...(s.match as EnrichStep['match'] & object), endpointId } })
                      }
                    />
                    <label className="grid gap-1 text-[0.85rem] text-ink-muted">
                      Search for
                      <TextInput
                        value={s.match.query}
                        onChange={(e) =>
                          setStep(i, { match: { ...(s.match as EnrichStep['match'] & object), query: e.target.value } })
                        }
                        className="font-mono text-[0.85rem]"
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1 text-[0.85rem] text-ink-muted">
                        <span>
                          Pick automatically at{' '}
                          <b className="text-ink tabular">{Math.round(s.match.threshold * 100)}%</b> similar or more
                        </span>
                        <input
                          type="range"
                          min={50}
                          max={100}
                          step={1}
                          value={Math.round(s.match.threshold * 100)}
                          onChange={(e) =>
                            setStep(i, {
                              match: {
                                ...(s.match as EnrichStep['match'] & object),
                                threshold: Number(e.target.value) / 100,
                              },
                            })
                          }
                          className="accent-[var(--color-accent)]"
                        />
                      </label>
                      <label className="grid gap-1 text-[0.85rem] text-ink-muted">
                        Compare years with
                        <Select
                          value={s.match.yearField ?? ''}
                          onChange={(e) => {
                            const { yearField: _, ...rest } = s.match as NonNullable<EnrichStep['match']>;
                            setStep(i, { match: e.target.value ? { ...rest, yearField: e.target.value } : rest });
                          }}
                          className="py-1 text-[0.86rem]"
                        >
                          <option value="">Don’t compare</option>
                          {t.fields
                            .filter((f) => !f.hidden && (f.type === 'number' || f.type === 'date' || f.type === 'text'))
                            .map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.label}
                              </option>
                            ))}
                        </Select>
                      </label>
                    </div>
                    <p className="text-[0.8rem] text-ink-faint">
                      Below that, or when two matches are close, you choose. The match is saved as{' '}
                      <code>refs.{s.ref}</code>, so refreshing doesn’t search again.
                    </p>
                  </div>
                )}
                <FillTable
                  keys={info ? outputKeys(info.endpoint) : []}
                  fill={s.fill}
                  fields={t.fields}
                  onChange={(fill) => setStep(i, { fill })}
                />
              </Card>
            );
          })}
          <div>
            <Button icon="plus" onClick={addStep} disabled={lookupEps.length === 0 || b.search.length === 0}>
              Add a lookup
            </Button>
            {lookupEps.length === 0 && <p className={cx(small, 'mt-1.5')}>No data source has a lookup endpoint yet.</p>}
          </div>
        </section>

        <ComputedSection t={t} setB={setB} sources={list} templateId={templateId} saved={saved} />
      </div>
      {b.search.length > 0 && <TryPanel t={t} byId={byId} />}
    </div>
  );
}

const STATUS: Record<string, { label: string; className: string }> = {
  ok: { label: 'Done', className: 'text-ok' },
  pending: { label: 'You choose', className: 'text-gilt' },
  skipped: { label: 'Skipped', className: 'text-ink-faint' },
  failed: { label: 'Failed', className: 'text-danger' },
};

function TryPanel({ t, byId }: { t: TemplateData; byId: Map<string, EndpointInfo> }) {
  const { tryBindings } = useLookupMutations();
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState(t.bindings.search[0]?.id ?? '');
  const [result, setResult] = useState<TryBindingsResult | null>(null);
  const [error, setError] = useState<string[] | null>(null);
  const [choices, setChoices] = useState<Record<string, string | null>>({});

  async function run(resultIndex = 0, nextChoices = choices) {
    if (!query.trim()) return;
    setError(null);
    try {
      const res = await tryBindings.mutateAsync({
        fields: t.fields,
        bindings: t.bindings,
        query,
        provider: t.bindings.search.some((p) => p.id === provider) ? provider : undefined,
        resultIndex,
        choices: nextChoices,
      });
      setResult(res);
    } catch (err) {
      setResult(null);
      setError(
        err instanceof ApiError && err.body.issues?.length
          ? err.body.issues.map((i) => `${i.path}: ${i.message}`)
          : [errorMessage(err)],
      );
    }
  }

  return (
    <aside className="grid content-start gap-3 self-start rounded-[12px] border border-line bg-wall p-3.5 xl:sticky xl:top-20">
      <div>
        <Caps>Try it</Caps>
        <p className={small}>Runs these settings as they are now, before saving.</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setChoices({});
          void run(0, {});
        }}
      >
        {t.bindings.search.length > 1 && (
          <Select
            aria-label="Search with"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-auto"
          >
            {t.bindings.search.map((p) => (
              <option key={p.id} value={p.id}>
                {byId.get(p.endpointId)?.source.name ?? p.id}
              </option>
            ))}
          </Select>
        )}
        <TextInput
          aria-label="Try a search"
          placeholder="Search for something you own"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={tryBindings.isPending || !query.trim()}>
          {tryBindings.isPending ? 'Running…' : 'Run'}
        </Button>
      </form>
      {error && (
        <ErrorBox>
          <ul className="m-0 list-disc pl-5">
            {error.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </ErrorBox>
      )}
      {result && (
        <div className="grid gap-3">
          {result.error && <ErrorBox>{result.error}</ErrorBox>}
          {result.results.length === 0 && !result.error && <p className={small}>No results.</p>}
          {result.results.length > 0 && (
            <div className="grid gap-1">
              <span className={small}>Results · click one to fill from it</span>
              <ul className="m-0 grid max-h-48 list-none gap-0.5 overflow-y-auto p-0">
                {result.results.map((r, i) => (
                  <li key={r.token}>
                    <button
                      type="button"
                      onClick={() => {
                        setChoices({});
                        void run(i, {});
                      }}
                      className={cx(
                        'flex w-full items-baseline gap-2 rounded-[7px] px-2 py-1 text-left text-[0.86rem]',
                        result.picked === i ? 'bg-accent/15 font-semibold' : 'hover:bg-surface-sunk',
                      )}
                    >
                      <span className="truncate">{r.title}</span>
                      <span className="ml-auto flex-none text-ink-faint tabular">{r.year ?? ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.fill && (
            <FillPreview
              fill={result.fill}
              fields={t.fields}
              onChoose={(step, id) => {
                const next = { ...choices, [step]: id };
                setChoices(next);
                void run(result.picked ?? 0, next);
              }}
            />
          )}
        </div>
      )}
    </aside>
  );
}

function FillPreview({
  fill,
  fields,
  onChoose,
}: {
  fill: FillResult;
  fields: FieldDefinition[];
  onChoose: (step: string, id: string | null) => void;
}) {
  const rows = [
    ...(fill.title ? [{ id: '$title', label: 'Title', value: fill.title }] : []),
    ...fields
      .filter((f) => fill.data[f.id] !== undefined)
      .map((f) => ({ id: f.id, label: f.label, value: formatValue(f, fill.data[f.id]) })),
  ];
  return (
    <div className="grid gap-3">
      <ol className="m-0 grid list-none gap-1 p-0 text-[0.86rem]">
        {fill.steps.map((s) => (
          <li key={s.id} className="flex items-baseline gap-2">
            <Icon
              name={s.status === 'ok' ? 'check' : s.status === 'failed' ? 'x' : 'chevron'}
              size={14}
              className={STATUS[s.status]?.className}
            />
            <span className="font-medium">{s.label}</span>
            <span className={cx('text-[0.8rem]', STATUS[s.status]?.className)}>
              {STATUS[s.status]?.label}
              {s.score !== undefined && ` · ${Math.round(s.score * 100)}% match`}
            </span>
            {s.message && s.status !== 'pending' && (
              <span className="min-w-0 truncate text-[0.8rem] text-ink-faint" title={s.message}>
                {s.message}
              </span>
            )}
          </li>
        ))}
      </ol>
      {fill.pending.map((p) => (
        <MatchChooser key={p.step} pending={p} onChoose={(id) => onChoose(p.step, id)} />
      ))}
      <div className="grid gap-1">
        <span className={small}>Filled in</span>
        {fill.cover && (
          <img
            src={fill.cover.url}
            alt="Cover found"
            className="h-28 w-auto justify-self-start rounded-[6px] object-cover"
          />
        )}
        <dl className="m-0 grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_auto] gap-x-3 gap-y-1 text-[0.86rem]">
          {rows.map((r) => (
            <div key={r.id} className="contents">
              <dt className="truncate text-ink-muted">{r.label}</dt>
              <dd className="m-0 truncate" title={r.value}>
                {r.value}
              </dd>
              <dd className="m-0 text-[0.78rem] text-ink-faint">{fill.sources[r.id]?.name}</dd>
            </div>
          ))}
        </dl>
        {rows.length === 0 && <p className={small}>Nothing yet. Map some values to fields.</p>}
      </div>
      {fill.warnings.length > 0 && (
        <ul className="m-0 grid list-disc gap-0.5 pl-5 text-[0.82rem] text-ink-muted">
          {fill.warnings.map((w) => (
            <li key={`${w.step}-${w.target}-${w.message}`}>{w.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
