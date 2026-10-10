import { buildItemSchema, type FieldDefinition, type ItemDto } from '@precious/shared';
import { useBlocker } from '@tanstack/react-router';
import { useState } from 'react';
import { Button as AriaButton, Checkbox, CheckboxGroup, Dialog, DialogTrigger, Popover } from 'react-aria-components';
import { ApiError, errorMessage } from '../../api/client.ts';
import { useItemMutations, useUsers } from '../../api/queries.ts';
import { Icon } from '../../components/Icon.tsx';
import { cx, Select, TextInput } from '../../components/ui.tsx';
import { DurationInput, type FormValue } from '../items/FieldInput.tsx';

/** Cells changed in the table, as typed: by item id, then field id ($title for the title). */
type Drafts = Record<string, Record<string, FormValue>>;

const cellKey = (itemId: string, ref: string) => `${itemId}/${ref}`;
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const items = (n: number) => (n === 1 ? '1 item' : `${n} items`);

/** Tags are typed as text, separated by commas. */
const splitTags = (v: string) =>
  v
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

/** A cell's value as item data; null clears it. */
function toData(field: FieldDefinition | undefined, v: FormValue): unknown {
  const value = field?.type === 'tags' && typeof v === 'string' ? splitTags(v) : v;
  return isEmpty(value) ? null : value;
}

function same(field: FieldDefinition | undefined, typed: FormValue, stored: unknown): boolean {
  if (!field) return String(typed ?? '').trim() === String(stored ?? '');
  const norm = (v: unknown) => (isEmpty(v) ? null : v);
  return JSON.stringify(norm(toData(field, typed))) === JSON.stringify(norm(stored));
}

/**
 * The table, unlocked: values typed into its cells are kept here until they are saved, all
 * together, or thrown away. Leaving the page with changes not saved asks first.
 */
export function useTableEdits(collectionId: string, fields: FieldDefinition[]) {
  const { updateMany } = useItemMutations();
  const [unlocked, setUnlocked] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const changed = Object.keys(drafts).length;
  const fieldOf = (ref: string) => fields.find((f) => f.id === ref);

  useBlocker({
    disabled: changed === 0,
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname && !window.confirm(`Leave without saving your changes to ${items(changed)}?`),
    enableBeforeUnload: () => changed > 0,
  });

  function reset() {
    setDrafts({});
    setErrors({});
    setError('');
    setUnlocked(false);
  }

  return {
    unlocked,
    changed,
    saving: updateMany.isPending,
    error,
    errorAt: (item: ItemDto, ref: string) => errors[cellKey(item.id, ref)],
    /** What a cell shows: as typed, or as stored. */
    valueAt(item: ItemDto, ref: string): FormValue {
      const typed = drafts[item.id];
      if (typed && ref in typed) return typed[ref];
      return (ref === '$title' ? item.title : item.data[ref]) as FormValue;
    },
    isChanged: (item: ItemDto, ref: string) => !!drafts[item.id] && ref in (drafts[item.id] ?? {}),
    unlock: () => setUnlocked(true),
    /** Locks the table again, throwing away changes not saved (after asking). */
    lock() {
      if (changed && !window.confirm(`Throw away your changes to ${items(changed)}?`)) return;
      reset();
    },
    set(item: ItemDto, ref: string, value: FormValue) {
      const stored = ref === '$title' ? item.title : item.data[ref];
      setDrafts((prev) => {
        const cells = { ...prev[item.id] };
        if (same(fieldOf(ref), value, stored)) delete cells[ref];
        else cells[ref] = value;
        const next = { ...prev };
        if (Object.keys(cells).length) next[item.id] = cells;
        else delete next[item.id];
        return next;
      });
      setErrors(({ [cellKey(item.id, ref)]: _, ...rest }) => rest);
    },
    /** Checks every change, then saves them all at once and locks the table again. */
    async save() {
      const schema = buildItemSchema(fields, { partial: true });
      const found: Record<string, string> = {};
      const changes = Object.entries(drafts).map(([id, cells]) => {
        const { $title, ...rest } = cells;
        const data = Object.fromEntries(Object.entries(rest).map(([ref, v]) => [ref, toData(fieldOf(ref), v)]));
        if ($title !== undefined && !String($title).trim()) found[cellKey(id, '$title')] = 'Give it a title';
        const parsed = schema.safeParse(data);
        if (!parsed.success) for (const i of parsed.error.issues) found[cellKey(id, String(i.path[0]))] = i.message;
        for (const f of fields)
          if (f.required && f.id in data && data[f.id] === null) found[cellKey(id, f.id)] = 'Required';
        return {
          id,
          ...($title !== undefined && { title: String($title) }),
          ...(Object.keys(data).length > 0 && { data }),
        };
      });
      setErrors(found);
      if (Object.keys(found).length) {
        setError('Some values are not valid. Fix the marked cells, then save again.');
        return;
      }
      if (!changes.length) return reset();
      try {
        await updateMany.mutateAsync({ collectionId, items: changes });
        reset();
      } catch (err) {
        setError(errorMessage(err));
        if (err instanceof ApiError) {
          const byCell: Record<string, string> = {};
          for (const [path, message] of Object.entries(err.issues)) {
            const [, i, part, ref] = path.split('.');
            const id = changes[Number(i)]?.id;
            if (id) byCell[cellKey(id, part === 'data' && ref ? ref : '$title')] = message;
          }
          setErrors(byCell);
        }
      }
    },
  };
}

export type TableEdits = ReturnType<typeof useTableEdits>;

function PersonSelect(props: { value: string; onChange: (v: string) => void; label: string; invalid?: boolean }) {
  const { data: users } = useUsers();
  return (
    <Select
      aria-label={props.label}
      aria-invalid={props.invalid}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className="w-auto min-w-36 py-1 text-[0.85rem]"
    >
      <option value="">—</option>
      {(users ?? []).map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </Select>
  );
}

function ChoicesPopover(props: { value: string[]; onChange: (v: string[]) => void; choices: string[]; label: string }) {
  return (
    <DialogTrigger>
      <AriaButton
        aria-label={props.label}
        className="inline-flex max-w-[28ch] min-w-36 items-center justify-between gap-2 rounded-[9px] border border-line bg-wall px-3 py-1 text-left text-[0.85rem] outline-none focus-visible:border-accent"
      >
        <span className="truncate">{props.value.join(', ') || '—'}</span>
        <Icon name="chevron" size={14} />
      </AriaButton>
      <Popover className="max-h-[50vh] w-56 overflow-auto rounded-[12px] border border-line bg-surface p-3 shadow-float">
        <Dialog aria-label={props.label} className="outline-none">
          <CheckboxGroup
            value={props.value}
            onChange={props.onChange}
            aria-label={props.label}
            className="grid gap-1.5"
          >
            {props.choices.map((c) => (
              <Checkbox key={c} value={c} className="group flex cursor-pointer items-center gap-2 text-[0.9rem]">
                <span className="grid size-4 place-items-center rounded-[4px] border border-ink-faint group-data-[selected]:border-accent group-data-[selected]:bg-accent">
                  <svg
                    viewBox="0 0 12 12"
                    className="hidden size-3 fill-none stroke-accent-ink stroke-2 group-data-[selected]:block"
                    aria-hidden="true"
                  >
                    <path d="M2.5 6.5 5 9l4.5-6" />
                  </svg>
                </span>
                {c}
              </Checkbox>
            ))}
          </CheckboxGroup>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

/** One cell of the unlocked table: a small input for the field's type. */
export function CellInput({
  item,
  field,
  edits,
}: {
  item: ItemDto;
  /** Undefined for the title. */
  field?: FieldDefinition;
  edits: TableEdits;
}) {
  const ref = field?.id ?? '$title';
  const value = edits.valueAt(item, ref);
  const set = (v: FormValue) => edits.set(item, ref, v);
  const label = `${field?.label ?? 'Title'} of ${item.title}`;
  const invalid = !!edits.errorAt(item, ref) || undefined;
  const text = 'py-1 text-[0.85rem]';

  switch (field?.type) {
    case 'number':
    case 'money':
      return (
        <TextInput
          type="number"
          step="any"
          inputMode="decimal"
          aria-label={label}
          aria-invalid={invalid}
          min={field.options.min}
          max={field.options.max}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))}
          className={cx('w-28 text-right tabular', text)}
        />
      );
    case 'duration':
      return (
        <DurationInput value={typeof value === 'number' ? value : undefined} onChange={set} label={label} compact />
      );
    case 'date':
      return (
        <TextInput
          type="date"
          aria-label={label}
          aria-invalid={invalid}
          value={String(value ?? '')}
          onChange={(e) => set(e.target.value)}
          className={cx('w-40', text)}
        />
      );
    case 'boolean':
      return (
        <input
          type="checkbox"
          aria-label={label}
          checked={value === true}
          onChange={(e) => set(e.target.checked)}
          className="size-4 accent-[var(--accent)]"
        />
      );
    case 'rating': {
      const max = field.options.max ?? 5;
      return (
        <Select
          aria-label={label}
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))}
          className={cx('w-auto text-gilt', text)}
        >
          <option value="">—</option>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {'★'.repeat(n)}
            </option>
          ))}
        </Select>
      );
    }
    case 'choice': {
      const choices = field.options.choices ?? [];
      const v = String(value ?? '');
      return (
        <Select
          aria-label={label}
          aria-invalid={invalid}
          value={v}
          onChange={(e) => set(e.target.value)}
          className={cx('w-auto min-w-32', text)}
        >
          <option value="">—</option>
          {/* A value from before the choices changed stays until it's changed. */}
          {v && !choices.includes(v) && <option value={v}>{v}</option>}
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      );
    }
    case 'multichoice':
      return (
        <ChoicesPopover
          value={Array.isArray(value) ? value : []}
          onChange={set}
          choices={field.options.choices ?? []}
          label={label}
        />
      );
    case 'tags':
      return (
        <TextInput
          aria-label={label}
          aria-invalid={invalid}
          placeholder="Separated, by, commas"
          value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
          onChange={(e) => set(e.target.value)}
          className={cx('min-w-48', text)}
        />
      );
    case 'person':
      return <PersonSelect value={String(value ?? '')} onChange={set} label={label} invalid={invalid} />;
    default:
      return (
        <TextInput
          type={field?.type === 'url' ? 'url' : 'text'}
          aria-label={label}
          aria-invalid={invalid}
          value={String(value ?? '')}
          onChange={(e) => set(e.target.value)}
          className={cx(field ? 'min-w-40' : 'min-w-56 font-semibold', text)}
        />
      );
  }
}
