import { useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearch } from '../../api/queries.ts';
import { Cover } from '../../components/Cover.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Snippet } from '../../components/Snippet.tsx';
import { cx } from '../../components/ui.tsx';
import { useDebounced } from '../../lib/hooks.ts';

/** The top-bar search: results from every collection, grouped, with keyboard navigation. */
export function GlobalSearch({ autoFocus, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(q.trim(), 200);
  const { data, isFetching } = useSearch(debounced);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const listId = useId();

  const flat = useMemo(() => data?.groups.flatMap((g) => g.hits.map((h) => ({ ...h, group: g }))) ?? [], [data]);

  // "/" focuses the search from anywhere, like most apps.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: new results start at the top
  useEffect(() => setActive(0), [debounced]);

  function finish() {
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
    onDone?.();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = flat[active];
      if (hit) navigate({ to: '/i/$itemId', params: { itemId: hit.item.id } });
      else if (q.trim()) navigate({ to: '/search', search: { q: q.trim() } });
      finish();
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showPanel = open && debounced.length >= 2 && !!data;

  return (
    <div className="relative min-w-0 flex-1">
      <label className="flex items-center gap-2 rounded-[10px] border border-line bg-wall px-2.5 py-[7px] text-[0.9rem] text-ink-faint focus-within:border-accent focus-within:bg-surface">
        <Icon name="search" />
        <input
          ref={inputRef}
          value={q}
          // biome-ignore lint/a11y/noAutofocus: the mobile search sheet opens to type straight away
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder="Search all collections"
          aria-label="Search all collections"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-activedescendant={showPanel && flat[active] ? `${listId}-${active}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint"
        />
        {isFetching ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
        ) : (
          <kbd className="rounded-[5px] border border-line px-1.5 text-[0.7rem] text-ink-faint">/</kbd>
        )}
      </label>
      {showPanel && (
        <div
          id={listId}
          role="listbox"
          className="absolute top-[calc(100%+6px)] left-1/2 z-40 w-[min(560px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[14px] border border-line bg-surface shadow-float"
        >
          {data.groups.length === 0 && (
            <p className="px-4 py-6 text-center text-ink-muted">Nothing matches “{debounced}”.</p>
          )}
          {data.groups.map((g) => (
            <div key={g.collection.id} data-accent={g.collection.accent} className="border-b border-line py-2">
              <div className="flex justify-between px-3.5 pt-1 pb-1.5">
                <span className="text-[0.7rem] font-semibold tracking-[0.11em] text-ink-muted uppercase">
                  {g.collection.name}
                </span>
                <span className="text-[0.7rem] font-semibold tracking-[0.11em] text-ink-faint uppercase">
                  {g.total} {g.total === 1 ? 'match' : 'matches'}
                </span>
              </div>
              {g.hits.map((h) => {
                const index = flat.findIndex((f) => f.item.id === h.item.id);
                return (
                  <button
                    key={h.item.id}
                    id={`${listId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      navigate({ to: '/i/$itemId', params: { itemId: h.item.id } });
                      finish();
                    }}
                    className={cx(
                      'grid w-full grid-cols-[34px_1fr_auto] items-center gap-2.5 px-3.5 py-1.5 text-left',
                      index === active && 'bg-surface-sunk',
                    )}
                  >
                    <Cover cover={h.item.cover} title={h.item.title} className="shadow-none" />
                    <span className="min-w-0">
                      <span className="block truncate text-[0.9rem] leading-tight font-semibold">{h.item.title}</span>
                      <span className="block truncate text-[0.75rem] text-ink-muted">
                        {h.match.label}: <Snippet text={h.match.snippet} />
                      </span>
                    </span>
                    <span className="rounded-full border border-accent/40 px-2 py-0.5 text-[0.68rem] font-semibold whitespace-nowrap text-accent">
                      {g.collection.name}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {data.total > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                navigate({ to: '/search', search: { q: debounced } });
                finish();
              }}
              className={cx(
                'flex w-full justify-between px-3.5 py-2.5 text-left text-[0.82rem] text-ink-muted',
                active === flat.length && 'bg-surface-sunk',
              )}
            >
              <span>
                <strong className="text-ink">
                  See all {data.total} {data.total === 1 ? 'result' : 'results'}
                </strong>{' '}
                for “{debounced}”
              </span>
              <span className="hidden sm:inline">↑ ↓ to move · Enter to open</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
