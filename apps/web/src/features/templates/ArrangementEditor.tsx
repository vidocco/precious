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
} from '@precious/shared';
import { Button, IconButton, Select } from '../../components/ui.tsx';
import { move } from './editorUtils.ts';

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
            <div className="flex flex-wrap items-center gap-2 text-[0.85rem] text-ink-muted">
              <span className="w-12 flex-none">{i === 0 ? 'By' : 'then'}</span>
              <Select
                aria-label={`Level ${i + 1}`}
                value={level.ref}
                onChange={(e) => setLevel(i, { ref: e.target.value })}
                className="w-auto min-w-36 py-1"
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
                className="w-36 py-1"
              >
                <option value="asc">{up}</option>
                <option value="desc">{down}</option>
              </Select>
              <span className="ml-auto flex">
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
