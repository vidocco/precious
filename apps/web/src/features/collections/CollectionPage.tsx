import type { CollectionDto, FieldDefinition, ItemDto, TemplateDto } from '@precious/shared';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { Button as AriaButton, Checkbox, CheckboxGroup, Dialog, DialogTrigger, Popover } from 'react-aria-components';
import { errorMessage } from '../../api/client.ts';
import { useCollection, useCollectionMutations, useFigures, useItems, useMe, useTemplate } from '../../api/queries.ts';
import { Figures } from '../../components/Figures.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ItemCard, Wall } from '../../components/ItemCard.tsx';
import { Snippet } from '../../components/Snippet.tsx';
import {
  Button,
  Caps,
  Chip,
  ConfirmStrip,
  cx,
  EmptyState,
  ErrorBox,
  Segmented,
  Select,
  Spinner,
} from '../../components/ui.tsx';
import { refLabel, refValue } from '../../lib/format.ts';
import { useDebounced, useStoredState } from '../../lib/hooks.ts';
import { AddSheet } from '../items/AddSheet.tsx';
import { CollectionHistory } from './CollectionHistory.tsx';
import { VISIBILITY_LABEL } from './labels.ts';

const PAGE = 60;
const FILTERABLE = new Set(['choice', 'multichoice', 'tags', 'boolean']);

export interface CollectionSearch {
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  view?: 'wall' | 'table';
  filter?: string[];
  /** The add sheet is open, searching for this. */
  add?: string;
}

const fabClass =
  'fixed right-[max(20px,env(safe-area-inset-right,0px))] bottom-[max(20px,env(safe-area-inset-bottom,0px))] z-20 grid size-[58px] place-items-center rounded-full bg-accent text-accent-ink shadow-float transition hover:scale-105';

/** The round "+": opens the search sheet when the template has data sources, the form otherwise. */
export function Fab({ collectionId, onAdd }: { collectionId: string; onAdd?: () => void }) {
  if (onAdd) {
    return (
      <button type="button" onClick={onAdd} aria-label="Add item" title="Add item" className={fabClass}>
        <Icon name="plus" size={26} />
      </button>
    );
  }
  return (
    <Link
      to="/c/$collectionId/new"
      params={{ collectionId }}
      aria-label="Add item"
      title="Add item"
      className={fabClass}
    >
      <Icon name="plus" size={26} />
    </Link>
  );
}

function filterOptions(fields: FieldDefinition[]) {
  return fields
    .filter((f) => !f.hidden && FILTERABLE.has(f.type))
    .map((f) => ({
      field: f,
      values: f.type === 'boolean' ? ['true', 'false'] : (f.options.choices ?? []),
    }))
    .filter((o) => o.values.length > 0);
}

function filterLabel(token: string, fields: FieldDefinition[]) {
  const [id, value] = [token.slice(0, token.indexOf(':')), token.slice(token.indexOf(':') + 1)];
  const f = fields.find((x) => x.id === id);
  if (!f) return token;
  if (f.type === 'boolean') return `${f.label}: ${value === 'true' ? 'Yes' : 'No'}`;
  return `${f.label}: ${value}`;
}

function Header({ collection, template }: { collection: CollectionDto; template: TemplateDto }) {
  const { data: me } = useMe();
  const { remove } = useCollectionMutations();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const owner = me && me.id !== collection.ownerId ? ` · ${collection.ownerName}'s` : '';

  return (
    <>
      {confirming && (
        <div className="-mx-4 -mt-6 sm:-mx-8 sm:-mt-8">
          <ConfirmStrip
            message={
              <>
                Delete <b>{collection.name}</b> and its {collection.itemCount}{' '}
                {collection.itemCount === 1 ? 'item' : 'items'}? This can’t be undone.
              </>
            }
            confirmLabel="Delete collection"
            busy={remove.isPending}
            onCancel={() => setConfirming(false)}
            onConfirm={async () => {
              try {
                await remove.mutateAsync(collection.id);
                navigate({ to: '/' });
              } catch (err) {
                setError(errorMessage(err));
                setConfirming(false);
              }
            }}
          />
        </div>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3.5">
        <div className="grid gap-1">
          <Caps>
            {template.name} template · {VISIBILITY_LABEL[collection.visibility]}
            {owner}
          </Caps>
          <h1 className="text-[clamp(2rem,5vw,2.8rem)] leading-none font-bold">
            {collection.name}
            <span className="ml-1.5 inline-block size-[0.32em] rounded-[2px] bg-accent align-[0.08em]" />
          </h1>
        </div>
        {collection.canDelete && (
          <div className="flex gap-2">
            <Link to="/c/$collectionId/edit" params={{ collectionId: collection.id }}>
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
    </>
  );
}

function ItemTable({
  items,
  fields,
  columns,
  sort,
  dir,
  onSort,
}: {
  items: ItemDto[];
  fields: FieldDefinition[];
  columns: string[];
  sort: string;
  dir: 'asc' | 'desc';
  onSort: (ref: string) => void;
}) {
  const navigate = useNavigate();
  const cols = ['$accession', '$title', ...columns];
  return (
    <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
      <table className="w-full border-collapse text-[0.88rem]">
        <thead>
          <tr>
            {cols.map((ref) => (
              <th key={ref} scope="col" className="border-b border-line px-3.5 py-2 text-left whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => onSort(ref)}
                  className="inline-flex items-center gap-1 text-[0.68rem] font-semibold tracking-[0.08em] text-ink-muted uppercase"
                >
                  {refLabel(ref, fields)}
                  {sort === ref && <Icon name={dir === 'asc' ? 'up' : 'down'} size={12} />}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              onClick={() => navigate({ to: '/i/$itemId', params: { itemId: item.id } })}
              className="cursor-pointer hover:bg-surface-sunk"
            >
              {cols.map((ref) => (
                <td key={ref} className="max-w-[28ch] truncate border-b border-line px-3.5 py-2 tabular">
                  {ref === '$title' ? (
                    <Link to="/i/$itemId" params={{ itemId: item.id }} className="font-semibold text-ink no-underline">
                      {item.title}
                    </Link>
                  ) : (
                    refValue(ref, item, fields)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColumnPicker({
  fields,
  value,
  onChange,
}: {
  fields: FieldDefinition[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <DialogTrigger>
      <AriaButton className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-1.5 text-[0.88rem] outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <Icon name="columns" size={16} />
        Columns
      </AriaButton>
      <Popover
        placement="bottom end"
        className="max-h-[60vh] w-60 overflow-auto rounded-[12px] border border-line bg-surface p-3 shadow-float"
      >
        <Dialog aria-label="Columns" className="outline-none">
          <CheckboxGroup value={value} onChange={onChange} aria-label="Columns to show" className="grid gap-1.5">
            {fields
              .filter((f) => !f.hidden && f.type !== 'longtext')
              .map((f) => (
                <Checkbox
                  key={f.id}
                  value={f.id}
                  className="group flex cursor-pointer items-center gap-2 text-[0.9rem]"
                >
                  <span className="grid size-4 place-items-center rounded-[4px] border border-ink-faint group-data-[selected]:border-accent group-data-[selected]:bg-accent">
                    <svg
                      viewBox="0 0 12 12"
                      className="hidden size-3 fill-none stroke-accent-ink stroke-2 group-data-[selected]:block"
                      aria-hidden="true"
                    >
                      <path d="M2.5 6.5 5 9l4.5-6" />
                    </svg>
                  </span>
                  {f.label}
                </Checkbox>
              ))}
          </CheckboxGroup>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

export function CollectionPage() {
  const { collectionId } = useParams({ from: '/app/c/$collectionId' });
  const search = useSearch({ from: '/app/c/$collectionId' }) as CollectionSearch;
  const navigate = useNavigate({ from: '/c/$collectionId' });
  const collection = useCollection(collectionId);
  const template = useTemplate(collection.data?.templateId);
  const figures = useFigures(collectionId);

  const view = search.view ?? collection.data?.defaultView ?? 'wall';
  const sort = search.sort ?? '$added';
  const dir = search.dir ?? (sort === '$added' ? 'desc' : 'asc');
  const filters = search.filter ?? [];
  const [q, setQ] = useState(search.q ?? '');
  const debouncedQ = useDebounced(q.trim(), 250);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    if ((search.q ?? '') !== debouncedQ)
      navigate({ search: (s: CollectionSearch) => ({ ...s, q: debouncedQ || undefined }), replace: true });
  }, [debouncedQ, navigate, search.q]);

  const setAddQuery = useCallback(
    (add: string) => navigate({ search: (s: CollectionSearch) => ({ ...s, add }), replace: true }),
    [navigate],
  );

  const items = useItems(collectionId, { q: search.q, sort, dir, filter: filters, limit });
  const fields = template.data?.fields ?? [];
  const [columns, setColumns] = useStoredState<string[]>(
    `precious.columns.${collectionId}`,
    fields
      .filter((f) => !f.hidden && f.type !== 'longtext')
      .slice(0, 5)
      .map((f) => f.id),
  );

  if (collection.isError)
    return (
      <div className="p-8">
        <ErrorBox>{errorMessage(collection.error)}</ErrorBox>
      </div>
    );
  if (!collection.data || !template.data)
    return (
      <div className="px-8">
        <Spinner />
      </div>
    );
  const c = collection.data;
  const t = template.data;
  const setSearch = (patch: Partial<CollectionSearch>) =>
    navigate({ search: (s: CollectionSearch) => ({ ...s, ...patch }), replace: true });
  const opts = filterOptions(fields);
  const total = items.data?.total ?? 0;

  return (
    <div data-accent={c.accent} className="relative grid gap-5 px-4 pt-6 pb-28 sm:px-8 sm:pt-8">
      <Header collection={c} template={t} />
      {figures.data && <Figures figures={figures.data} />}
      <CollectionHistory collectionId={c.id} template={t} />

      <div className="flex flex-wrap items-center gap-2">
        <label
          className={cx(
            'flex max-w-[320px] min-w-0 flex-[1_1_220px] items-center gap-2 rounded-[10px] border bg-surface px-2.5 py-1.5 text-[0.88rem] text-ink-faint',
            q ? 'border-accent' : 'border-line',
          )}
        >
          <Icon name="search" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search in ${c.name}`}
            aria-label={`Search in ${c.name}`}
            className="min-w-0 flex-1 bg-transparent text-ink outline-none"
          />
          {q && (
            <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="text-ink-muted">
              <Icon name="x" size={15} />
            </button>
          )}
        </label>
        {opts.length > 0 && (
          <Select
            aria-label="Add a filter"
            value=""
            className="w-auto py-1.5"
            onChange={(e) => {
              const v = e.target.value;
              if (v && !filters.includes(v)) setSearch({ filter: [...filters, v] });
            }}
          >
            <option value="">Filter…</option>
            {opts.map((o) => (
              <optgroup key={o.field.id} label={o.field.label}>
                {o.values.map((v) => (
                  <option key={v} value={`${o.field.id}:${v}`}>
                    {o.field.type === 'boolean' ? (v === 'true' ? 'Yes' : 'No') : v}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        )}
        <Select
          aria-label="Sort by"
          value={sort}
          disabled={!!search.q}
          className="w-auto py-1.5"
          onChange={(e) => setSearch({ sort: e.target.value, dir: e.target.value === '$added' ? 'desc' : 'asc' })}
        >
          <option value="$added">Newest first</option>
          <option value="$title">Title</option>
          <option value="$accession">Accession number</option>
          {fields
            .filter((f) => !f.hidden && f.type !== 'longtext')
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
        </Select>
        {sort !== '$added' && !search.q && (
          <Button
            icon={dir === 'asc' ? 'up' : 'down'}
            onClick={() => setSearch({ dir: dir === 'asc' ? 'desc' : 'asc' })}
            aria-label={dir === 'asc' ? 'Ascending' : 'Descending'}
          >
            {dir === 'asc' ? 'A–Z' : 'Z–A'}
          </Button>
        )}
        <span className="flex-1" />
        {view === 'table' && <ColumnPicker fields={fields} value={columns} onChange={setColumns} />}
        <Segmented
          label="View"
          value={view}
          onChange={(v) => setSearch({ view: v as 'wall' | 'table' })}
          options={[
            { value: 'wall', label: 'Wall' },
            { value: 'shelf', label: 'Shelf', disabled: true, title: 'The shelf view arrives in a later version' },
            { value: 'table', label: 'Table' },
          ]}
        />
      </div>

      {(filters.length > 0 || search.q) && (
        <div className="flex flex-wrap items-center gap-2">
          {search.q && (
            <span className="text-[0.88rem] text-ink-muted">
              <strong className="text-ink">
                {total} of {c.itemCount}
              </strong>{' '}
              match “{search.q}”
            </span>
          )}
          {filters.map((f) => (
            <Chip
              key={f}
              pressed
              onClick={() => setSearch({ filter: filters.filter((x) => x !== f) })}
              onRemove={() => setSearch({ filter: filters.filter((x) => x !== f) })}
            >
              {filterLabel(f, fields)}
            </Chip>
          ))}
        </div>
      )}

      {items.isPending ? (
        <Spinner label="Loading items" />
      ) : items.isError ? (
        <ErrorBox>{errorMessage(items.error)}</ErrorBox>
      ) : total === 0 ? (
        search.q || filters.length ? (
          <EmptyState title="Nothing matches">Try fewer filters or a different search.</EmptyState>
        ) : (
          <EmptyState title="No items yet">
            {c.canEdit ? 'Press + to add the first one.' : 'Nothing has been added to this collection yet.'}
          </EmptyState>
        )
      ) : view === 'table' ? (
        <ItemTable
          items={items.data.items}
          fields={fields}
          columns={columns.filter((id) => fields.some((f) => f.id === id && !f.hidden))}
          sort={sort}
          dir={dir}
          onSort={(ref) => setSearch({ sort: ref, dir: sort === ref && dir === 'asc' ? 'desc' : 'asc' })}
        />
      ) : (
        <Wall>
          {items.data.items.map((it) => (
            <ItemCard key={it.id} item={it} card={t.card} fields={fields} match={it.match} collectionName={c.name} />
          ))}
        </Wall>
      )}

      {items.data && items.data.items.length < total && (
        <div className="flex justify-center">
          <Button onClick={() => setLimit((l) => l + PAGE)} disabled={items.isFetching}>
            {items.isFetching ? 'Loading…' : `Show more (${total - items.data.items.length} left)`}
          </Button>
        </div>
      )}

      {search.q && items.data?.items.some((i) => i.match) && view === 'table' && (
        <div className="grid gap-1 text-[0.8rem] text-ink-muted">
          {items.data.items.map((i) =>
            i.match ? (
              <span key={i.id}>
                {i.title} · {i.match.label}: <Snippet text={i.match.snippet} />
              </span>
            ) : null,
          )}
        </div>
      )}

      {c.canEdit && (
        <Fab
          collectionId={c.id}
          onAdd={t.bindings.search.length ? () => setSearch({ add: search.add ?? '' }) : undefined}
        />
      )}
      {c.canEdit && search.add !== undefined && t.bindings.search.length > 0 && (
        <AddSheet
          collection={c}
          template={t}
          query={search.add}
          onQueryChange={setAddQuery}
          onClose={() => setSearch({ add: undefined })}
        />
      )}
    </div>
  );
}
