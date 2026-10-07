import { coverShape, type Figure, isNumericType, LINE_STYLES, type TemplateData } from '@precious/shared';
import { Figures } from '../../components/Figures.tsx';
import { ItemCard } from '../../components/ItemCard.tsx';
import { Button, Caps, cx, IconButton, Select, TextInput } from '../../components/ui.tsx';
import { ItemView } from '../items/ItemView.tsx';
import { CoverShapePicker } from './CoverShapePicker.tsx';
import { move, sampleItem } from './editorUtils.ts';
import { RefList, RefSelect } from './RefPicker.tsx';

type SetT = (patch: Partial<TemplateData>) => void;

const STYLE_LABELS = { title: 'Title', normal: 'Normal', muted: 'Muted', value: 'Value (gold)' } as const;

export function CardTab({ t, set }: { t: TemplateData; set: SetT }) {
  const card = t.card;
  const setCard = (c: Partial<TemplateData['card']>) => set({ card: { ...card, ...c } });
  const setLine = (i: number, l: Partial<TemplateData['card']['lines'][number]>) =>
    setCard({ lines: card.lines.map((x, j) => (j === i ? { ...x, ...l } : x)) });
  return (
    <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
      <div className="grid content-start gap-5">
        <CoverShapePicker value={coverShape(card)} onChange={(cover) => setCard({ cover })} />
        <div className="grid gap-2">
          <Caps>On the cover</Caps>
          {(['tl', 'tr', 'b'] as const).map((pos) => (
            <label key={pos} className="grid grid-cols-[90px_1fr] items-center gap-2.5 text-[0.88rem] text-ink-muted">
              {{ tl: 'Top left', tr: 'Top right', b: 'Bottom' }[pos]}
              <RefSelect
                label={`Cover ${pos}`}
                value={card.slots[pos]}
                fields={t.fields}
                onChange={(v) => setCard({ slots: { ...card.slots, [pos]: v } })}
              />
            </label>
          ))}
        </div>
        <div className="grid gap-2">
          <Caps>Under the cover</Caps>
          {card.lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
            <div key={i} className="grid gap-2 rounded-[10px] border border-line bg-surface p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <RefList
                  inline
                  max={4}
                  label={`line ${i + 1}`}
                  value={line.fields}
                  fields={t.fields}
                  onChange={(fields) => setLine(i, { fields })}
                />
                <span className="ml-auto flex">
                  <IconButton
                    icon="up"
                    label="Move up"
                    onClick={() => setCard({ lines: move(card.lines, i, -1) })}
                    className="size-7"
                  />
                  <IconButton
                    icon="down"
                    label="Move down"
                    onClick={() => setCard({ lines: move(card.lines, i, 1) })}
                    className="size-7"
                  />
                  <IconButton
                    icon="x"
                    label="Remove line"
                    onClick={() => setCard({ lines: card.lines.filter((_, j) => j !== i) })}
                    className="size-7"
                  />
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Select
                  aria-label="Style"
                  value={line.style}
                  onChange={(e) => setLine(i, { style: e.target.value as (typeof LINE_STYLES)[number] })}
                  className="w-auto py-1 text-[0.85rem]"
                >
                  {LINE_STYLES.map((s) => (
                    <option key={s} value={s}>
                      {STYLE_LABELS[s]}
                    </option>
                  ))}
                </Select>
                <TextInput
                  aria-label="Text before"
                  placeholder="Text before (optional)"
                  value={line.prefix ?? ''}
                  onChange={(e) => setLine(i, { prefix: e.target.value || undefined })}
                  className="max-w-52 py-1 text-[0.85rem]"
                />
              </div>
            </div>
          ))}
          {card.lines.length < 4 && (
            <Button
              icon="plus"
              variant="ghost"
              className="justify-self-start text-accent"
              onClick={() => setCard({ lines: [...card.lines, { fields: ['$title'], style: 'muted' }] })}
            >
              Add a line
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-[repeat(2,minmax(0,160px))] content-start justify-center gap-4 rounded-[14px] border border-line bg-wall p-5">
        <Caps className="col-span-2">Live preview</Caps>
        <ItemCard
          item={sampleItem(t, 'Example item', 1)}
          card={card}
          fields={t.fields}
          to={null}
          collectionName="Collection"
        />
        <ItemCard
          item={sampleItem(t, 'Another example with a longer title', 2)}
          card={card}
          fields={t.fields}
          to={null}
          collectionName="Collection"
        />
      </div>
    </div>
  );
}

export function ItemPageTab({ t, set }: { t: TemplateData; set: SetT }) {
  const layout = t.itemLayout;
  const setLayout = (l: Partial<TemplateData['itemLayout']>) => set({ itemLayout: { ...layout, ...l } });
  const setSection = (i: number, s: Partial<TemplateData['itemLayout']['sections'][number]>) =>
    setLayout({ sections: layout.sections.map((x, j) => (j === i ? { ...x, ...s } : x)) });
  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-2">
          <Caps>Info box, beside the cover</Caps>
          <RefList label="info box" value={layout.info} fields={t.fields} onChange={(info) => setLayout({ info })} />
        </div>
        <div className="grid content-start gap-2">
          <Caps>Sections, below</Caps>
          {layout.sections.map((s, i) => (
            <div key={s.id} className="grid gap-2 rounded-[10px] border border-line bg-surface p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <TextInput
                  aria-label="Section title"
                  value={s.title}
                  onChange={(e) => setSection(i, { title: e.target.value })}
                  className="max-w-56 py-1 font-semibold"
                />
                <Select
                  aria-label="Shown as"
                  value={s.type}
                  onChange={(e) => setSection(i, { type: e.target.value as 'fields' | 'text' })}
                  className="w-auto py-1 text-[0.85rem]"
                >
                  <option value="fields">Figures</option>
                  <option value="text">Paragraphs</option>
                </Select>
                <label className="flex items-center gap-1.5 text-[0.82rem] text-ink-muted">
                  <input
                    type="checkbox"
                    checked={s.wide}
                    onChange={(e) => setSection(i, { wide: e.target.checked })}
                    className="accent-[var(--accent)]"
                  />
                  Full width
                </label>
                <span className="ml-auto flex">
                  <IconButton
                    icon="up"
                    label="Move up"
                    onClick={() => setLayout({ sections: move(layout.sections, i, -1) })}
                    className="size-7"
                  />
                  <IconButton
                    icon="down"
                    label="Move down"
                    onClick={() => setLayout({ sections: move(layout.sections, i, 1) })}
                    className="size-7"
                  />
                  <IconButton
                    icon="x"
                    label="Remove section"
                    onClick={() => setLayout({ sections: layout.sections.filter((_, j) => j !== i) })}
                    className="size-7"
                  />
                </span>
              </div>
              <RefList
                inline
                label={s.title}
                value={s.fields}
                fields={t.fields}
                onChange={(fields) => setSection(i, { fields })}
              />
            </div>
          ))}
          {layout.sections.length < 12 && (
            <Button
              icon="plus"
              variant="ghost"
              className="justify-self-start text-accent"
              onClick={() =>
                setLayout({
                  sections: [
                    ...layout.sections,
                    {
                      id: `s${Date.now().toString(36)}`,
                      type: 'fields',
                      title: 'New section',
                      fields: ['$added'],
                      wide: false,
                    },
                  ],
                })
              }
            >
              Add a section
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-2">
        <Caps>Live preview</Caps>
        <div className="dark-scope rounded-[14px] border border-line p-5">
          <ItemView
            item={sampleItem(t, 'Example item')}
            fields={t.fields}
            layout={layout}
            shape={coverShape(t.card)}
            collectionName="Collection"
          />
        </div>
      </div>
    </div>
  );
}

const KIND_LABELS = {
  count: 'Number of items',
  sum: 'Total of a field',
  avg: 'Average of a field',
  countWhere: 'Items where…',
} as const;

export function HeaderTab({ t, set }: { t: TemplateData; set: SetT }) {
  const figures = t.header.figures;
  const setFigures = (f: Figure[]) => set({ header: { figures: f } });
  const numeric = t.fields.filter((f) => !f.hidden && isNumericType(f.type));
  const countable = t.fields.filter(
    (f) => !f.hidden && ['choice', 'multichoice', 'tags', 'boolean', 'text'].includes(f.type),
  );

  function changeKind(i: number, kind: Figure['kind']) {
    const old = figures[i] as Figure;
    const base = { id: old.id, label: old.label };
    const next: Figure =
      kind === 'count'
        ? { ...base, kind }
        : kind === 'countWhere'
          ? { ...base, kind, field: countable[0]?.id ?? '', equals: countable[0]?.options.choices?.[0] ?? '' }
          : { ...base, kind, field: numeric[0]?.id ?? '' };
    setFigures(figures.map((f, j) => (j === i ? next : f)));
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        {figures.map((fig, i) => {
          const field = 'field' in fig ? t.fields.find((f) => f.id === fig.field) : undefined;
          return (
            <div
              key={fig.id}
              className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface p-2.5"
            >
              <TextInput
                aria-label="Label"
                value={fig.label}
                onChange={(e) => setFigures(figures.map((f, j) => (j === i ? { ...f, label: e.target.value } : f)))}
                className="max-w-48 py-1 font-semibold"
              />
              <Select
                aria-label="Shows"
                value={fig.kind}
                onChange={(e) => changeKind(i, e.target.value as Figure['kind'])}
                className="w-auto py-1 text-[0.85rem]"
              >
                {(Object.keys(KIND_LABELS) as Figure['kind'][]).map((k) => (
                  <option key={k} value={k} disabled={(k === 'sum' || k === 'avg') && numeric.length === 0}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
              {fig.kind !== 'count' && (
                <Select
                  aria-label="Field"
                  value={fig.field}
                  onChange={(e) =>
                    setFigures(figures.map((f, j) => (j === i ? ({ ...f, field: e.target.value } as Figure) : f)))
                  }
                  className="w-auto py-1 text-[0.85rem]"
                >
                  {(fig.kind === 'countWhere' ? countable : numeric).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              )}
              {fig.kind === 'countWhere' && (
                <>
                  <span className="text-[0.85rem] text-ink-muted">is</span>
                  {field?.type === 'boolean' ? (
                    <Select
                      aria-label="Value"
                      value={String(fig.equals)}
                      onChange={(e) =>
                        setFigures(figures.map((f, j) => (j === i ? { ...fig, equals: e.target.value === 'true' } : f)))
                      }
                      className="w-auto py-1 text-[0.85rem]"
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </Select>
                  ) : field?.options.choices ? (
                    <Select
                      aria-label="Value"
                      value={String(fig.equals)}
                      onChange={(e) =>
                        setFigures(figures.map((f, j) => (j === i ? { ...fig, equals: e.target.value } : f)))
                      }
                      className="w-auto py-1 text-[0.85rem]"
                    >
                      {field.options.choices.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <TextInput
                      aria-label="Value"
                      value={String(fig.equals)}
                      onChange={(e) =>
                        setFigures(figures.map((f, j) => (j === i ? { ...fig, equals: e.target.value } : f)))
                      }
                      className="max-w-40 py-1 text-[0.85rem]"
                    />
                  )}
                </>
              )}
              <span className="ml-auto flex">
                <IconButton
                  icon="up"
                  label="Move up"
                  onClick={() => setFigures(move(figures, i, -1))}
                  className="size-7"
                />
                <IconButton
                  icon="down"
                  label="Move down"
                  onClick={() => setFigures(move(figures, i, 1))}
                  className="size-7"
                />
                <IconButton
                  icon="x"
                  label="Remove figure"
                  onClick={() => setFigures(figures.filter((_, j) => j !== i))}
                  className="size-7"
                />
              </span>
            </div>
          );
        })}
        {figures.length < 6 && (
          <Button
            icon="plus"
            variant="ghost"
            className={cx('justify-self-start text-accent')}
            onClick={() =>
              setFigures([...figures, { id: `f${Date.now().toString(36)}`, kind: 'count', label: 'Items' }])
            }
          >
            Add a figure
          </Button>
        )}
      </div>
      <div className="grid gap-2">
        <Caps>Live preview (example numbers)</Caps>
        <Figures
          figures={figures.map((f, i) => {
            const field = 'field' in f ? t.fields.find((x) => x.id === f.field) : undefined;
            const format =
              f.kind === 'sum' || f.kind === 'avg'
                ? field?.type === 'money'
                  ? 'money'
                  : field?.type === 'duration'
                    ? 'duration'
                    : 'number'
                : 'count';
            return {
              id: f.id,
              label: f.label,
              value: f.kind === 'count' ? 142 : f.kind === 'countWhere' ? 31 - i : format === 'money' ? 4318.6 : 8412,
              format,
              currency: field?.options.currency,
              unit: field?.options.unit,
            };
          })}
        />
      </div>
    </div>
  );
}
