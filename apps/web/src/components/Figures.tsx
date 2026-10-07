import type { FigureValue } from '@precious/shared';
import { formatFigure } from '../lib/format.ts';
import { cx } from './ui.tsx';

export function Figures({ figures }: { figures: FigureValue[] }) {
  if (figures.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2.5">
      {figures.map((f) => (
        <div
          key={f.id}
          className={cx(
            'grid min-w-[120px] gap-0.5 rounded-[12px] border px-3.5 py-2.5',
            f.format === 'money' ? 'border-transparent bg-gilt-soft' : 'border-line bg-wall',
          )}
        >
          <span className="text-[0.7rem] font-semibold tracking-[0.11em] text-ink-muted uppercase">{f.label}</span>
          <span
            className={cx(
              'text-[1.45rem] leading-tight font-bold tabular [font-stretch:80%]',
              f.format === 'money' && 'text-gilt',
            )}
          >
            {formatFigure(f)}
          </span>
        </div>
      ))}
    </div>
  );
}
