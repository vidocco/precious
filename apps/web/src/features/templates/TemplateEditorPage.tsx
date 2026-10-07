import {
  EMPTY_BINDINGS,
  type FieldDefinition,
  type TemplateData,
  type TemplateDto,
  templateInputSchema,
} from '@precious/shared';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../../api/client.ts';
import { useTemplate, useTemplateMutations } from '../../api/queries.ts';
import { Button, ConfirmStrip, cx, EmptyState, ErrorBox, Spinner, TextField } from '../../components/ui.tsx';
import { BindingsTab } from './BindingsTab.tsx';
import { EMPTY_TEMPLATE } from './editorUtils.ts';
import { FieldsTab } from './FieldsTab.tsx';
import { CardTab, HeaderTab, ItemPageTab } from './LayoutTabs.tsx';

const TABS = ['Fields', 'Card', 'Item page', 'Collection header', 'Shelf', 'Data sources'] as const;
type Tab = (typeof TABS)[number];

function toData(t: TemplateDto): TemplateData {
  const { name, description, icon, accessionPrefix, fields, card, itemLayout, header } = t;
  const bindings = { ...EMPTY_BINDINGS, ...t.bindings };
  return structuredClone({ name, description, icon, accessionPrefix, fields, card, itemLayout, header, bindings });
}

function pruneFill(fill: Record<string, string>, ok: (r: string) => boolean) {
  return Object.fromEntries(Object.entries(fill).filter(([target]) => ok(target)));
}

/** Drops layout and data source references to fields that no longer exist. */
function pruneRefs(t: TemplateData, fields: FieldDefinition[]): TemplateData {
  const ids = new Set(fields.map((f) => f.id));
  const ok = (r: string | null) => r === null || r.startsWith('$') || ids.has(r);
  return {
    ...t,
    fields,
    card: {
      slots: {
        tl: ok(t.card.slots.tl) ? t.card.slots.tl : null,
        tr: ok(t.card.slots.tr) ? t.card.slots.tr : null,
        b: ok(t.card.slots.b) ? t.card.slots.b : null,
      },
      lines: t.card.lines.map((l) => ({ ...l, fields: l.fields.filter(ok) })).filter((l) => l.fields.length),
    },
    itemLayout: {
      info: t.itemLayout.info.filter(ok),
      sections: t.itemLayout.sections
        .map((s) => ({ ...s, fields: s.fields.filter(ok) }))
        .filter((s) => s.fields.length),
    },
    header: { figures: t.header.figures.filter((f) => f.kind === 'count' || ids.has(f.field)) },
    bindings: {
      search: t.bindings.search.map((p) => ({ ...p, fill: pruneFill(p.fill, ok) })),
      steps: t.bindings.steps.map((s) => {
        const match = s.match && {
          ...s.match,
          yearField: s.match.yearField && ok(s.match.yearField) ? s.match.yearField : undefined,
        };
        return { ...s, fill: pruneFill(s.fill, ok), ...(match && { match }) };
      }),
      computed: t.bindings.computed.filter((c) => ids.has(c.field)),
    },
  };
}

export function TemplateEditorPage({ mode }: { mode: 'create' | 'edit' }) {
  const params = useParams({ strict: false }) as { templateId?: string };
  const { from } = useSearch({ strict: false }) as { from?: string };
  const source = useTemplate(mode === 'edit' ? params.templateId : from);
  const { create, update, remove } = useTemplateMutations();
  const navigate = useNavigate();
  const [t, setT] = useState<TemplateData | null>(null);
  const [tab, setTab] = useState<Tab>('Fields');
  const [issues, setIssues] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (t) return;
    if (mode === 'create' && !from) setT(structuredClone(EMPTY_TEMPLATE));
    else if (source.data) {
      const data = toData(source.data);
      setT(mode === 'create' ? { ...data, name: `${data.name} (copy)` } : data);
    }
  }, [mode, from, source.data, t]);

  if (source.isError) return <ErrorBox>{errorMessage(source.error)}</ErrorBox>;
  if (!t) return <Spinner />;
  const readOnly = mode === 'edit' && source.data && !source.data.canEdit;
  const set = (patch: Partial<TemplateData>) => {
    setSaved(false);
    setT((prev) => (prev ? { ...prev, ...patch } : prev));
  };
  const busy = create.isPending || update.isPending;

  async function save() {
    if (!t) return;
    const parsed = templateInputSchema.safeParse(t);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((i) => i.message));
      return;
    }
    setIssues([]);
    try {
      if (mode === 'create') {
        const created = await create.mutateAsync(parsed.data);
        navigate({ to: '/data/templates/$templateId', params: { templateId: created.id } });
      } else if (params.templateId) {
        await update.mutateAsync({ id: params.templateId, ...parsed.data });
        setSaved(true);
      }
    } catch (err) {
      setIssues(
        err instanceof ApiError && err.body.issues?.length
          ? err.body.issues.map((i) => i.message)
          : [errorMessage(err)],
      );
    }
  }

  return (
    <div className="grid gap-5">
      <nav aria-label="Breadcrumb" className="flex gap-2 text-[0.88rem] text-ink-muted">
        <Link to="/data/templates" className="text-ink-muted no-underline hover:text-ink">
          Templates
        </Link>
        <span>/</span>
        <b className="font-semibold text-ink">{t.name || 'New template'}</b>
      </nav>
      {confirming && source.data && (
        <ConfirmStrip
          message={
            <>
              Delete the <b>{source.data.name}</b> template? This can’t be undone.
            </>
          }
          confirmLabel="Delete template"
          busy={remove.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              await remove.mutateAsync(source.data.id);
              navigate({ to: '/data/templates' });
            } catch (err) {
              setIssues([errorMessage(err)]);
              setConfirming(false);
            }
          }}
        />
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-[2rem] leading-none font-bold">
            {mode === 'create' ? 'New template' : t.name || 'Untitled template'}
          </h1>
          {source.data && mode === 'edit' && (
            <span className="text-[0.86rem] text-ink-muted">
              {source.data.usage.length
                ? `Used by ${source.data.usage.length} collection${source.data.usage.length === 1 ? '' : 's'}: ${source.data.usage.map((u) => `${u.name} (${u.ownerName.split(' ')[0]})`).join(', ')}`
                : 'Not used by any collection yet'}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {mode === 'edit' && source.data && (
            <>
              <Link to="/data/templates/new" search={{ from: source.data.id }}>
                <Button icon="copy" tabIndex={-1}>
                  Duplicate
                </Button>
              </Link>
              {source.data.canEdit && source.data.usage.length === 0 && (
                <Button icon="trash" variant="danger" onClick={() => setConfirming(true)}>
                  Delete
                </Button>
              )}
            </>
          )}
          {!readOnly && (
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : mode === 'create' ? 'Create template' : saved ? 'Saved' : 'Save changes'}
            </Button>
          )}
        </div>
      </div>
      {readOnly && (
        <ErrorBox>
          Only the person who made this template or an admin can change it. Duplicate it to make your own version.
        </ErrorBox>
      )}
      {issues.length > 0 && (
        <ErrorBox>
          <ul className="m-0 list-disc pl-5">
            {issues.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </ErrorBox>
      )}
      <fieldset disabled={!!readOnly} className="m-0 grid gap-5 border-0 p-0">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_140px]">
          <TextField
            label="Name"
            value={t.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. Plants"
          />
          <TextField label="Description" value={t.description} onChange={(e) => set({ description: e.target.value })} />
          <TextField
            label="Default prefix"
            value={t.accessionPrefix}
            maxLength={4}
            onChange={(e) => set({ accessionPrefix: e.target.value.toUpperCase() })}
            help="For new collections"
          />
        </div>
        <div
          role="tablist"
          aria-label="Template sections"
          className="flex gap-0.5 overflow-x-auto border-b border-line"
        >
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={cx(
                '-mb-px flex-none border-b-2 px-3 py-2 text-[0.88rem]',
                tab === name ? 'border-accent font-semibold text-ink' : 'border-transparent text-ink-muted',
              )}
            >
              {name}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={tab}>
          {tab === 'Fields' && (
            <FieldsTab
              fields={t.fields}
              saved={mode === 'edit' ? (source.data?.fields ?? []) : []}
              onChange={(fields) => setT(pruneRefs(t, fields))}
            />
          )}
          {tab === 'Card' && <CardTab t={t} set={set} />}
          {tab === 'Item page' && <ItemPageTab t={t} set={set} />}
          {tab === 'Collection header' && <HeaderTab t={t} set={set} />}
          {tab === 'Shelf' && (
            <EmptyState title="Coming with the shelf view">
              Here you’ll set how thick and tall each item is on the shelf: a fixed size, read from a field, or by rules
              on another field such as the platform.
            </EmptyState>
          )}
          {tab === 'Data sources' && <BindingsTab t={t} set={set} />}
        </div>
      </fieldset>
    </div>
  );
}
