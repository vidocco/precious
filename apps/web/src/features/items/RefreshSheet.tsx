import {
  type FieldDefinition,
  type FillSource,
  formatValue,
  type ItemDto,
  type PendingMatch,
  type RefreshResult,
  type TemplateDto,
} from '@precious/shared';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { importRemoteImage, useItemMutations, useLookupMutations } from '../../api/queries.ts';
import { MatchChooser } from '../../components/MatchChooser.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Button, Caps, ErrorBox, Spinner } from '../../components/ui.tsx';
import { LOCALE } from '../../lib/format.ts';

function show(target: string, value: unknown, fields: FieldDefinition[]) {
  if (value === undefined || value === null || value === '') return '(empty)';
  if (target === '$title') return String(value);
  const field = fields.find((f) => f.id === target);
  return field ? formatValue(field, value, { locale: LOCALE }) || String(value) : String(value);
}

const labelOf = (target: string, fields: FieldDefinition[]) =>
  target === '$title'
    ? 'Title'
    : target === '$cover'
      ? 'Cover'
      : (fields.find((f) => f.id === target)?.label ?? target);

/**
 * Refresh: runs the template's lookups again from the item's stored refs and shows
 * what would change. Values edited by hand are listed but never changed.
 */
export function RefreshSheet({
  item,
  template,
  onClose,
}: {
  item: ItemDto;
  template: TemplateDto;
  onClose: () => void;
}) {
  const { refresh } = useLookupMutations();
  const { update } = useItemMutations();
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [asked, setAsked] = useState<PendingMatch[]>([]);
  const [choices, setChoices] = useState<Record<string, string | null>>({});
  const [applying, setApplying] = useState(false);
  const fields = template.fields;

  async function run(nextChoices: Record<string, string | null>) {
    setError('');
    try {
      const r = await refresh.mutateAsync({ id: item.id, choices: nextChoices });
      setResult(r);
      setPicked(new Set([...r.changes.map((c) => c.target), ...(r.cover ? ['$cover'] : [])]));
      setAsked((prev) => [...prev, ...r.pending.filter((p) => !prev.some((x) => x.step === p.step))]);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once when the sheet opens
  useEffect(() => {
    void run({});
  }, []);

  const toggle = (target: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });

  async function apply() {
    if (!result) return;
    setApplying(true);
    setError('');
    try {
      const chosen = result.changes.filter((c) => picked.has(c.target));
      const sources: Record<string, FillSource> = Object.fromEntries(chosen.map((c) => [c.target, c.source]));
      const data = Object.fromEntries(chosen.filter((c) => c.target !== '$title').map((c) => [c.target, c.after]));
      const title = chosen.find((c) => c.target === '$title')?.after as string | undefined;
      let coverImageId: string | undefined;
      if (result.cover && picked.has('$cover')) {
        const img = await importRemoteImage(result.cover);
        coverImageId = img.id;
        sources.$cover = { ...result.cover.source, url: result.cover.url };
      }
      await update.mutateAsync({
        id: item.id,
        data,
        ...(title && { title }),
        ...(coverImageId && { coverImageId }),
        externalRefs: result.refs,
        sources,
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setApplying(false);
    }
  }

  const nothing =
    result && result.changes.length === 0 && !result.cover && result.pending.length === 0 && asked.length === 0;
  const count = picked.size;

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      className="dark-scope"
      title={`Refresh ${item.title}`}
      subtitle="Looks the item up again in its data sources"
      footer={
        <>
          <Button variant="primary" onClick={() => void apply()} disabled={!result || count === 0 || applying}>
            {applying ? 'Applying…' : count ? `Apply ${count} change${count === 1 ? '' : 's'}` : 'Nothing to apply'}
          </Button>
          <Button onClick={onClose}>{nothing ? 'Close' : 'Cancel'}</Button>
        </>
      }
    >
      <div className="grid gap-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        {!result && !error && <Spinner label="Looking it up" />}
        {asked.map((p) => (
          <MatchChooser
            key={p.step}
            pending={p}
            value={choices[p.step]}
            disabled={refresh.isPending}
            onChoose={(id) => {
              const next = { ...choices, [p.step]: id };
              setChoices(next);
              void run(next);
            }}
          />
        ))}
        {nothing && <p className="text-ink-muted">Everything is up to date.</p>}
        {result && (result.changes.length > 0 || result.cover) && (
          <div className="grid gap-1.5">
            <Caps>Changes</Caps>
            <ul className="m-0 grid list-none gap-1 p-0">
              {result.changes.map((c) => (
                <li key={c.target}>
                  <label className="grid cursor-pointer grid-cols-[auto_1fr] items-baseline gap-x-2.5 rounded-[8px] px-2 py-1.5 hover:bg-surface-sunk">
                    <input type="checkbox" checked={picked.has(c.target)} onChange={() => toggle(c.target)} />
                    <span className="min-w-0">
                      <b className="font-semibold">{labelOf(c.target, fields)}</b>
                      <span className="text-[0.8rem] text-ink-faint"> · {c.source.name}</span>
                      <span className="block text-[0.9rem] break-words">
                        <span className="text-ink-muted line-through decoration-ink-faint">
                          {show(c.target, c.before, fields)}
                        </span>{' '}
                        → {show(c.target, c.after, fields)}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
              {result.cover && (
                <li>
                  <label className="grid cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-x-2.5 rounded-[8px] px-2 py-1.5 hover:bg-surface-sunk">
                    <input type="checkbox" checked={picked.has('$cover')} onChange={() => toggle('$cover')} />
                    <img src={result.cover.url} alt="New cover" className="h-16 w-auto rounded-[4px]" />
                    <span>
                      <b className="font-semibold">{item.cover ? 'Replace the cover' : 'Add a cover'}</b>
                      <span className="text-[0.8rem] text-ink-faint"> · {result.cover.source.name}</span>
                    </span>
                  </label>
                </li>
              )}
            </ul>
          </div>
        )}
        {result && result.kept.length > 0 && (
          <div className="grid gap-1">
            <Caps>Kept: edited by hand</Caps>
            <ul className="m-0 grid list-none gap-0.5 p-0 text-[0.88rem] text-ink-muted">
              {result.kept.map((k) => (
                <li key={k.target}>
                  <b className="font-medium text-ink">{labelOf(k.target, fields)}</b>
                  {k.target !== '$cover' && <> stays {show(k.target, k.value, fields)}</>}; the source has{' '}
                  {k.target === '$cover' ? 'another cover' : show(k.target, k.offered, fields)}. Unlock it on the item
                  page to take the source’s value.
                </li>
              ))}
            </ul>
          </div>
        )}
        {result && result.warnings.length > 0 && (
          <ul className="m-0 grid list-disc gap-0.5 pl-5 text-[0.85rem] text-ink-muted">
            {result.warnings.map((w) => (
              <li key={`${w.step}-${w.target}-${w.message}`}>{w.message}</li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
