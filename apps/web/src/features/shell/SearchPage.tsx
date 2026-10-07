import { Link, useSearch } from '@tanstack/react-router';
import { useSearch as useSearchQuery } from '../../api/queries.ts';
import { Cover } from '../../components/Cover.tsx';
import { Snippet } from '../../components/Snippet.tsx';
import { Caps, EmptyState, Spinner } from '../../components/ui.tsx';
import { Page } from './AppShell.tsx';

export function SearchPage() {
  const { q = '' } = useSearch({ from: '/app/search' }) as { q?: string };
  const { data, isPending } = useSearchQuery(q);
  return (
    <Page>
      <div className="grid gap-1">
        <Caps>Search</Caps>
        <h1 className="text-[2.2rem] leading-none font-bold">“{q}”</h1>
      </div>
      {q.trim().length < 2 ? (
        <EmptyState title="Type at least two characters" />
      ) : isPending ? (
        <Spinner />
      ) : !data || data.total === 0 ? (
        <EmptyState title="Nothing matches">
          Try another spelling, or search inside a collection to use its filters.
        </EmptyState>
      ) : (
        data.groups.map((g) => (
          <section key={g.collection.id} data-accent={g.collection.accent} className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[1.3rem] font-bold">{g.collection.name}</h2>
              <Link
                to="/c/$collectionId"
                params={{ collectionId: g.collection.id }}
                search={{ q }}
                className="text-[0.88rem] font-semibold text-accent"
              >
                {g.total > g.hits.length ? `See all ${g.total} in ${g.collection.name}` : `Open ${g.collection.name}`}
              </Link>
            </div>
            <ul className="m-0 grid list-none gap-1 p-0">
              {g.hits.map((h) => (
                <li key={h.item.id}>
                  <Link
                    to="/i/$itemId"
                    params={{ itemId: h.item.id }}
                    className="grid grid-cols-[44px_1fr] items-center gap-3 rounded-[10px] p-2 text-ink no-underline hover:bg-surface-sunk"
                  >
                    <Cover cover={h.item.cover} title={h.item.title} className="shadow-none" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{h.item.title}</span>
                      <span className="block truncate text-[0.82rem] text-ink-muted">
                        {h.match.label}: <Snippet text={h.match.snippet} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </Page>
  );
}
