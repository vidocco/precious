import {
  describeShelf,
  type FieldDefinition,
  type ItemDto,
  type Measure,
  type Shelf as ShelfRules,
  type TemplateData,
} from '@precious/shared';
import { useMemo } from 'react';
import { Shelf } from '../../components/Shelf.tsx';
import { Button, Caps, IconButton, Segmented, Select, TextInput } from '../../components/ui.tsx';
import { sampleItem } from './editorUtils.ts';

type SetT = (patch: Partial<TemplateData>) => void;
type Mode = 'fixed' | 'fields' | 'rules';

const small = 'text-[0.85rem] text-ink-muted';
const NUMERIC = new Set(['number', 'money', 'duration', 'rating']);

function Cm({
  value,
  onChange,
  label,
  step = 0.1,
  unit = 'cm',
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  step?: number;
  unit?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <TextInput
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        aria-label={label}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className="w-20 py-1 text-right tabular"
      />
      {unit && <span className="text-ink-muted">{unit}</span>}
    </span>
  );
}

function MeasureRow({
  name,
  m,
  fields,
  onChange,
}: {
  name: string;
  m: Measure;
  fields: FieldDefinition[];
  onChange: (m: Measure) => void;
}) {
  return (
    <div className="grid gap-1.5 rounded-[10px] border border-line bg-surface p-3">
      <b className="text-[0.9rem]">{name}</b>
      <div className="flex flex-wrap items-center gap-2 text-[0.88rem]">
        <Select
          aria-label={`${name} from`}
          value={m.field ?? ''}
          onChange={(e) => onChange({ ...m, field: e.target.value || null })}
          className="w-auto py-1"
        >
          <option value="">The same for every item</option>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              From {f.label}
            </option>
          ))}
        </Select>
        {m.field ? (
          <>
            <span className="text-ink-muted">×</span>
            <Cm
              label={`${name} factor`}
              value={m.factor}
              step={0.001}
              unit=""
              onChange={(factor) => onChange({ ...m, factor })}
            />
            <span className="text-ink-muted">+</span>
            <Cm label={`${name} added`} value={m.add} onChange={(add) => onChange({ ...m, add })} />
            <span className="text-ink-muted">· without a value</span>
            <Cm label={`${name} fallback`} value={m.fallback} onChange={(fallback) => onChange({ ...m, fallback })} />
          </>
        ) : (
          <Cm
            label={`${name} for every item`}
            value={m.fallback}
            onChange={(fallback) => onChange({ ...m, fallback })}
          />
        )}
      </div>
    </div>
  );
}

/** Example items for the preview, spread across the rules so each one shows. */
function samples(t: TemplateData): ItemDto[] {
  const s = t.shelf;
  const out: ItemDto[] = [];
  const titles = [
    'The Left Hand of Darkness',
    'Lanterns of Vell',
    'Kind of Blue',
    'Dune',
    'Hollow Knight',
    'Ficciones',
    'Wingspan',
    'Rayuela',
    'Celeste',
    'Blonde',
    'Pedro Páramo',
    'Outer Wilds',
  ];
  const ruleValues = s.by === 'rules' ? [...s.rules.flatMap((r) => r.values.slice(0, 1)), 'Something else'] : [];
  for (let i = 0; i < 12; i++) {
    const item = sampleItem(t, titles[i] ?? `Item ${i + 1}`, i + 1);
    const data = { ...item.data };
    // Work back from a believable size to the field value that gives it.
    const spread = ((i * 37) % 10) / 10;
    const targets: [Measure, number][] = [
      [s.thickness, 1.2 + spread * 3],
      [s.height, 17 + ((i * 53) % 8)],
    ];
    for (const [m, target] of targets) {
      if (s.by === 'measure' && m.field && m.factor > 0) {
        data[m.field] = Math.max(1, Math.round(((target - m.add) / m.factor) * 10) / 10);
      }
    }
    if (s.by === 'rules' && s.rulesField) data[s.rulesField] = ruleValues[i % ruleValues.length];
    if (s.lean) data[s.lean.field] = i === 4 ? s.lean.equals : typeof s.lean.equals === 'boolean' ? !s.lean.equals : '';
    out.push({ ...item, id: `shelf-sample-${i}`, data });
  }
  return out;
}

/** The template's Shelf tab: how big items are, which lean, and what the spine says. */
export function ShelfTab({ t, set }: { t: TemplateData; set: SetT }) {
  const s = t.shelf;
  const setS = (patch: Partial<ShelfRules>) => set({ shelf: { ...s, ...patch } });
  const fields = t.fields.filter((f) => !f.hidden);
  const numeric = fields.filter((f) => NUMERIC.has(f.type));
  const groupable = fields.filter((f) => ['choice', 'multichoice', 'text', 'tags'].includes(f.type));
  const leanable = fields.filter((f) => ['choice', 'multichoice', 'boolean', 'text', 'tags'].includes(f.type));
  const mode: Mode = s.by === 'rules' ? 'rules' : s.thickness.field || s.height.field ? 'fields' : 'fixed';
  const rulesField = fields.find((f) => f.id === s.rulesField);
  const leanField = fields.find((f) => f.id === s.lean?.field);
  const preview = useMemo(() => samples(t), [t]);

  function setMode(m: Mode) {
    if (m === mode) return;
    if (m === 'rules') {
      const field = groupable[0];
      setS({ by: 'rules', rulesField: field?.id ?? null, rules: s.rules.length ? s.rules : [] });
    } else if (m === 'fixed') {
      setS({ by: 'measure', thickness: { ...s.thickness, field: null }, height: { ...s.height, field: null } });
    } else {
      setS({ by: 'measure', thickness: { ...s.thickness, field: numeric[0]?.id ?? null, factor: 1, add: 0 } });
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <div className="grid content-start gap-5">
        <section className="grid gap-2.5">
          <div>
            <Caps>Size</Caps>
            <p className={small}>
              In centimetres. Spines are drawn to scale for height, with thickness doubled so titles fit.
            </p>
          </div>
          <Segmented
            label="How big"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'fixed', label: 'Same for every item' },
              { value: 'fields', label: 'From fields', disabled: numeric.length === 0 },
              { value: 'rules', label: 'By a field’s value', disabled: groupable.length === 0 },
            ]}
          />
          {mode === 'fixed' && (
            <div className="flex flex-wrap items-center gap-3 text-[0.88rem]">
              <span className="text-ink-muted">Thickness</span>
              <Cm
                label="Thickness"
                value={s.thickness.fallback}
                onChange={(fallback) => setS({ thickness: { ...s.thickness, fallback } })}
              />
              <span className="text-ink-muted">Height</span>
              <Cm
                label="Height"
                value={s.height.fallback}
                onChange={(fallback) => setS({ height: { ...s.height, fallback } })}
              />
            </div>
          )}
          {mode === 'fields' && (
            <>
              <MeasureRow
                name="Thickness"
                m={s.thickness}
                fields={numeric}
                onChange={(thickness) => setS({ thickness })}
              />
              <MeasureRow name="Height" m={s.height} fields={numeric} onChange={(height) => setS({ height })} />
              <p className="text-[0.8rem] text-ink-faint">
                For books: Pages × 0.005 + 0.3 cm is about a twentieth of a millimetre a page plus the cover.
              </p>
            </>
          )}
          {mode === 'rules' && (
            <div className="grid gap-2">
              <label className="flex flex-wrap items-center gap-2 text-[0.88rem] text-ink-muted">
                Size by
                <Select
                  aria-label="Size by field"
                  value={s.rulesField ?? ''}
                  onChange={(e) => setS({ rulesField: e.target.value || null })}
                  className="w-auto py-1"
                >
                  {groupable.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </label>
              <table className="w-full border-collapse text-[0.88rem]">
                <thead>
                  <tr className="text-left text-[0.7rem] font-semibold tracking-[0.08em] text-ink-muted uppercase">
                    <th className="py-1 pr-2">When {rulesField?.label ?? 'it'} is</th>
                    <th className="py-1 pr-2">Thickness</th>
                    <th className="py-1 pr-2">Height</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {s.rules.map((r, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rules are positional
                    <tr key={i} className="border-t border-line">
                      <td className="py-1.5 pr-2">
                        <TextInput
                          aria-label={`Values for rule ${i + 1}`}
                          list={rulesField?.options.choices ? `choices-${rulesField.id}` : undefined}
                          value={r.values.join(', ')}
                          placeholder="e.g. Switch, Switch 2"
                          onChange={(e) =>
                            setS({
                              rules: s.rules.map((x, j) =>
                                j === i ? { ...x, values: e.target.value.split(',').map((v) => v.trimStart()) } : x,
                              ),
                            })
                          }
                          onBlur={() =>
                            setS({
                              rules: s.rules.map((x, j) =>
                                j === i ? { ...x, values: x.values.map((v) => v.trim()).filter(Boolean) } : x,
                              ),
                            })
                          }
                          className="py-1"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <Cm
                          label={`Thickness for rule ${i + 1}`}
                          value={r.thickness}
                          onChange={(thickness) =>
                            setS({ rules: s.rules.map((x, j) => (j === i ? { ...x, thickness } : x)) })
                          }
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <Cm
                          label={`Height for rule ${i + 1}`}
                          value={r.height}
                          onChange={(height) =>
                            setS({ rules: s.rules.map((x, j) => (j === i ? { ...x, height } : x)) })
                          }
                        />
                      </td>
                      <td className="py-1.5">
                        <IconButton
                          icon="x"
                          label={`Remove rule ${i + 1}`}
                          onClick={() => setS({ rules: s.rules.filter((_, j) => j !== i) })}
                          className="size-7"
                        />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-line">
                    <td className="py-1.5 pr-2 text-ink-muted">Anything else</td>
                    <td className="py-1.5 pr-2">
                      <Cm
                        label="Thickness for anything else"
                        value={s.otherwise.thickness}
                        onChange={(thickness) => setS({ otherwise: { ...s.otherwise, thickness } })}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Cm
                        label="Height for anything else"
                        value={s.otherwise.height}
                        onChange={(height) => setS({ otherwise: { ...s.otherwise, height } })}
                      />
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
              {rulesField?.options.choices && (
                <datalist id={`choices-${rulesField.id}`}>
                  {rulesField.options.choices.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              )}
              <div>
                <Button
                  size="sm"
                  icon="plus"
                  onClick={() =>
                    setS({
                      rules: [...s.rules, { values: [], thickness: s.otherwise.thickness, height: s.otherwise.height }],
                    })
                  }
                >
                  Add a rule
                </Button>
              </div>
            </div>
          )}
        </section>

        <section className="grid gap-2">
          <Caps>Leaning</Caps>
          <div className="flex flex-wrap items-center gap-2 text-[0.88rem] text-ink-muted">
            Items lean when
            <Select
              aria-label="Lean when field"
              value={s.lean?.field ?? ''}
              onChange={(e) => {
                const f = fields.find((x) => x.id === e.target.value);
                setS({
                  lean: f
                    ? { field: f.id, equals: f.type === 'boolean' ? true : (f.options.choices?.[0] ?? '') }
                    : null,
                });
              }}
              className="w-auto py-1"
            >
              <option value="">never</option>
              {leanable.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
            {s.lean && leanField && (
              <>
                is
                {leanField.type === 'boolean' ? (
                  <Select
                    aria-label="Lean when value"
                    value={String(s.lean.equals)}
                    onChange={(e) => setS({ lean: { field: leanField.id, equals: e.target.value === 'true' } })}
                    className="w-auto py-1"
                  >
                    <option value="true">yes</option>
                    <option value="false">no</option>
                  </Select>
                ) : leanField.options.choices ? (
                  <Select
                    aria-label="Lean when value"
                    value={String(s.lean.equals)}
                    onChange={(e) => setS({ lean: { field: leanField.id, equals: e.target.value } })}
                    className="w-auto py-1"
                  >
                    {leanField.options.choices.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <TextInput
                    aria-label="Lean when value"
                    value={String(s.lean.equals)}
                    onChange={(e) => setS({ lean: { field: leanField.id, equals: e.target.value } })}
                    className="w-40 py-1"
                  />
                )}
              </>
            )}
          </div>
        </section>

        <section className="grid gap-2">
          <Caps>On the spine</Caps>
          <div className="flex flex-wrap items-center gap-2 text-[0.88rem] text-ink-muted">
            The title, and under it
            <Select
              aria-label="Spine subtitle"
              value={s.subtitle ?? ''}
              onChange={(e) => setS({ subtitle: e.target.value || null })}
              className="w-auto py-1"
            >
              <option value="">nothing</option>
              {fields
                .filter((f) => f.type !== 'longtext')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
            </Select>
          </div>
        </section>
      </div>

      <aside className="grid content-start gap-2 self-start rounded-[12px] border border-line bg-wall p-3.5 xl:sticky xl:top-20">
        <Caps>Preview</Caps>
        <p className="text-[0.8rem] text-ink-muted">{describeShelf(s, t.fields)}</p>
        <Shelf items={preview} rules={s} fields={t.fields} />
      </aside>
    </div>
  );
}
