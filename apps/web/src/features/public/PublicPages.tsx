import { coverShape } from '@precious/shared';
import { Link, useParams } from '@tanstack/react-router';
import { errorMessage } from '../../api/client.ts';
import { usePublicCollection } from '../../api/queries.ts';
import { Logo } from '../../components/Icon.tsx';
import { ItemCard, Wall } from '../../components/ItemCard.tsx';
import { Caps, ErrorBox, Spinner } from '../../components/ui.tsx';
import { ItemView } from '../items/ItemView.tsx';

function PublicBar() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-4 py-3 text-[1.2rem] font-bold [font-stretch:75%] sm:px-8">
        <Logo />
        Precious
      </div>
    </header>
  );
}

export function PublicCollectionPage() {
  const { slug } = useParams({ from: '/p/$slug' });
  const { data, isPending, error } = usePublicCollection(slug);
  return (
    <div className="min-h-dvh">
      <PublicBar />
      <main
        className="mx-auto grid max-w-[1400px] gap-5 px-4 pt-6 pb-20 sm:px-8 sm:pt-8"
        data-accent={data?.collection.accent}
      >
        {isPending ? (
          <Spinner />
        ) : error ? (
          <ErrorBox>{errorMessage(error)}</ErrorBox>
        ) : (
          data && (
            <>
              <div className="grid gap-1">
                <Caps>
                  {data.collection.ownerName}’s collection · {data.items.length} items
                </Caps>
                <h1 className="text-[clamp(2rem,5vw,2.8rem)] leading-none font-bold">
                  {data.collection.name}
                  <span className="ml-1.5 inline-block size-[0.32em] rounded-[2px] bg-accent align-[0.08em]" />
                </h1>
              </div>
              <Wall>
                {data.items.map((it) => (
                  <ItemCard
                    key={it.id}
                    item={it}
                    card={data.template.card}
                    fields={data.template.fields}
                    collectionName={data.collection.name}
                    to={{ to: '/p/$slug/$itemId', params: { slug, itemId: it.id } }}
                  />
                ))}
              </Wall>
            </>
          )
        )}
      </main>
    </div>
  );
}

export function PublicItemPage() {
  const { slug, itemId } = useParams({ from: '/p/$slug/$itemId' });
  const { data, isPending, error } = usePublicCollection(slug);
  const item = data?.items.find((i) => i.id === itemId);
  return (
    <div className="min-h-dvh">
      <PublicBar />
      <div className="dark-scope min-h-[calc(100dvh-53px)]">
        <div className="border-b border-line px-4 py-3.5 sm:px-8">
          <Link to="/p/$slug" params={{ slug }} className="text-[0.88rem] text-ink-muted no-underline hover:text-ink">
            ← {data?.collection.name ?? 'Back'}
          </Link>
        </div>
        <div className="px-4 pt-6 pb-16 sm:px-8 md:pl-12">
          {isPending ? (
            <Spinner />
          ) : error ? (
            <ErrorBox>{errorMessage(error)}</ErrorBox>
          ) : !item || !data ? (
            <ErrorBox>That item isn’t in this shared collection.</ErrorBox>
          ) : (
            <ItemView
              item={item}
              fields={data.template.fields}
              layout={data.template.itemLayout}
              shape={coverShape(data.template.card)}
              collectionName={data.collection.name}
            />
          )}
        </div>
      </div>
    </div>
  );
}
