import type { CollectionDto, FillResult, SourceHit, TemplateDto } from '@precious/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import {
  importRemoteImage,
  useItemMutations,
  useLookupMutations,
  useLookupSearch,
  useSources,
} from '../../api/queries.ts';
import { BarcodeScanner } from '../../components/BarcodeScanner.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { cx, ErrorBox, IconButton, Select, TextInput } from '../../components/ui.tsx';
import { saveDraft } from '../../lib/drafts.ts';
import { useDebounced } from '../../lib/hooks.ts';

/** Saves a found item straight away (quick add), downloading its cover first. */
export async function createFromFill(
  create: ReturnType<typeof useItemMutations>['create'],
  collectionId: string,
  fill: FillResult,
  fallbackTitle: string,
) {
  const cover = fill.cover ? await importRemoteImage(fill.cover).catch(() => null) : null;
  const sources = { ...fill.sources };
  if (!cover) delete sources.$cover;
  return create.mutateAsync({
    collectionId,
    title: fill.title || fallbackTitle,
    coverImageId: cover?.id ?? null,
    data: fill.data,
    externalRefs: fill.refs,
    sources,
  });
}

/**
 * "Find it": searches the collection template's data sources. Picking a result fills
 * it in on the server, then opens the review screen (or saves it, with quick add).
 */
export function AddSheet({
  collection,
  template,
  query,
  onQueryChange,
  onClose,
}: {
  collection: CollectionDto;
  template: TemplateDto;
  query: string;
  onQueryChange: (q: string) => void;
  onClose: () => void;
}) {
  const providers = template.bindings.search;
  const sources = useSources();
  const [provider, setProvider] = useState(providers[0]?.id ?? '');
  const [text, setText] = useState(query);
  const debounced = useDebounced(text.trim(), 300);
  const results = useLookupSearch(collection.id, provider, debounced);
  const { fill } = useLookupMutations();
  const { create } = useItemMutations();
  const navigate = useNavigate();
  const [picking, setPicking] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const list = useRef<HTMLUListElement>(null);

  // Keeps the search in the address, so "Back to results" returns here.
  useEffect(() => {
    if (debounced !== query) onQueryChange(debounced);
  }, [debounced, query, onQueryChange]);

  const sourceName = (endpointId: string) =>
    sources.data?.find((s) => s.endpoints.some((e) => e.id === endpointId))?.name;
  const providerName = sourceName(providers.find((p) => p.id === provider)?.endpointId ?? '') ?? 'data sources';
  const stepNames = [
    providerName,
    ...template.bindings.steps.map((s) => sourceName(s.endpointId)).filter((n): n is string => !!n),
  ].filter((n, i, all) => all.indexOf(n) === i);

  async function pick(hit: SourceHit) {
    setPicking(hit.token);
    setError('');
    try {
      const filled = await fill.mutateAsync({ collectionId: collection.id, provider, query: debounced, result: hit });
      if (collection.quickAdd && filled.pending.length === 0 && filled.warnings.length === 0) {
        const item = await createFromFill(create, collection.id, filled, hit.title);
        navigate({ to: '/i/$itemId', params: { itemId: item.id } });
        return;
      }
      const draft = saveDraft({ collectionId: collection.id, provider, query: debounced, result: hit, fill: filled });
      navigate({ to: '/c/$collectionId/new', params: { collectionId: collection.id }, search: { draft } });
    } catch (err) {
      setError(errorMessage(err));
      setPicking(null);
    }
  }

  // Arrow keys move between the search box and the results.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [...(list.current?.querySelectorAll('button') ?? [])];
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    e.preventDefault();
    if (next < 0) (e.currentTarget.querySelector('input[type=search]') as HTMLInputElement | null)?.focus();
    else buttons[Math.min(next, buttons.length - 1)]?.focus();
  }

  const hits = results.data?.results ?? [];
  const searching = debounced.length >= 2;

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Add to ${collection.name}`}
      subtitle={picking ? `Filling in from ${stepNames.join(', ')}…` : 'Find it, then check the details'}
      footer={
        <p className="text-[0.88rem] text-ink-muted">
          Not here?{' '}
          <Link
            to="/c/$collectionId/new"
            params={{ collectionId: collection.id }}
            search={{ title: text.trim() || undefined }}
            className="font-semibold"
          >
            Add it by hand
          </Link>{' '}
          with the {template.name} fields.
        </p>
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys only move focus between controls inside */}
      <div className="grid gap-3" data-accent={collection.accent} onKeyDown={onKeyDown}>
        <div className="flex gap-2">
          {providers.length > 1 && (
            <Select
              aria-label="Search in"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-auto max-w-[40%]"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {sourceName(p.endpointId) ?? p.id}
                </option>
              ))}
            </Select>
          )}
          <TextInput
            type="search"
            aria-label={`Search ${providerName}`}
            placeholder={`Search ${providerName}…`}
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) {
                e.preventDefault();
                void pick(hits[0]);
              }
            }}
          />
          <IconButton
            icon="scan"
            label="Scan a barcode"
            onClick={() => setScanning(!scanning)}
            aria-pressed={scanning}
            className="flex-none border border-line"
          />
        </div>
        {scanning && (
          <BarcodeScanner
            onCancel={() => setScanning(false)}
            onDetected={(code) => {
              setScanning(false);
              setText(code);
            }}
          />
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
        {results.data?.error && <ErrorBox>{results.data.error}</ErrorBox>}
        {results.isError && <ErrorBox>{errorMessage(results.error)}</ErrorBox>}
        {searching && !scanning && (
          <span className="text-[0.72rem] font-semibold tracking-[0.11em] text-ink-muted uppercase" aria-live="polite">
            {results.isFetching && !results.data
              ? 'Searching…'
              : `${hits.length} result${hits.length === 1 ? '' : 's'} from ${providerName}`}
          </span>
        )}
        {!searching && !scanning && (
          <p className="text-[0.9rem] text-ink-muted">Type at least two letters to search.</p>
        )}
        <ul
          ref={list}
          aria-label="Results"
          className={cx('m-0 grid list-none gap-1 p-0', results.isFetching && 'opacity-70', scanning && 'hidden')}
        >
          {hits.map((hit) => (
            <li key={hit.token}>
              <button
                type="button"
                disabled={!!picking}
                onClick={() => void pick(hit)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-[10px] p-1.5 text-left transition hover:bg-surface-sunk focus-visible:bg-surface-sunk focus-visible:outline-none disabled:cursor-wait',
                  picking === hit.token && 'bg-accent/12',
                )}
              >
                <span className="grid h-[58px] w-11 flex-none place-items-center overflow-hidden rounded-[5px] bg-wall text-ink-faint">
                  {hit.image ? (
                    <img src={hit.image} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <Icon name="image" size={18} />
                  )}
                </span>
                <span className="grid min-w-0 flex-1">
                  <b className="truncate font-semibold">{hit.title}</b>
                  {(hit.subtitle || hit.year) && (
                    <span className="truncate text-[0.86rem] text-ink-muted">
                      {[hit.subtitle, hit.year].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                {picking === hit.token && (
                  <span className="size-4 flex-none animate-spin rounded-full border-2 border-line border-t-accent" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
