import { Link } from '@tanstack/react-router';
import { useCollections, useMe, useRecentItems } from '../../api/queries.ts';
import { Cover } from '../../components/Cover.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Caps, EmptyState, Spinner } from '../../components/ui.tsx';
import { Page } from '../shell/AppShell.tsx';

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 6 ? 'Good night' : h < 13 ? 'Good morning' : h < 20 ? 'Good afternoon' : 'Good evening';
}

export function CollectionTiles() {
  const { data: collections, isPending } = useCollections();
  if (isPending) return <Spinner label="Loading collections" />;
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {(collections ?? []).map((c) => (
        <Link
          key={c.id}
          to="/c/$collectionId"
          params={{ collectionId: c.id }}
          data-accent={c.accent}
          className="relative grid gap-0.5 overflow-hidden rounded-[12px] border border-line bg-surface py-3 pr-3.5 pl-4.5 text-ink no-underline before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-accent hover:border-ink-faint"
        >
          <b className="truncate">{c.name}</b>
          <span className="text-[0.78rem] text-ink-muted">
            {c.itemCount} {c.itemCount === 1 ? 'item' : 'items'}
            {c.visibility === 'private' ? ' · private' : c.visibility === 'public' ? ' · public link' : ''}
          </span>
        </Link>
      ))}
      <Link
        to="/collections/new"
        className="flex items-center gap-2 rounded-[12px] border-[1.5px] border-dashed border-line px-3.5 py-3 font-semibold text-accent no-underline hover:border-accent"
      >
        <Icon name="plus" size={16} />
        New collection
      </Link>
    </div>
  );
}

export function HomePage() {
  const { data: me } = useMe();
  const { data: recent } = useRecentItems();
  const { data: collections } = useCollections();
  const today = new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <Page>
      <div className="grid gap-1">
        <Caps>{today}</Caps>
        <h1 className="text-[2rem] leading-none font-bold">
          {greeting()}
          {me ? `, ${me.name.split(' ')[0]}` : ''}
        </h1>
      </div>

      {collections && collections.length === 0 ? (
        <EmptyState
          title="Start your first collection"
          action={
            <Link to="/collections/new" className="mt-2 font-semibold text-accent">
              Create a collection
            </Link>
          }
        >
          Pick a template (video games, books, vinyl, board games or a blank one) and start adding what you own.
        </EmptyState>
      ) : (
        <>
          {recent && recent.length > 0 && (
            <section className="grid gap-2.5">
              <Caps>Recently added</Caps>
              <div className="grid grid-cols-3 gap-3.5 sm:grid-cols-6">
                {recent.slice(0, 6).map((it) => (
                  <Link
                    key={it.id}
                    to="/i/$itemId"
                    params={{ itemId: it.id }}
                    className="group grid gap-1.5 no-underline"
                    title={it.title}
                  >
                    <Cover
                      cover={it.cover}
                      title={it.title}
                      className="transition-transform group-hover:-translate-y-1"
                    />
                    <span className="truncate text-[0.8rem] text-ink-muted">{it.collection.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          <section className="grid gap-2.5">
            <Caps>Collections</Caps>
            <CollectionTiles />
          </section>
        </>
      )}
    </Page>
  );
}

export function CollectionsIndexPage() {
  return (
    <Page>
      <h1 className="text-[2.2rem] leading-none font-bold">Collections</h1>
      <CollectionTiles />
    </Page>
  );
}
