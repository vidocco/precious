import type { NameValue } from '@precious/shared';
import { IconButton, TextInput } from '../../components/ui.tsx';

/** Editable name/value rows (headers, query parameters). Values can be templates. */
export function KeyValueTable({
  rows,
  onChange,
  label,
  namePlaceholder = 'Name',
  valuePlaceholder = 'Value or {{ template }}',
  disabled,
}: {
  rows: NameValue[];
  onChange: (rows: NameValue[]) => void;
  label: string;
  namePlaceholder?: string;
  valuePlaceholder?: string;
  disabled?: boolean;
}) {
  const set = (i: number, patch: Partial<NameValue>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="overflow-hidden rounded-[9px] border border-line">
      {rows.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional while editing
        <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] border-b border-line last:border-b-0">
          <TextInput
            aria-label={`${label} name ${i + 1}`}
            value={r.name}
            placeholder={namePlaceholder}
            onChange={(e) => set(i, { name: e.target.value })}
            className="rounded-none border-0 border-r border-line font-semibold focus:ring-0"
            disabled={disabled}
          />
          <TextInput
            aria-label={`${label} value ${i + 1}`}
            value={r.value}
            placeholder={valuePlaceholder}
            onChange={(e) => set(i, { value: e.target.value })}
            className="rounded-none border-0 italic focus:ring-0"
            disabled={disabled}
          />
          <IconButton
            icon="x"
            label={`Remove ${r.name || 'row'}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            disabled={disabled}
          />
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...rows, { name: '', value: '' }])}
        className="w-full bg-surface px-3 py-2 text-left text-[0.85rem] font-semibold text-accent disabled:opacity-50"
      >
        + Add {label.toLowerCase()}
      </button>
    </div>
  );
}
