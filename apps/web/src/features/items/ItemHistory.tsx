import { type FieldDefinition, formatValue } from '@precious/shared';
import { useItemHistory } from '../../api/queries.ts';
import { HistoryChart } from '../../components/HistoryChart.tsx';
import { Caps } from '../../components/ui.tsx';
import { LOCALE } from '../../lib/format.ts';

/** A scheduled number's history on the item page; nothing until there are two values. */
export function ItemHistory({ itemId, field }: { itemId: string; field: FieldDefinition }) {
  const history = useItemHistory(itemId, field.id);
  const points = (history.data ?? [])
    .filter((p) => typeof p.value === 'number')
    .map((p) => ({ at: new Date(p.at), value: p.value as number }));
  if (points.length < 2) return null;
  return (
    <section className="grid min-w-0 content-start gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5">
      <Caps>{field.label} over time</Caps>
      <HistoryChart
        points={points}
        label={`${field.label} over time`}
        money={field.type === 'money'}
        format={(n) => formatValue(field, n, { locale: LOCALE })}
      />
    </section>
  );
}
