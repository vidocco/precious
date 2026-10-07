import {
  ACCENTS,
  type Accent,
  type CollectionDto,
  collectionInputSchema,
  type EditAccess,
  type TemplateDto,
  type View,
  type Visibility,
} from '@precious/shared';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../../api/client.ts';
import { useCollection, useCollectionMutations, useMe, useTemplates, useUsers } from '../../api/queries.ts';
import { Figures } from '../../components/Figures.tsx';
import {
  Button,
  Caps,
  cx,
  EmptyState,
  ErrorBox,
  Field,
  Segmented,
  Select,
  Spinner,
  TextField,
} from '../../components/ui.tsx';

interface FormState {
  templateId: string;
  name: string;
  accent: Accent;
  accessionPrefix: string;
  visibility: Visibility;
  editAccess: EditAccess;
  defaultView: View;
  quickAdd: boolean;
  ownerId: string;
}

function Preview({ form, template }: { form: FormState; template?: TemplateDto }) {
  return (
    <div
      data-accent={form.accent}
      className="relative grid min-h-[420px] content-start gap-3.5 border-line bg-wall px-4 py-6 lg:border-l sm:px-8"
    >
      <Caps>Preview</Caps>
      <h2 className="text-[2.2rem] leading-none font-bold">
        {form.name || 'Untitled collection'}
        <span className="ml-1.5 inline-block size-[0.32em] rounded-[2px] bg-accent align-[0.08em]" />
      </h2>
      {template && (
        <Figures
          figures={template.header.figures.map((f) => {
            const field = 'field' in f ? template.fields.find((x) => x.id === f.field) : undefined;
            const format =
              f.kind === 'sum' || f.kind === 'avg' ? (field?.type === 'money' ? 'money' : 'number') : 'count';
            return { id: f.id, label: f.label, value: 0, format, currency: field?.options.currency };
          })}
        />
      )}
      <EmptyState title="No items yet">Press + to add the first one, or add one by hand.</EmptyState>
      <span
        className="absolute right-6 bottom-6 grid size-[58px] place-items-center rounded-full bg-accent text-[1.8rem] text-accent-ink shadow-float"
        aria-hidden="true"
      >
        +
      </span>
    </div>
  );
}

export function CollectionFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const params = useParams({ strict: false }) as { collectionId?: string };
  const existing = useCollection(params.collectionId ?? '');
  const { data: templates } = useTemplates();
  const { data: me } = useMe();
  const { data: users } = useUsers();
  const { create, update } = useCollectionMutations();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (form) return;
    if (mode === 'edit') {
      const c: CollectionDto | undefined = existing.data;
      if (c) {
        setForm({
          templateId: c.templateId,
          name: c.name,
          accent: c.accent,
          accessionPrefix: c.accessionPrefix,
          visibility: c.visibility,
          editAccess: c.editAccess,
          defaultView: c.defaultView,
          quickAdd: c.quickAdd,
          ownerId: c.ownerId,
        });
      }
    } else if (templates?.length) {
      const first = templates.find((t) => t.name === 'Video games') ?? templates[0];
      setForm({
        templateId: first?.id ?? '',
        name: '',
        accent: 'ultramarine',
        accessionPrefix: first?.accessionPrefix ?? 'IT',
        visibility: 'household',
        editAccess: 'owner',
        defaultView: 'wall',
        quickAdd: false,
        ownerId: me?.id ?? '',
      });
    }
  }, [mode, existing.data, templates, me, form]);

  if (!form || !templates)
    return (
      <div className="px-8">
        <Spinner />
      </div>
    );
  const template = templates.find((t) => t.id === form.templateId);
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
  const busy = create.isPending || update.isPending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const parsed = collectionInputSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setError('');
    try {
      if (mode === 'create') {
        const c = await create.mutateAsync(parsed.data);
        navigate({ to: '/c/$collectionId', params: { collectionId: c.id } });
      } else if (params.collectionId) {
        const { templateId: _t, ...rest } = parsed.data;
        const ownerChange =
          me?.role === 'admin' && form.ownerId !== existing.data?.ownerId ? { ownerId: form.ownerId } : {};
        await update.mutateAsync({ id: params.collectionId, ...rest, ...ownerChange });
        navigate({ to: '/c/$collectionId', params: { collectionId: params.collectionId } });
      }
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) setErrors(err.issues);
    }
  }

  return (
    <div className="grid lg:grid-cols-2">
      <form onSubmit={onSubmit} className="grid content-start gap-5 px-4 pt-6 pb-16 sm:px-8 sm:pt-8" noValidate>
        <h1 className="text-[1.9rem] leading-none font-bold">
          {mode === 'create' ? 'New collection' : `Edit ${existing.data?.name}`}
        </h1>
        {error && <ErrorBox>{error}</ErrorBox>}
        <TextField
          label="Name"
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="e.g. Retro handhelds"
          error={errors.name}
          autoFocus
          required
        />
        <Field
          label="Template"
          help={
            mode === 'create'
              ? `Linked: changes to the ${template?.name ?? ''} template apply to this collection too.`
              : 'A collection keeps the template it was created with.'
          }
        >
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={mode === 'edit' && t.id !== form.templateId}
                aria-pressed={t.id === form.templateId}
                onClick={() => set({ templateId: t.id, accessionPrefix: t.accessionPrefix })}
                className={cx(
                  'grid gap-0.5 rounded-[10px] border bg-surface px-3 py-2.5 text-left disabled:opacity-40',
                  t.id === form.templateId ? 'border-accent shadow-[inset_0_0_0_1px_var(--accent)]' : 'border-line',
                )}
              >
                <b className="text-[0.92rem]">{t.name}</b>
                <span className="text-[0.74rem] text-ink-muted">{t.fields.filter((f) => !f.hidden).length} fields</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Colour">
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a}
                type="button"
                data-accent={a}
                aria-label={a}
                aria-pressed={form.accent === a}
                onClick={() => set({ accent: a })}
                className={cx(
                  'size-7 rounded-[8px] border-2 bg-accent',
                  form.accent === a ? 'border-ink shadow-[inset_0_0_0_2px_var(--surface)]' : 'border-transparent',
                )}
              />
            ))}
          </div>
        </Field>
        <TextField
          label="Accession prefix"
          value={form.accessionPrefix}
          onChange={(e) => set({ accessionPrefix: e.target.value.toUpperCase() })}
          help="Items are numbered like VG·0142. Up to 4 capital letters or digits."
          error={errors.accessionPrefix}
          maxLength={4}
          className="max-w-32"
        />
        <Field label="Who can see it">
          <Segmented
            label="Who can see it"
            value={form.visibility}
            onChange={(v) => set({ visibility: v })}
            options={[
              { value: 'private', label: 'Only me' },
              { value: 'household', label: 'Household' },
              { value: 'public', label: 'Anyone with the link' },
            ]}
          />
        </Field>
        <Field
          label="Who can edit it"
          help={form.visibility === 'private' ? 'Private collections can only be edited by you.' : undefined}
        >
          <Segmented
            label="Who can edit it"
            value={form.editAccess}
            onChange={(v) => set({ editAccess: v })}
            options={[
              { value: 'owner', label: 'Only me' },
              { value: 'household', label: 'Household members', disabled: form.visibility === 'private' },
            ]}
          />
        </Field>
        <Field label="Opens as">
          <Segmented
            label="Default view"
            value={form.defaultView}
            onChange={(v) => set({ defaultView: v })}
            options={[
              { value: 'wall', label: 'Wall' },
              { value: 'shelf', label: 'Shelf' },
              { value: 'table', label: 'Table' },
            ]}
          />
        </Field>
        {template && template.bindings.search.length > 0 && (
          <Field
            label="After picking a search result"
            help="With quick add, a found item is saved straight away when no match needs choosing; you can still edit it after."
          >
            <Segmented
              label="After picking a search result"
              value={form.quickAdd ? 'quick' : 'review'}
              onChange={(v) => set({ quickAdd: v === 'quick' })}
              options={[
                { value: 'review', label: 'Check the details first' },
                { value: 'quick', label: 'Quick add' },
              ]}
            />
          </Field>
        )}
        {mode === 'edit' && me?.role === 'admin' && users && (
          <Field label="Owner" htmlFor="owner">
            <Select
              id="owner"
              value={form.ownerId}
              onChange={(e) => set({ ownerId: e.target.value })}
              className="max-w-72"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : mode === 'create' ? 'Create collection' : 'Save changes'}
          </Button>
          {mode === 'edit' && params.collectionId ? (
            <Link to="/c/$collectionId" params={{ collectionId: params.collectionId }}>
              <Button tabIndex={-1}>Cancel</Button>
            </Link>
          ) : (
            <Link to="/">
              <Button tabIndex={-1}>Cancel</Button>
            </Link>
          )}
        </div>
      </form>
      <Preview form={form} template={template} />
    </div>
  );
}
