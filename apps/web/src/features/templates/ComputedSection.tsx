import {
  type Bindings,
  type ComputedField,
  type ComputedStatus,
  DEFAULT_SCHEDULE,
  describeSchedule,
  type EndpointDto,
  type FormulaTryResult,
  nextRun,
  type Schedule,
  type SourceDto,
  type TemplateData,
} from '@precious/shared';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { tryFormula, useComputedMutations, useComputedStatus } from '../../api/queries.ts';
import { Button, Caps, IconButton, Segmented, Select, TextArea } from '../../components/ui.tsx';
import { useDebounced } from '../../lib/hooks.ts';
import { Card, EndpointSelect } from './BindingsTab.tsx';
import { sampleItem } from './editorUtils.ts';

const small = 'text-[0.85rem] text-ink-muted';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = [1, 2, 3, 4, 6, 8, 12, 24];

const rel = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function relativeTime(iso: string, now = Date.now()) {
  const s = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return rel.format(Math.round(s), 'second');
  if (abs < 3600) return rel.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rel.format(Math.round(s / 3600), 'hour');
  return rel.format(Math.round(s / 86400), 'day');
}

const whenFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function ScheduleEditor({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const at = 'at' in value ? value.at : '04:00';
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-[0.88rem] text-ink-muted">
        <Select
          aria-label="How often"
          value={value.every}
          onChange={(e) => {
            const every = e.target.value as Schedule['every'];
            onChange(
              every === 'hours'
                ? { every, n: 6 }
                : every === 'day'
                  ? { every, at }
                  : every === 'week'
                    ? { every, day: 1, at }
                    : { every, day: 1, at },
            );
          }}
          className="w-auto py-1"
        >
          <option value="hours">Every few hours</option>
          <option value="day">Every day</option>
          <option value="week">Every week</option>
          <option value="month">Every month</option>
        </Select>
        {value.every === 'hours' && (
          <Select
            aria-label="Hours between lookups"
            value={value.n}
            onChange={(e) => onChange({ every: 'hours', n: Number(e.target.value) })}
            className="w-auto py-1"
          >
            {HOURS.map((n) => (
              <option key={n} value={n}>
                {n === 1 ? 'every hour' : `every ${n} hours`}
              </option>
            ))}
          </Select>
        )}
        {value.every === 'week' && (
          <Select
            aria-label="Day of the week"
            value={value.day}
            onChange={(e) => onChange({ ...value, day: Number(e.target.value) })}
            className="w-auto py-1"
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                on {d}
              </option>
            ))}
          </Select>
        )}
        {value.every === 'month' && (
          <Select
            aria-label="Day of the month"
            value={value.day}
            onChange={(e) => onChange({ ...value, day: Number(e.target.value) })}
            className="w-auto py-1"
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                on day {d}
              </option>
            ))}
          </Select>
        )}
        {value.every !== 'hours' && (
          <label className="flex items-center gap-1.5">
            at
            <input
              type="time"
              aria-label="Time"
              value={at}
              onChange={(e) => e.target.value && onChange({ ...value, at: e.target.value } as Schedule)}
              className="rounded-[9px] border border-line bg-wall px-2 py-1 text-ink tabular"
            />
          </label>
        )}
      </div>
      <p className="text-[0.8rem] text-ink-faint">
        {describeSchedule(value)} (server time). Next: {whenFmt.format(nextRun(value, new Date()))}.
      </p>
    </div>
  );
}

function StatusLine({ status, templateId, field }: { status?: ComputedStatus; templateId: string; field: string }) {
  const { runField } = useComputedMutations();
  const [error, setError] = useState('');
  if (!status) return <p className="text-[0.82rem] text-ink-faint">No items yet.</p>;
  const parts = [
    `${status.items} item${status.items === 1 ? '' : 's'}`,
    status.waiting ? `${status.waiting} waiting` : null,
    status.failing ? `${status.failing} failing` : null,
    status.lastRunAt ? `last looked up ${relativeTime(status.lastRunAt)}` : null,
    status.nextRunAt ? `next ${relativeTime(status.nextRunAt)}` : null,
  ].filter(Boolean);
  return (
    <div className="grid gap-1 rounded-[9px] bg-surface-sunk px-2.5 py-2 text-[0.82rem]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={status.failing ? 'text-ink' : 'text-ink-muted'}>{parts.join(' · ')}</span>
        <Button
          size="sm"
          icon="refresh"
          className="ml-auto"
          disabled={runField.isPending}
          onClick={() => runField.mutate({ templateId, field }, { onError: (err) => setError(errorMessage(err)) })}
        >
          {runField.isPending ? 'Starting…' : 'Update all now'}
        </Button>
      </div>
      {status.lastError && <span className="text-danger">Last error: {status.lastError}</span>}
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}

function FormulaPreview({ formula, t }: { formula: string; t: TemplateData }) {
  const debounced = useDebounced(formula.trim(), 400);
  const [result, setResult] = useState<FormulaTryResult | null>(null);
  useEffect(() => {
    if (!debounced) {
      setResult(null);
      return;
    }
    let live = true;
    const sample = sampleItem(t);
    tryFormula({ formula: debounced, data: sample.data, title: sample.title })
      .then((r) => live && setResult(r))
      .catch((err) => live && setResult({ error: errorMessage(err) }));
    return () => {
      live = false;
    };
  }, [debounced, t]);
  if (!result) return null;
  return (
    <p className={result.error ? 'text-[0.82rem] text-danger' : 'text-[0.82rem] text-ink-muted'}>
      {result.error
        ? result.error
        : `With example values it gives ${result.value === undefined ? 'nothing' : JSON.stringify(result.value)}.`}
    </p>
  );
}

/**
 * "Keep up to date": fields looked up again on a schedule (a price), and fields
 * calculated from other fields with a formula (price per hour).
 */
export function ComputedSection({
  t,
  setB,
  sources,
  templateId,
  saved,
}: {
  t: TemplateData;
  setB: (patch: Partial<Bindings>) => void;
  sources: SourceDto[];
  templateId?: string;
  saved?: Bindings;
}) {
  const status = useComputedStatus(templateId);
  const list = t.bindings.computed;
  const computeEps: EndpointDto[] = sources.flatMap((s) => s.endpoints.filter((e) => e.role === 'compute'));
  const fields = t.fields.filter((f) => !f.hidden && f.type !== 'person');
  const free = fields.filter((f) => !list.some((c) => c.field === f.id));
  const setOne = (i: number, c: ComputedField) => setB({ computed: list.map((x, j) => (j === i ? c : x)) });

  function add() {
    const field = free.find((f) => f.type === 'money' || f.type === 'number') ?? free[0];
    if (!field) return;
    const ep = computeEps[0];
    setB({
      computed: [
        ...list,
        ep
          ? { kind: 'source', field: field.id, endpointId: ep.id, schedule: DEFAULT_SCHEDULE, runOnCreate: true }
          : { kind: 'formula', field: field.id, formula: '' },
      ],
    });
  }

  return (
    <section className="grid gap-2.5">
      <div>
        <Caps>Keep up to date</Caps>
        <p className={small}>
          Look a value up again on a schedule (a price every day), or calculate it from other fields (price per hour).
          Values edited by hand are left alone.
        </p>
      </div>
      {list.map((c, i) => {
        const field = t.fields.find((f) => f.id === c.field);
        const isSaved = saved?.computed.some((x) => JSON.stringify(x) === JSON.stringify(c));
        return (
          <Card
            key={c.field}
            title={field?.label ?? c.field}
            actions={
              <IconButton
                icon="x"
                label="Stop keeping it up to date"
                onClick={() => setB({ computed: list.filter((_, j) => j !== i) })}
                className="size-7"
              />
            }
          >
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Select
                aria-label="Field kept up to date"
                value={c.field}
                onChange={(e) => setOne(i, { ...c, field: e.target.value })}
              >
                {fields
                  .filter((f) => f.id === c.field || free.includes(f))
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
              </Select>
              <Segmented
                label="How"
                value={c.kind}
                onChange={(kind) => {
                  if (kind === c.kind) return;
                  const ep = computeEps[0];
                  if (kind === 'source' && ep)
                    setOne(i, {
                      kind,
                      field: c.field,
                      endpointId: ep.id,
                      schedule: DEFAULT_SCHEDULE,
                      runOnCreate: true,
                    });
                  else if (kind === 'formula') setOne(i, { kind, field: c.field, formula: '' });
                }}
                options={[
                  { value: 'source', label: 'From a data source', disabled: computeEps.length === 0 },
                  { value: 'formula', label: 'Calculated' },
                ]}
              />
            </div>
            {c.kind === 'source' ? (
              <>
                <EndpointSelect
                  sources={sources}
                  endpointRole="compute"
                  label="Value endpoint"
                  value={c.endpointId}
                  onChange={(endpointId) => setOne(i, { ...c, endpointId })}
                />
                <ScheduleEditor value={c.schedule} onChange={(schedule) => setOne(i, { ...c, schedule })} />
                <label className="flex items-center gap-2 text-[0.86rem] text-ink-muted">
                  <input
                    type="checkbox"
                    checked={c.runOnCreate}
                    onChange={(e) => setOne(i, { ...c, runOnCreate: e.target.checked })}
                  />
                  Also look it up as soon as an item is added
                </label>
                {templateId && isSaved ? (
                  <StatusLine
                    templateId={templateId}
                    field={c.field}
                    status={status.data?.find((s) => s.field === c.field)}
                  />
                ) : (
                  <p className="text-[0.82rem] text-ink-faint">
                    Once saved, every item’s value is looked up within a minute, then on this schedule.
                  </p>
                )}
              </>
            ) : (
              <>
                <TextArea
                  aria-label="Formula"
                  value={c.formula}
                  rows={2}
                  placeholder="e.g. price / hours"
                  onChange={(e) => setOne(i, { ...c, formula: e.target.value })}
                  className="min-h-0 font-mono text-[0.86rem]"
                />
                <p className="text-[0.8rem] text-ink-faint">
                  A JSONata expression using field ids:{' '}
                  {t.fields
                    .filter((f) => !f.hidden && f.id !== c.field)
                    .map((f) => f.id)
                    .join(', ') || 'none yet'}
                  , and title. It’s worked out again whenever an item changes.
                </p>
                <FormulaPreview formula={c.formula} t={t} />
              </>
            )}
          </Card>
        );
      })}
      <div>
        <Button icon="plus" onClick={add} disabled={free.length === 0}>
          Keep a field up to date
        </Button>
        {computeEps.length === 0 && (
          <p className={`${small} mt-1.5`}>
            No data source has a value endpoint yet (an endpoint whose role is “compute”), so only calculated fields are
            possible.
          </p>
        )}
      </div>
    </section>
  );
}
