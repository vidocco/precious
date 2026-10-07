import type { FieldDefinition, FieldRef } from '@precious/shared';
import { IconButton, Select } from '../../components/ui.tsx';
import { refLabel } from '../../lib/format.ts';
import { move, refOptions } from './editorUtils.ts';

/** An ordered list of field references with add, remove and reorder. */
export function RefList({
  value,
  onChange,
  fields,
  label,
  max = 24,
  inline,
}: {
  value: FieldRef[];
  onChange: (v: FieldRef[]) => void;
  fields: FieldDefinition[];
  label: string;
  max?: number;
  inline?: boolean;
}) {
  const options = refOptions(fields).filter((o) => !value.includes(o.value));
  if (inline) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        {value.map((ref, i) => (
          <span
            key={ref}
            className="inline-flex items-center gap-0.5 rounded-[6px] bg-surface-sunk py-0.5 pr-0.5 pl-2 text-[0.84rem]"
          >
            {i > 0 && <span className="mr-1 text-ink-faint">·</span>}
            {refLabel(ref, fields)}
            <button
              type="button"
              aria-label={`Remove ${refLabel(ref, fields)}`}
              onClick={() => onChange(value.filter((r) => r !== ref))}
              className="grid size-5 place-items-center text-ink-muted"
            >
              ×
            </button>
          </span>
        ))}
        {value.length < max && options.length > 0 && (
          <Select
            aria-label={`Add to ${label}`}
            value=""
            onChange={(e) => e.target.value && onChange([...value, e.target.value])}
            className="w-auto py-0.5 text-[0.82rem]"
          >
            <option value="">+ field</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </div>
    );
  }
  return (
    <div className="grid gap-1.5">
      {value.map((ref, i) => (
        <div
          key={ref}
          className="flex items-center gap-1 rounded-[9px] border border-line bg-surface py-1 pr-1 pl-3 text-[0.88rem]"
        >
          <span className="flex-1">{refLabel(ref, fields)}</span>
          <IconButton icon="up" label="Move up" onClick={() => onChange(move(value, i, -1))} className="size-7" />
          <IconButton icon="down" label="Move down" onClick={() => onChange(move(value, i, 1))} className="size-7" />
          <IconButton
            icon="x"
            label="Remove"
            onClick={() => onChange(value.filter((r) => r !== ref))}
            className="size-7"
          />
        </div>
      ))}
      {value.length < max && options.length > 0 && (
        <Select
          aria-label={`Add to ${label}`}
          value=""
          onChange={(e) => e.target.value && onChange([...value, e.target.value])}
          className="max-w-60"
        >
          <option value="">+ Add a field</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

export function RefSelect({
  value,
  onChange,
  fields,
  label,
}: {
  value: FieldRef | null;
  onChange: (v: FieldRef | null) => void;
  fields: FieldDefinition[];
  label: string;
}) {
  return (
    <Select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Nothing</option>
      {refOptions(fields).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
