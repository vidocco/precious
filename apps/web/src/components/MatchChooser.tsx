import type { PendingMatch } from '@precious/shared';

/** "Pick the right match": candidates with their scores, plus "none of these". */
export function MatchChooser({
  pending,
  onChoose,
  value,
  disabled,
}: {
  pending: PendingMatch;
  onChoose: (id: string | null) => void;
  value?: string | null;
  disabled?: boolean;
}) {
  return (
    <fieldset className="m-0 grid gap-1 rounded-[10px] border border-gilt/50 bg-gilt/8 p-2.5">
      <legend className="px-1 text-[0.86rem]">
        <b>{pending.label}</b> found {pending.candidates.length} possible{' '}
        {pending.candidates.length === 1 ? 'match' : 'matches'} for “{pending.query}”
      </legend>
      {pending.candidates.map((c) => (
        <label
          key={c.id}
          className="flex cursor-pointer items-baseline gap-2 rounded-[7px] px-1.5 py-1 text-[0.88rem] hover:bg-surface-sunk"
        >
          <input
            type="radio"
            name={`match-${pending.step}`}
            checked={value === c.id}
            disabled={disabled}
            onChange={() => onChoose(c.id)}
          />
          <span className="min-w-0 flex-1">
            <b className="font-semibold">{c.title}</b>
            {(c.year || c.subtitle) && (
              <span className="text-ink-muted"> · {[c.year, c.subtitle].filter(Boolean).join(' · ')}</span>
            )}
          </span>
          <span className="flex-none text-[0.8rem] text-ink-muted tabular">{Math.round(c.score * 100)}%</span>
        </label>
      ))}
      <label className="flex cursor-pointer items-baseline gap-2 rounded-[7px] px-1.5 py-1 text-[0.88rem] text-ink-muted hover:bg-surface-sunk">
        <input
          type="radio"
          name={`match-${pending.step}`}
          checked={value === null}
          disabled={disabled}
          onChange={() => onChoose(null)}
        />
        None of these: skip {pending.label}
      </label>
    </fieldset>
  );
}
