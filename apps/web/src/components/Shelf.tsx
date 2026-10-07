import { type FieldDefinition, formatValue, type ItemDto, type Shelf as ShelfRules, spineSize } from '@precious/shared';
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

const cmFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/**
 * Items as spines on shelves, sized by the template's rules: drawn to scale for height
 * (8 px a centimetre), with thickness doubled so titles fit. Spines fill the width, then
 * carry on on the next shelf. Hovering or focusing one lifts it, straightens it if it
 * leans, and slides its neighbours apart.
 */
export function Shelf({ items, rules, fields }: { items: ItemDto[]; rules: ShelfRules; fields: FieldDefinition[] }) {
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

  // Fill each shelf to the width, then start the next one.
  const rows = useMemo(() => {
    const out: Spine[][] = [];
    const usable = Math.max(120, width - SIDE * 2);
    let row: Spine[] = [];
    let used = 0;
    for (const s of spines) {
      const need = s.w + s.room + (row.length ? GAP : 0);
      if (row.length && used + need > usable) {
        out.push(row);
        row = [];
        used = 0;
      }
      row.push(s);
      used += s.w + s.room + (row.length > 1 ? GAP : 0);
    }
    if (row.length) out.push(row);
    return out;
  }, [spines, width]);

  return (
    <div ref={box} className="grid gap-6" onPointerLeave={() => setActive(null)}>
      {width > 0 &&
        rows.map((row) => {
          const at = row.findIndex((s) => s.item.id === active);
          return (
            <div
              key={row[0]?.item.id}
              // Room above for the lift.
              className="relative flex items-end gap-[2px] px-3 pt-6 pb-2.5"
            >
              {row.map((s, i) => {
                const d = at < 0 ? 0 : i - at;
                const shift =
                  at < 0 || d === 0 || Math.abs(d) > SHIFT.length ? 0 : Math.sign(d) * (SHIFT[Math.abs(d) - 1] ?? 0);
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
