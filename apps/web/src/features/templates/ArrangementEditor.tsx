import {
  ARRANGE_MAX_LEVELS,
  ARRANGE_SYSTEM_REFS,
  type ArrangeLevel,
  type Arrangement,
  arrangementIssues,
  canArrangeBy,
  describeArrangement,
  type FieldDefinition,
  isNumericType,
  type MarkerStyle,
  markerStyleSchema,
} from '@precious/shared';
import { Button, IconButton, Select, TextInput } from '../../components/ui.tsx';
import { move } from './editorUtils.ts';

/**
 * A marked level's look: a divider among the books, or, for levels that start each group on a new
 * board, a label hanging from it. Sizes in centimetres at the books' scale; empty means the default.
 */
function MarkerLook({
  level,
  n,
  onChange,
}: {
  level: ArrangeLevel;
  n: number;
  onChange: (style: MarkerStyle | undefined) => void;
}) {
  const style = level.markerStyle ?? {};
  const set = (patch: Partial<MarkerStyle>) => {
    const next: MarkerStyle = { ...style, ...patch };
    if (next.width === undefined) delete next.width;
    if (next.height === undefined) delete next.height;
    if (next.color === undefined) delete next.color;
    onChange(Object.keys(next).length ? next : undefined);
  };
  const size = (v: string) => (v === '' ? undefined : Number(v));
  const problem = markerStyleSchema.safeParse(style).error?.issues[0]?.message;
  const label = level.newBoard;
  return (
    <div className="grid gap-1 pl-14">
      <div className="flex flex-wrap items-center gap-2 text-[0.85rem] text-ink-muted">
        <span className="w-14">{label ? 'Label' : 'Divider'}</span>
        <TextInput
          type="number"
          inputMode="decimal"
          min={0.2}
          step={0.1}
          aria-label={`Level ${n} marker width`}
          placeholder={label ? 'auto' : '2'}
          value={style.width ?? ''}
          onChange={(e) => set({ width: size(e.target.value) })}
          className="w-20 py-1 text-right tabular"
        />
        ×
        <TextInput
          type="number"
          inputMode="decimal"
          min={0.5}
          step={0.1}
          aria-label={`Level ${n} marker height`}
          placeholder={label ? '3' : 'auto'}
          value={style.height ?? ''}
          onChange={(e) => set({ height: size(e.target.value) })}
          className="w-20 py-1 text-right tabular"
        />
        cm
        <label className="ml-2 flex items-center gap-1.5">
          Colour
          <input
            type="color"
            aria-label={`Level ${n} marker colour`}
            value={style.color ?? '#8a8f98'}
            onChange={(e) => set({ color: e.target.value })}
            className="h-7 w-9 cursor-pointer rounded-[6px] border border-line bg-surface p-0.5"
          />
          {!style.color && <span className="text-ink-faint">default</span>}
        </label>
        {level.markerStyle && (
          <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
            Default look
          </Button>
        )}
      </div>
      {problem && <span className="text-[0.8rem] text-danger">{problem}</span>}
    </div>
  );
}

function dirLabels(ref: string, fields: FieldDefinition[]): [string, string] {
  if (ref === '$added') return ['Oldest first', 'Newest first'];
  const f = fields.find((x) => x.id === ref);
  if (ref === '$accession' || (f && isNumericType(f.type))) return ['Low to high', 'High to low'];
  if (f?.type === 'date') return ['Earliest first', 'Latest first'];
  return ['A to Z', 'Z to A'];
}

/**
 * Levels of grouping and order, outermost first: Genre, then Author, then Series, then
 * Title. Each level chooses whether a section marker shows where its groups start, and a
 * marked level can start each group on a new board.
 */
export function ArrangementEditor({
  value,
  onChange,
  fields,
}: {
  value: Arrangement;
  onChange: (v: Arrangement) => void;
  fields: FieldDefinition[];
}) {
  const usable = fields.filter((f) => !f.hidden && canArrangeBy(f));
  const options = [
    ...usable.map((f) => ({ value: f.id, label: f.label })),
    ...Object.entries(ARRANGE_SYSTEM_REFS).map(([value, label]) => ({ value, label })),
  ];
  const setLevel = (i: number, patch: Partial<ArrangeLevel>) =>
    onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const unused = options.find((o) => !value.some((l) => l.ref === o.value));
  const issues = arrangementIssues(value, fields, []);
  // Levels have no ids of their own: they're keyed by position, once.
  const rows = value.map((level, i) => ({ level, i, key: `level-${i}` }));

  return (
    <div className="grid gap-2">
      {rows.map(({ level, i, key }) => {
        const [up, down] = dirLabels(level.ref, fields);
        const problem = issues.find((x) => x.path[0] === i)?.message;
        return (
          <div key={key} className="grid gap-2 rounded-[10px] border border-line bg-surface p-2.5">
            <div className="flex flex-wrap items-center gap-2 text-[0.85rem] text-ink-muted sm:flex-nowrap">
              <span className="w-12 flex-none">{i === 0 ? 'By' : 'then'}</span>
              <Select
                aria-label={`Level ${i + 1}`}
                value={level.ref}
                onChange={(e) => setLevel(i, { ref: e.target.value })}
                className="min-w-0 flex-1 py-1"
              >
                {!options.some((o) => o.value === level.ref) && <option value={level.ref}>{level.ref}</option>}
                {options.map((o) => (
                  <option key={o.value} value={o.value} disabled={value.some((l, j) => j !== i && l.ref === o.value)}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={`Level ${i + 1} order`}
                value={level.dir}
                onChange={(e) => setLevel(i, { dir: e.target.value as 'asc' | 'desc' })}
                className="w-36 flex-none py-1"
              >
                <option value="asc">{up}</option>
                <option value="desc">{down}</option>
              </Select>
              <span className="ml-auto flex flex-none">
                <IconButton
                  icon="up"
                  label="Move up"
                  onClick={() => onChange(move(value, i, -1))}
                  disabled={i === 0}
                  className="size-7 disabled:opacity-30"
                />
                <IconButton
                  icon="down"
                  label="Move down"
                  onClick={() => onChange(move(value, i, 1))}
                  disabled={i === value.length - 1}
                  className="size-7 disabled:opacity-30"
                />
                <IconButton
                  icon="x"
                  label="Remove level"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  className="size-7"
                />
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-14 text-[0.85rem] text-ink-muted">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={level.marker}
                  onChange={(e) =>
                    setLevel(i, { marker: e.target.checked, newBoard: e.target.checked && level.newBoard })
                  }
                  className="accent-[var(--accent)]"
                />
                Section marker
              </label>
              {level.marker && (
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={level.newBoard}
                    onChange={(e) => setLevel(i, { newBoard: e.target.checked })}
                    className="accent-[var(--accent)]"
                  />
                  Each on a new board
                </label>
              )}
            </div>
            {level.marker && (
              <MarkerLook level={level} n={i + 1} onChange={(markerStyle) => setLevel(i, { markerStyle })} />
            )}
            {problem && <span className="text-[0.8rem] text-danger">{problem}</span>}
          </div>
        );
      })}
      {value.length < ARRANGE_MAX_LEVELS && unused && (
        <Button
          icon="plus"
          variant="ghost"
          className="justify-self-start text-accent"
          onClick={() => onChange([...value, { ref: unused.value, dir: 'asc', marker: false, newBoard: false }])}
        >
          {value.length ? 'Add a level' : 'Arrange the shelf'}
        </Button>
      )}
      <p className="text-[0.82rem] text-ink-muted">
        {value.length
          ? `${describeArrangement(value, fields)}${value.some((l) => l.marker) ? '' : '. No section markers.'}`
          : 'No shelf order: items follow the sort menu, newest first.'}
      </p>
    </div>
  );
}
