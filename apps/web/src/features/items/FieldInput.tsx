import type { FieldDefinition, UserDto } from '@precious/shared';
import { useId, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { cx, Field, Select, TextArea, TextInput } from '../../components/ui.tsx';

/** Form value for each type: what the input works with before it becomes item data. */
export type FormValue = string | number | boolean | string[] | undefined;

function TagsInput({
  id,
  value,
  onChange,
  choices,
}: {
  id: string;
  value: string[];
  onChange: (v: string[]) => void;
  choices?: string[];
}) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const t = raw.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
  };
  if (choices) {
    return (
      <div className="flex flex-wrap gap-1.5" id={id}>
        {choices.map((c) => {
          const on = value.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((v) => v !== c) : [...value, c])}
              className={cx(
                'rounded-full border px-3 py-1 text-[0.85rem]',
                on ? 'border-ink bg-ink text-surface' : 'border-line bg-surface',
              )}
            >
              {c}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[9px] border border-line bg-wall px-2 py-1.5 focus-within:border-accent">
      {value.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-[6px] bg-surface-sunk py-0.5 pr-1 pl-2 text-[0.85rem]"
        >
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((v) => v !== t))}>
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(',')) add(v.slice(0, -1));
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft && add(draft)}
        placeholder={value.length ? '' : 'Type and press Enter'}
        className="min-w-24 flex-1 bg-transparent py-0.5 text-[0.93rem] outline-none"
      />
    </div>
  );
}

export function DurationInput({
  id,
  value,
  onChange,
  label,
  compact,
}: {
  id?: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  /** Names the inputs ("Main story hours") where there is no label to point at them. */
  label?: string;
  /** Narrow, for a table cell. */
  compact?: boolean;
}) {
  const h = value === undefined ? '' : Math.floor(value / 60);
  const m = value === undefined ? '' : value % 60;
  const update = (hours: string, mins: string) => {
    if (hours === '' && mins === '') return onChange(undefined);
    onChange(Math.max(0, Math.round((Number(hours) || 0) * 60 + (Number(mins) || 0))));
  };
  return (
    <div className={cx('flex items-center', compact ? 'gap-1' : 'gap-2')}>
      <TextInput
        id={id}
        type="number"
        min={0}
        inputMode="numeric"
        value={h}
        onChange={(e) => update(e.target.value, String(m))}
        className={compact ? 'w-16 py-1 text-right' : 'w-24'}
        aria-label={label ? `${label} hours` : 'Hours'}
      />
      <span className="text-ink-muted">h</span>
      <TextInput
        type="number"
        min={0}
        max={59}
        inputMode="numeric"
        value={m}
        onChange={(e) => update(String(h), e.target.value)}
        className={compact ? 'w-14 py-1 text-right' : 'w-20'}
        aria-label={label ? `${label} minutes` : 'Minutes'}
      />
      <span className="text-ink-muted">min</span>
    </div>
  );
}

function RatingInput({
  value,
  max,
  onChange,
  label,
}: {
  value: number | undefined;
  max: number;
  onChange: (v: number | undefined) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        // biome-ignore lint/a11y/useSemanticElements: styled buttons with radio semantics
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} of ${max}`}
          onClick={() => onChange(value === n ? undefined : n)}
          className={cx('p-0.5', value !== undefined && n <= value ? 'text-gilt' : 'text-ink-faint')}
        >
          <svg
            viewBox="0 0 24 24"
            className="size-6"
            aria-hidden="true"
            fill={value !== undefined && n <= value ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
          </svg>
        </button>
      ))}
    </div>
  );
}

export function FieldInput({
  field,
  value,
  onChange,
  error,
  users,
  aside,
}: {
  field: FieldDefinition;
  value: FormValue;
  onChange: (v: FormValue) => void;
  error?: string;
  users?: UserDto[];
  aside?: React.ReactNode;
}) {
  const id = useId();
  const label = (
    <>
      {field.label}
      {field.required && <span className="text-danger"> *</span>}
    </>
  );
  const invalid = !!error || undefined;
  const common = { id, 'aria-invalid': invalid, required: field.required };
  let input: React.ReactNode;

  switch (field.type) {
    case 'longtext':
      input = <TextArea {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} rows={4} />;
      break;
    case 'number':
    case 'money':
      input = (
        <div className="flex items-center gap-2">
          <TextInput
            {...common}
            type="number"
            step="any"
            inputMode="decimal"
            min={field.options.min}
            max={field.options.max}
            value={value === undefined ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            className="max-w-48"
          />
          {(field.options.currency || field.options.unit) && (
            <span className="text-ink-muted">
              {field.type === 'money' ? (field.options.currency ?? 'EUR') : field.options.unit}
            </span>
          )}
        </div>
      );
      break;
    case 'duration':
      input = <DurationInput id={id} value={value as number | undefined} onChange={onChange} />;
      break;
    case 'date':
      input = (
        <TextInput
          {...common}
          type="date"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-48"
        />
      );
      break;
    case 'boolean':
      input = (
        <label className="inline-flex cursor-pointer items-center gap-2 text-[0.93rem]">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          Yes
        </label>
      );
      break;
    case 'url':
      input = (
        <TextInput
          {...common}
          type="url"
          inputMode="url"
          placeholder="https://"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'rating':
      input = (
        <RatingInput
          value={value as number | undefined}
          max={field.options.max ?? 5}
          onChange={onChange}
          label={field.label}
        />
      );
      break;
    case 'choice':
      input = (
        <Select {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="max-w-72">
          <option value="">—</option>
          {(field.options.choices ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      );
      break;
    case 'multichoice':
      input = (
        <TagsInput id={id} value={(value as string[]) ?? []} onChange={onChange} choices={field.options.choices} />
      );
      break;
    case 'tags':
      input = <TagsInput id={id} value={(value as string[]) ?? []} onChange={onChange} />;
      break;
    case 'person':
      input = (
        <Select {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="max-w-72">
          <option value="">—</option>
          {(users ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      );
      break;
    default:
      input = <TextInput {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <Field
      label={label}
      help={field.help}
      error={error}
      htmlFor={id}
      aside={aside}
      className={field.type === 'longtext' ? 'sm:col-span-2' : undefined}
    >
      {input}
    </Field>
  );
}
