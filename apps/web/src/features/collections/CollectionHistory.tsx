import { type FieldDefinition, formatValue, isNumericType, type TemplateDto } from '@precious/shared';
import { useState } from 'react';
import { useCollectionHistory } from '../../api/queries.ts';
import { HistoryChart } from '../../components/HistoryChart.tsx';
import { Caps, Segmented } from '../../components/ui.tsx';
import { LOCALE } from '../../lib/format.ts';

const RANGES = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: 'A year' },
] as const;

/**
 * The collection's total of a value kept up to date (e.g. what it's worth), day by day.
 * Shown once there are at least two days of history.
 */
export function CollectionHistory({ collectionId, template }: { collectionId: string; template: TemplateDto }) {
  const fields = template.bindings.computed
    .filter((c) => c.kind === 'source')
    .map((c) => template.fields.find((f) => f.id === c.field))
    .filter((f): f is FieldDefinition => !!f && !f.hidden && isNumericType(f.type) && f.type !== 'rating');
  const [fieldId, setFieldId] = useState(fields[0]?.id ?? '');
  const [days, setDays] = useState<(typeof RANGES)[number]['value']>('90');
  const field = fields.find((f) => f.id === fieldId) ?? fields[0];
  const history = useCollectionHistory(collectionId, field?.id, Number(days));
  if (!field) return null;
  const data = history.data ?? [];
  const first = data.findIndex((p) => p.items > 0);
  const points = first < 0 ? [] : data.slice(first).map((p) => ({ at: new Date(`${p.day}T12:00:00`), value: p.total }));
  if (points.length < 2) return null;
  return (
    <section className="grid min-w-0 gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Caps>{field.label}: collection total</Caps>
        <div className="ml-auto flex flex-wrap gap-2">
          {fields.length > 1 && (
            <Segmented
              label="Value"
              value={field.id}
              onChange={setFieldId}
              options={fields.map((f) => ({ value: f.id, label: f.label }))}
            />
          )}
          <Segmented label="Time range" value={days} onChange={setDays} options={[...RANGES]} />
        </div>
      </div>
      <div className={history.isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <HistoryChart
          points={points}
          height={170}
          label={`${field.label}, collection total`}
          money={field.type === 'money'}
          format={(n) => formatValue(field, n, { locale: LOCALE })}
        />
      </div>
    </section>
  );
}
