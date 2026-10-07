import { COVER_PRESETS, type CoverShape, coverShapeSchema } from '@precious/shared';
import { useState } from 'react';
import { Caps, cx, Segmented, TextInput } from '../../components/ui.tsx';

const sameRatio = (a: { width: number; height: number }, b: { width: number; height: number }) =>
  Math.abs(a.width / a.height - b.width / b.height) < 0.005;

/** A small outline of a shape, at most `max` px on its long side. */
function Outline({ width, height, max = 22 }: { width: number; height: number; max?: number }) {
  const k = max / Math.max(width, height);
  return (
    <span
      aria-hidden="true"
      className="block rounded-[2px] border-[1.5px] border-current"
      style={{ width: Math.round(width * k), height: Math.round(height * k) }}
    />
  );
}

function Size({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <TextInput
      type="number"
      inputMode="decimal"
      min={1}
      max={100}
      step={0.1}
      aria-label={label}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      className="w-20 py-1 text-right tabular"
    />
  );
}

/** The template's cover shape: a preset or any width × height, cropped or shown whole. */
export function CoverShapePicker({ value, onChange }: { value: CoverShape; onChange: (v: CoverShape) => void }) {
  const preset = COVER_PRESETS.find((p) => sameRatio(p, value));
  const [custom, setCustom] = useState(!preset);
  const selected = custom ? 'custom' : preset?.id;
  const problem = coverShapeSchema.safeParse(value).error?.issues[0]?.message;
  const option =
    'grid min-w-[60px] justify-items-center gap-1.5 rounded-[9px] border px-2 pt-2.5 pb-1.5 text-[0.78rem]';

  return (
    <div className="grid gap-2.5">
      <Caps>Cover shape</Caps>
      <div role="radiogroup" aria-label="Cover shape" className="flex flex-wrap gap-1.5">
        {COVER_PRESETS.map((p) => (
          // biome-ignore lint/a11y/useSemanticElements: styled buttons with radio semantics
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected === p.id}
            onClick={() => {
              setCustom(false);
              onChange({ ...value, width: p.width, height: p.height });
            }}
            className={cx(
              option,
              selected === p.id ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-ink-muted',
            )}
          >
            <span className="grid h-6 place-items-center">
              <Outline width={p.width} height={p.height} />
            </span>
            {p.label}
          </button>
        ))}
        {/* biome-ignore lint/a11y/useSemanticElements: styled buttons with radio semantics */}
        <button
          type="button"
          role="radio"
          aria-checked={selected === 'custom'}
          onClick={() => setCustom(true)}
          className={cx(
            option,
            selected === 'custom' ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-ink-muted',
          )}
        >
          <span className="grid h-6 place-items-center">
            <Outline width={1} height={1} max={18} />
          </span>
          Custom
        </button>
      </div>
      {custom && (
        <div className="flex flex-wrap items-center gap-2 text-[0.88rem] text-ink-muted">
          <Size label="Cover width" value={value.width} onChange={(width) => onChange({ ...value, width })} />×
          <Size label="Cover height" value={value.height} onChange={(height) => onChange({ ...value, height })} />
          cm
        </div>
      )}
      {problem && <span className="text-[0.82rem] text-danger">{problem}</span>}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Cover image"
          value={value.fit}
          onChange={(fit) => onChange({ ...value, fit })}
          options={[
            { value: 'crop', label: 'Crop to fill' },
            { value: 'whole', label: 'Show whole image' },
          ]}
        />
        <span className="text-[0.82rem] text-ink-muted">
          {value.fit === 'crop'
            ? 'Images fill the shape; edges that don’t fit are cut off.'
            : 'Images keep their proportions, on their own colour.'}
        </span>
      </div>
    </div>
  );
}
