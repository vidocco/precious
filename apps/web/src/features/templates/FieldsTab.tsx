import { type FieldDefinition, type FieldType, fieldSchema, makeFieldId } from '@precious/shared';
import { useState } from 'react';
import { Button, cx, IconButton, Select, TextArea, TextInput } from '../../components/ui.tsx';
import { allowedTypes, move, TYPE_LABELS } from './editorUtils.ts';

function Options({ field, onChange }: { field: FieldDefinition; onChange: (f: FieldDefinition) => void }) {
  const set = (o: Partial<FieldDefinition['options']>) => onChange({ ...field, options: { ...field.options, ...o } });
  const num = (v: string) => (v === '' ? undefined : Number(v));
  switch (field.type) {
    case 'choice':
    case 'multichoice':
      return (
        <label className="grid gap-1 text-[0.78rem] text-ink-muted">
          Choices, one per line
          <TextArea
            rows={3}
            value={(field.options.choices ?? []).join('\n')}
            onChange={(e) =>
              set({
                choices: e.target.value
                  .split('\n')
                  .map((c) => c.trimStart())
                  .filter((c, i, a) => c !== '' || i === a.length - 1),
              })
            }
            onBlur={(e) =>
              set({
                choices: [
                  ...new Set(
                    e.target.value
                      .split('\n')
                      .map((c) => c.trim())
                      .filter(Boolean),
                  ),
                ],
              })
            }
            className="min-h-20 text-[0.88rem]"
          />
        </label>
      );
    case 'money':
      return (
        <label className="flex items-center gap-2 text-[0.78rem] text-ink-muted">
          Currency
          <TextInput
            value={field.options.currency ?? 'EUR'}
            maxLength={3}
            onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
            className="w-20 py-1"
          />
        </label>
      );
    case 'number':
      return (
        <div className="flex flex-wrap gap-3 text-[0.78rem] text-ink-muted">
          <label className="flex items-center gap-2">
            Unit
            <TextInput
              value={field.options.unit ?? ''}
              placeholder="cm, g…"
              onChange={(e) => set({ unit: e.target.value || undefined })}
              className="w-24 py-1"
            />
          </label>
          <label className="flex items-center gap-2">
            Min
            <TextInput
              type="number"
              value={field.options.min ?? ''}
              onChange={(e) => set({ min: num(e.target.value) })}
              className="w-24 py-1"
            />
          </label>
          <label className="flex items-center gap-2">
            Max
            <TextInput
              type="number"
              value={field.options.max ?? ''}
              onChange={(e) => set({ max: num(e.target.value) })}
              className="w-24 py-1"
            />
          </label>
        </div>
      );
    case 'rating':
      return (
        <label className="flex items-center gap-2 text-[0.78rem] text-ink-muted">
          Out of
          <Select
            value={field.options.max ?? 5}
            onChange={(e) => set({ max: Number(e.target.value) })}
            className="w-24 py-1"
          >
            {[3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
      );
    default:
      return null;
  }
}

export function FieldsTab({
  fields,
  saved,
  onChange,
}: {
  fields: FieldDefinition[];
  saved: FieldDefinition[];
  onChange: (f: FieldDefinition[]) => void;
}) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<FieldType>('text');
  const update = (i: number, f: FieldDefinition) => onChange(fields.map((x, j) => (j === i ? f : x)));

  function add() {
    if (!label.trim()) return;
    const id = makeFieldId(
      label,
      fields.map((f) => f.id),
    );
    const f = fieldSchema.parse({
      id,
      label: label.trim(),
      type,
      options:
        type === 'choice' || type === 'multichoice'
          ? { choices: ['Option 1'] }
          : type === 'money'
            ? { currency: 'EUR' }
            : {},
    });
    onChange([...fields, f]);
    setLabel('');
  }

  return (
    <div className="grid gap-3">
      <p className="text-[0.88rem] text-ink-muted">
        Removing a field that items already use hides it instead, so its values can come back. A field’s type can only
        change to one that keeps existing values valid.
      </p>
      {fields.map((f, i) => {
        const before = saved.find((s) => s.id === f.id);
        return (
          <div
            key={f.id}
            className={cx('grid gap-2.5 rounded-[12px] border border-line bg-surface p-3', f.hidden && 'opacity-55')}
          >
            <div className="flex flex-wrap items-center gap-2">
              <TextInput
                aria-label="Field name"
                value={f.label}
                onChange={(e) => update(i, { ...f, label: e.target.value })}
                className="max-w-64 flex-[1_1_180px] py-1.5 font-semibold"
                disabled={f.hidden}
              />
              <Select
                aria-label="Type"
                value={f.type}
                onChange={(e) => update(i, { ...f, type: e.target.value as FieldType })}
                className="w-auto py-1.5"
                disabled={f.hidden}
              >
                {allowedTypes(before).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1.5 text-[0.85rem] text-ink-muted">
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={(e) => update(i, { ...f, required: e.target.checked })}
                  disabled={f.hidden}
                  className="accent-[var(--accent)]"
                />
                Required
              </label>
              <span className="text-[0.72rem] text-ink-faint" title="Stored as">
                {f.id}
              </span>
              <span className="ml-auto flex">
                <IconButton
                  icon="up"
                  label="Move up"
                  onClick={() => onChange(move(fields, i, -1))}
                  className="size-8"
                />
                <IconButton
                  icon="down"
                  label="Move down"
                  onClick={() => onChange(move(fields, i, 1))}
                  className="size-8"
                />
                {before ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={f.hidden ? 'eye' : 'eyeOff'}
                    onClick={() => update(i, { ...f, hidden: !f.hidden })}
                  >
                    {f.hidden ? 'Restore' : 'Hide'}
                  </Button>
                ) : (
                  <IconButton
                    icon="trash"
                    label="Remove field"
                    onClick={() => onChange(fields.filter((_, j) => j !== i))}
                    className="size-8"
                  />
                )}
              </span>
            </div>
            {!f.hidden && <Options field={f} onChange={(nf) => update(i, nf)} />}
          </div>
        );
      })}
      <form
        className="flex flex-wrap items-center gap-2 rounded-[12px] border-[1.5px] border-dashed border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <TextInput
          aria-label="New field name"
          placeholder="New field name"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="max-w-64 flex-[1_1_180px] py-1.5"
        />
        <Select
          aria-label="New field type"
          value={type}
          onChange={(e) => setType(e.target.value as FieldType)}
          className="w-auto py-1.5"
        >
          {(Object.keys(TYPE_LABELS) as FieldType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Button type="submit" icon="plus" disabled={!label.trim()}>
          Add field
        </Button>
      </form>
    </div>
  );
}
