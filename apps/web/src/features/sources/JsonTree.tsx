import { useState } from 'react';
import { cx } from '../../components/ui.tsx';

export type PathSegment = string | number;

/** A JSONata path for the given segments, without array indexes (so it maps every element). */
export function toJsonataPath(segments: PathSegment[]): string {
  return segments
    .filter((s) => typeof s === 'string')
    .map((s) => (/^[A-Za-z_$][\w$]*$/.test(s as string) ? s : `\`${s}\``))
    .join('.');
}

const MAX_CHILDREN = 50;

function Leaf({ value }: { value: unknown }) {
  if (value === null) return <span className="text-ink-faint italic">null</span>;
  if (typeof value === 'string') {
    return <span className="break-all text-ok">"{value.length > 200 ? `${value.slice(0, 200)}…` : value}"</span>;
  }
  if (typeof value === 'number' || typeof value === 'boolean')
    return <span className="font-semibold text-gilt">{String(value)}</span>;
  return <span className="text-ink-faint">{String(value)}</span>;
}

function Node({
  name,
  value,
  path,
  depth,
  onPick,
  selected,
  startOpen,
}: {
  name: PathSegment | null;
  value: unknown;
  path: PathSegment[];
  depth: number;
  onPick?: (path: PathSegment[]) => void;
  selected?: string;
  startOpen?: boolean;
}) {
  // Lists open by default (results usually live in one); only 50 entries render anyway.
  const [open, setOpen] = useState(startOpen ?? (depth < 2 || (Array.isArray(value) && depth < 6)));
  const isObj = value !== null && typeof value === 'object';
  const entries: [PathSegment, unknown][] = isObj
    ? Array.isArray(value)
      ? value.map((v, i) => [i, v])
      : Object.entries(value as Record<string, unknown>)
    : [];
  const key =
    name === null ? null : typeof name === 'number' ? (
      <span className="text-ink-faint">[{name}]</span>
    ) : (
      <button
        type="button"
        onClick={() => onPick?.(path)}
        disabled={!onPick}
        title={onPick ? `Use ${toJsonataPath(path)}` : undefined}
        className={cx(
          'rounded-[3px] font-semibold text-ink',
          onPick && 'hover:bg-accent/20',
          selected === toJsonataPath(path) && 'bg-accent/20',
        )}
      >
        "{name}"
      </button>
    );
  if (!isObj) {
    return (
      <div className="flex gap-1.5" style={{ paddingLeft: depth * 14 }}>
        {key}
        {key && <span className="text-ink-faint">:</span>}
        <Leaf value={value} />
      </div>
    );
  }
  const brackets = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return (
    <div>
      <div className="flex items-center gap-1.5" style={{ paddingLeft: depth * 14 }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="w-3 text-ink-faint"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? '▾' : '▸'}
        </button>
        {key}
        {key && <span className="text-ink-faint">:</span>}
        <span className="text-ink-faint">
          {brackets[0]}
          {!open && ` ${entries.length} ${Array.isArray(value) ? 'items' : 'keys'} ${brackets[1]}`}
        </span>
      </div>
      {open && (
        <>
          {entries.slice(0, MAX_CHILDREN).map(([k, v]) => (
            <Node
              key={String(k)}
              name={k}
              value={v}
              path={[...path, k]}
              depth={depth + 1}
              onPick={onPick}
              selected={selected}
              // The first item of a list (and everything inside it) starts open, so a
              // sample result's keys are ready to click.
              startOpen={(k === 0 || startOpen) && depth < 6 ? true : undefined}
            />
          ))}
          {entries.length > MAX_CHILDREN && (
            <div className="text-ink-faint italic" style={{ paddingLeft: (depth + 1) * 14 }}>
              … {entries.length - MAX_CHILDREN} more
            </div>
          )}
          <div className="text-ink-faint" style={{ paddingLeft: depth * 14 + 18 }}>
            {brackets[1]}
          </div>
        </>
      )}
    </div>
  );
}

/** A collapsible JSON view. Clicking a key reports its path, for building mappings. */
export function JsonTree({
  value,
  onPick,
  selected,
}: {
  value: unknown;
  onPick?: (path: PathSegment[]) => void;
  selected?: string;
}) {
  return (
    <div className="text-[0.8rem] leading-[1.7] tabular">
      <Node name={null} value={value} path={[]} depth={0} onPick={onPick} selected={selected} />
    </div>
  );
}
