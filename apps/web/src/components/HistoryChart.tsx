import { useEffect, useId, useRef, useState } from 'react';
import { cx } from './ui.tsx';

export interface ChartPoint {
  at: Date;
  value: number;
}

/** Clean axis steps: 1, 2, 2.5 or 5 times a power of ten. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const fullDateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * One value over time: a 2px line over a faint wash, the latest value labelled at its
 * end, a crosshair with a readout on hover or with the arrow keys, and the same
 * numbers as a table for anyone who'd rather read them.
 */
export function HistoryChart({
  points,
  format,
  label,
  money,
  height = 180,
  className,
}: {
  points: ChartPoint[];
  format: (n: number) => string;
  /** What is plotted, e.g. "Total value"; names the chart for screen readers. */
  label: string;
  /** Money is drawn in gilt; other numbers in the series blue. */
  money?: boolean;
  height?: number;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [active, setActive] = useState<number | null>(null);
  const gradient = useId();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e?.contentRect.width ?? 600))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length < 2) return null;
  const color = money ? 'var(--chart-value)' : 'var(--chart-series)';
  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const yMin = ticks[0] as number;
  const yMax = ticks.at(-1) as number;
  const tickLabels = ticks.map(format);
  const left = Math.min(96, 12 + Math.max(...tickLabels.map((t) => t.length)) * 7);
  const pad = { top: 14, right: 16, bottom: 26, left };
  const t0 = points[0]?.at.getTime() as number;
  const t1 = points.at(-1)?.at.getTime() as number;
  const x = (d: Date) => pad.left + ((d.getTime() - t0) / (t1 - t0 || 1)) * (width - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - (v - yMin) / (yMax - yMin || 1)) * (height - pad.top - pad.bottom);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const base = y(yMin);
  const area = `${path}L${x(points.at(-1)?.at as Date).toFixed(1)},${base}L${x(points[0]?.at as Date).toFixed(1)},${base}Z`;
  const last = points.at(-1) as ChartPoint;
  const shown = active === null ? null : points[active];

  function nearest(clientX: number) {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const px = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(x((points[i] as ChartPoint).at) - px) < Math.abs(x((points[best] as ChartPoint).at) - px)) best = i;
    }
    setActive(best);
  }

  return (
    <div className={cx('grid min-w-0 gap-1', className)}>
      <div
        ref={box}
        className="relative w-full min-w-0 overflow-hidden touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-[6px]"
        role="img"
        aria-label={`${label}: ${format(points[0]?.value as number)} on ${fullDateFmt.format(points[0]?.at)}, ${format(last.value)} on ${fullDateFmt.format(last.at)}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys move the readout along the line
        tabIndex={0}
        onPointerMove={(e) => nearest(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const from = active ?? points.length - 1;
          setActive(Math.max(0, Math.min(points.length - 1, from + (e.key === 'ArrowLeft' ? -1 : 1))));
        }}
      >
        {/* Drawn at the measured width; the CSS width keeps it from ever pushing its box wider. */}
        <svg width={width} height={height} className="block max-w-full" aria-hidden="true">
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.12" />
              <stop offset="1" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
              <text
                x={pad.left - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-ink-faint text-[0.7rem] tabular"
              >
                {tickLabels[i]}
              </text>
            </g>
          ))}
          {[points[0] as ChartPoint, last].map((p, i) => (
            <text
              key={p.at.toISOString()}
              x={x(p.at)}
              y={height - 6}
              textAnchor={i === 0 ? 'start' : 'end'}
              className="fill-ink-faint text-[0.7rem]"
            >
              {dateFmt.format(p.at)}
            </text>
          ))}
          <path d={area} fill={`url(#${gradient})`} />
          <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {shown && (
            <line x1={x(shown.at)} x2={x(shown.at)} y1={pad.top} y2={base} stroke="var(--ink-faint)" strokeWidth="1" />
          )}
          {(shown ? [shown] : [last]).map((p) => (
            <circle key="dot" cx={x(p.at)} cy={y(p.value)} r="4" fill={color} stroke="var(--surface)" strokeWidth="2" />
          ))}
        </svg>
        {shown ? (
          <div
            className="pointer-events-none absolute top-0 grid -translate-x-1/2 gap-0 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[0.8rem] whitespace-nowrap shadow-float"
            style={{ left: Math.min(Math.max(x(shown.at), 70), width - 70) }}
          >
            <b className="text-[0.92rem] font-semibold text-ink">{format(shown.value)}</b>
            <span className="text-ink-muted">{fullDateFmt.format(shown.at)}</span>
          </div>
        ) : (
          <span
            className="pointer-events-none absolute text-[0.78rem] font-semibold text-ink"
            style={{ right: pad.right, top: Math.max(0, y(last.value) - 26) }}
          >
            {format(last.value)}
          </span>
        )}
      </div>
      <details className="text-[0.82rem] text-ink-muted">
        <summary className="cursor-pointer select-none">Show as a table</summary>
        <table className="mt-1.5 border-collapse tabular">
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.at.toISOString()}>
                <td className="py-0.5 pr-6">{fullDateFmt.format(p.at)}</td>
                <td className="py-0.5 text-right text-ink">{format(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
