import {
  type FieldDefinition,
  formatValue,
  type ItemDto,
  type SectionBreak,
  type Shelf as ShelfRules,
  spineSize,
} from '@precious/shared';
import { Link } from '@tanstack/react-router';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { LOCALE } from '../lib/format.ts';
import { placeholderColor } from './Cover.tsx';
import { cx } from './ui.tsx';

/** Neighbours slide this far away from a lifted spine: 1, 2 and 3 spines out. */
const SHIFT = [10, 6, 3];
const TILT_DEG = 8;
const GAP = 2;
const SIDE = 12;

/** Black or white text, whichever reads better on the spine colour. */
function inkFor(color: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return 'rgb(255 255 255 / 0.92)'; // placeholder colours are dark
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.4 ? 'rgb(0 0 0 / 0.82)' : 'rgb(255 255 255 / 0.92)';
}

interface Spine {
  kind: 'spine';
  key: string;
  item: ItemDto;
  w: number;
  h: number;
  lean: boolean;
  /** Extra room a leaning spine needs so it doesn't touch the next one. */
  room: number;
  color: string;
  ink: string;
  subtitle: string;
  size: string;
}

/** A section marker standing between spines, like a library shelf divider. */
interface Divider {
  kind: 'divider';
  key: string;
  label: string;
  depth: number;
  w: number;
  /** A set height; otherwise a little taller than the tallest book on the board. */
  h?: number;
  color?: string;
}

type Entry = Spine | Divider;

/** A section's label hanging from the front of the board its group starts on. */
interface HangingLabel {
  key: string;
  label: string;
  depth: number;
  /** A set width; otherwise as wide as its text. */
  w?: number;
  h: number;
  color?: string;
}

interface Board {
  key: string;
  entries: Entry[];
  labels: HangingLabel[];
}

const DIVIDER_W = [16, 12];
const LABEL_H_CM = 3;

const cmFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/**
 * Items as spines on shelves, sized by the template's rules: drawn to scale for height
 * (8 px a centimetre), with thickness doubled so titles fit. Spines fill the width, then
 * carry on on the next shelf. Hovering or focusing one lifts it, straightens it if it
 * leans, and slides its neighbours apart.
 *
 * With section breaks (a shelf order with marked levels), a labelled divider stands before
 * the first item of each group. Groups of levels that start each on a new board hang a label
 * from the front of that board instead. Both take the level's size and colour, if it has them.
 */
export function Shelf({
  items,
  rules,
  fields,
  breaks,
}: {
  items: ItemDto[];
  rules: ShelfRules;
  fields: FieldDefinition[];
  /** For each item, the section markers before it. */
  breaks?: SectionBreak[][];
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const px = width && width < 640 ? 6.5 : 8;
  const subtitleField = fields.find((f) => f.id === rules.subtitle);

  const spines: Spine[] = useMemo(
    () =>
      items.map((item) => {
        const s = spineSize(rules, item);
        const h = Math.round(s.height * px);
        const w = Math.max(16, Math.round(s.thickness * px * 2));
        const color = item.cover?.color ?? placeholderColor(item.title);
        return {
          kind: 'spine',
          key: item.id,
          item,
          w,
          h,
          lean: s.lean,
          room: s.lean ? Math.ceil(h * Math.sin((TILT_DEG * Math.PI) / 180)) + 4 : 0,
          color,
          ink: inkFor(color),
          subtitle: subtitleField ? formatValue(subtitleField, item.data[subtitleField.id], { locale: LOCALE }) : '',
          size: `${cmFmt.format(s.thickness)} × ${cmFmt.format(s.height)} cm`,
        };
      }),
    [items, rules, px, subtitleField],
  );

  // Fill each shelf to the width, then start the next one. An item and the dividers before it
  // stay together, so a divider never ends a shelf on its own. Groups of levels that start on a new
  // board hang their label from it instead of standing a divider among the books.
  const rows = useMemo(() => {
    const out: Board[] = [];
    const usable = Math.max(120, width - SIDE * 2);
    const cm = (v: number | undefined) => (v === undefined ? undefined : Math.max(3, Math.round(v * px)));
    let row: Board | null = null;
    let used = 0;
    spines.forEach((s, i) => {
      const marks = breaks?.[i] ?? [];
      const unit: Entry[] = [
        ...marks
          .filter((b) => !b.newBoard)
          .map(
            (b): Divider => ({
              kind: 'divider',
              key: `${s.key}-${b.depth}`,
              label: b.label,
              depth: b.depth,
              w: cm(b.style?.width) ?? DIVIDER_W[Math.min(b.depth, DIVIDER_W.length - 1)] ?? 12,
              h: cm(b.style?.height),
              color: b.style?.color,
            }),
          ),
        s,
      ];
      const labels = marks
        .filter((b) => b.newBoard)
        .map(
          (b): HangingLabel => ({
            key: `${s.key}-${b.depth}`,
            label: b.label,
            depth: b.depth,
            w: cm(b.style?.width),
            h: cm(b.style?.height) ?? Math.round(LABEL_H_CM * px),
            color: b.style?.color,
          }),
        );
      const unitWidth =
        unit.reduce((sum, e) => sum + e.w + (e.kind === 'spine' ? e.room : 0), 0) + GAP * (unit.length - 1);
      if (!row || (row.entries.length && (labels.length || used + GAP + unitWidth > usable))) {
        row = { key: s.key, entries: [], labels: [] };
        out.push(row);
        used = 0;
      }
      used += (row.entries.length ? GAP : 0) + unitWidth;
      row.entries.push(...unit);
      row.labels.push(...labels);
    });
    return out;
  }, [spines, breaks, width, px]);

  return (
    <div ref={box} className="grid gap-6" onPointerLeave={() => setActive(null)}>
      {width > 0 &&
        rows.map((row) => {
          const at = row.entries.findIndex((e) => e.kind === 'spine' && e.item.id === active);
          const tallest = Math.max(0, ...row.entries.map((e) => (e.kind === 'spine' ? e.h : 0)));
          const hanging = Math.max(0, ...row.labels.map((l) => l.h));
          return (
            <div
              key={row.key}
              // Room above for the lift, and below for labels hanging from the board.
              className="relative flex items-end gap-[2px] px-3 pt-6 pb-2.5"
              style={hanging ? { marginBottom: hanging + 4 } : undefined}
            >
              {row.labels.length > 0 && (
                <div className="absolute inset-x-3 top-full flex items-start gap-1.5">
                  {row.labels.map((l) => {
                    // Section headings under the page's own: the outermost level h2, then h3, h4.
                    const Heading = (['h2', 'h3', 'h4'] as const)[Math.min(l.depth, 2)] ?? 'h4';
                    return (
                      <Heading
                        key={l.key}
                        title={l.label}
                        className={cx(
                          'm-0 flex items-center overflow-hidden rounded-b-[4px] leading-none font-bold tracking-[0.08em] whitespace-nowrap uppercase shadow-object',
                          !l.color &&
                            (l.depth === 0
                              ? 'bg-accent text-accent-ink'
                              : 'border border-t-0 border-line bg-surface text-ink'),
                          l.w ? 'justify-center px-1' : 'px-2.5',
                        )}
                        style={{
                          width: l.w,
                          height: l.h,
                          maxWidth: l.w ? undefined : '60%',
                          fontSize: Math.min(11, Math.max(7, Math.round(l.h * 0.5))),
                          ...(l.color && { background: l.color, color: inkFor(l.color) }),
                          // The clip holding it to the board.
                          boxShadow: 'inset 0 2px 0 rgb(0 0 0 / 0.18), 0 2px 4px -2px rgb(0 0 0 / 0.35)',
                        }}
                      >
                        <span className="overflow-hidden text-ellipsis">{l.label}</span>
                      </Heading>
                    );
                  })}
                </div>
              )}
              {row.entries.map((e, i) => {
                const d = at < 0 ? 0 : i - at;
                const shift =
                  at < 0 || d === 0 || Math.abs(d) > SHIFT.length ? 0 : Math.sign(d) * (SHIFT[Math.abs(d) - 1] ?? 0);
                if (e.kind === 'divider') {
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: a divider plate that shows its label, which an <hr> can't hold
                    <div
                      key={e.key}
                      role="separator"
                      aria-label={e.label}
                      title={e.label}
                      className={cx(
                        'spine flex flex-none items-start justify-center overflow-hidden rounded-t-[4px] border border-b-0 pt-2 shadow-object',
                        e.color
                          ? 'border-transparent'
                          : e.depth === 0
                            ? 'border-accent bg-accent text-accent-ink'
                            : 'border-line bg-surface text-ink',
                      )}
                      style={{
                        width: e.w,
                        // Unless set, dividers stand a little above the books, the outermost ones most.
                        height: e.h ?? tallest + (e.depth === 0 ? 14 : 6),
                        transform: `translateX(${shift}px)`,
                        ...(e.color && { background: e.color, color: inkFor(e.color) }),
                      }}
                    >
                      <span
                        className={cx(
                          'overflow-hidden leading-none font-bold tracking-[0.08em] text-ellipsis whitespace-nowrap uppercase [writing-mode:vertical-rl] rotate-180',
                          e.depth === 0 ? 'text-[0.62rem]' : 'text-[0.56rem]',
                        )}
                      >
                        {e.label}
                      </span>
                    </div>
                  );
                }
                const s = e;
                const up = at >= 0 && d === 0;
                return (
                  <Link
                    key={s.item.id}
                    to="/i/$itemId"
                    params={{ itemId: s.item.id }}
                    aria-label={s.item.title}
                    title={`${s.item.title} · ${s.size}`}
                    onPointerEnter={() => setActive(s.item.id)}
                    onFocus={() => setActive(s.item.id)}
                    onBlur={() => setActive(null)}
                    className={cx(
                      'spine relative flex flex-none flex-col items-center justify-between rounded-t-[2px] pt-2 pb-1.5 no-underline outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      up ? 'z-[2]' : 'z-[1]',
                    )}
                    style={
                      {
                        width: s.w,
                        height: s.h,
                        marginRight: s.room,
                        background: s.color,
                        color: s.ink,
                        // A leaning book rests on its bottom-right corner against its neighbour.
                        transformOrigin: 'bottom right',
                        transform: `translateX(${shift}px) translateY(${up ? -16 : 0}px) rotate(${s.lean && !up ? TILT_DEG : 0}deg)`,
                        boxShadow: 'inset -2px 0 0 rgb(0 0 0 / 0.14), inset 2px 0 0 rgb(255 255 255 / 0.12)',
                        viewTransitionName: `cover-${s.item.id}`,
                      } as CSSProperties
                    }
                  >
                    <span
                      className={cx(
                        'min-h-0 flex-1 overflow-hidden leading-none font-[650] text-ellipsis whitespace-nowrap [font-stretch:75%] [writing-mode:vertical-rl] rotate-180',
                        s.w < 20 ? 'text-[0.62rem]' : 'text-[0.74rem]',
                      )}
                    >
                      {s.item.title}
                    </span>
                    {s.subtitle && s.h > 90 && (
                      <span className="mt-1.5 max-h-[45%] flex-none overflow-hidden text-[0.56rem] leading-none tracking-[0.06em] text-ellipsis whitespace-nowrap uppercase opacity-75 [writing-mode:vertical-rl] rotate-180">
                        {s.subtitle}
                      </span>
                    )}
                  </Link>
                );
              })}
              <div
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-2.5 rounded-b-[6px] border-t border-line bg-surface-sunk"
              />
            </div>
          );
        })}
    </div>
  );
}
