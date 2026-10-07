import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useCollection, useItem, useItemMutations, useTemplate, useUsers } from '../../api/queries.ts';
import { Button, ConfirmStrip, ErrorBox, Spinner } from '../../components/ui.tsx';
import { ItemView } from './ItemView.tsx';
import { RefreshSheet } from './RefreshSheet.tsx';

export function ItemPage() {
  const { itemId } = useParams({ from: '/app/i/$itemId' });
  const item = useItem(itemId);
  const collection = useCollection(item.data?.collectionId ?? '');
  const template = useTemplate(collection.data?.templateId);
  const { data: users } = useUsers();
  const { remove, update } = useItemMutations();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  if (item.isError)
    return (
      <div className="p-8">
        <ErrorBox>{errorMessage(item.error)}</ErrorBox>
      </div>
    );
  if (!item.data || !collection.data || !template.data) {
    return (
      <div className="dark-scope min-h-[calc(100dvh-57px)] px-8">
        <Spinner />
      </div>
    );
  }
  const it = item.data;
  const c = collection.data;
  const canRefresh = c.canEdit && template.data.bindings.steps.length > 0 && Object.keys(it.externalRefs).length > 0;

  return (
    <div className="dark-scope min-h-[calc(100dvh-57px)]">
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-4 py-3.5 sm:px-8">
        <nav aria-label="Breadcrumb" className="flex gap-2 text-[0.88rem] text-ink-muted">
          <Link
            to="/c/$collectionId"
            params={{ collectionId: c.id }}
            className="text-ink-muted no-underline hover:text-ink"
          >
            {c.name}
          </Link>
          <span>/</span>
          <b className="font-semibold text-ink tabular">{it.accession}</b>
        </nav>
        {c.canEdit && (
          <div className="flex gap-2">
            {canRefresh && (
              <Button icon="refresh" onClick={() => setRefreshing(true)}>
                Refresh
              </Button>
            )}
            <Link to="/i/$itemId/edit" params={{ itemId: it.id }}>
              <Button icon="edit" tabIndex={-1}>
                Edit
              </Button>
            </Link>
            <Button icon="trash" variant="danger" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          </div>
        )}
      </div>
      {confirming && (
        <ConfirmStrip
          message={
            <>
              Delete <b>{it.title}</b>? Its fields and cover go with it. This can’t be undone.
            </>
          }
          confirmLabel="Delete item"
          busy={remove.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              await remove.mutateAsync(it.id);
              navigate({ to: '/c/$collectionId', params: { collectionId: c.id } });
            } catch (err) {
              setError(errorMessage(err));
              setConfirming(false);
            }
          }}
        />
      )}
      <div className="grid gap-4 px-4 pt-6 pb-16 sm:px-8 md:pl-12">
        {error && <ErrorBox>{error}</ErrorBox>}
        <ItemView
          item={it}
          fields={template.data.fields}
          layout={template.data.itemLayout}
          collectionName={c.name}
          users={users}
          onUnlock={
            c.canEdit
              ? (ref) => update.mutate({ id: it.id, unlock: [ref] }, { onError: (err) => setError(errorMessage(err)) })
              : undefined
          }
        />
      </div>
      {refreshing && <RefreshSheet item={it} template={template.data} onClose={() => setRefreshing(false)} />}
    </div>
  );
}
