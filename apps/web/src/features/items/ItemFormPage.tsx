import { buildItemSchema, type FieldDefinition, type ItemDto } from '@precious/shared';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage, mediaUrl } from '../../api/client.ts';
import { uploadImage, useCollection, useItem, useItemMutations, useTemplate, useUsers } from '../../api/queries.ts';
import { Icon } from '../../components/Icon.tsx';
import { Button, Caps, ErrorBox, Spinner, TextField } from '../../components/ui.tsx';
import { FieldInput, type FormValue } from './FieldInput.tsx';

type Cover = { id: string; color: string | null } | null;

function CoverPicker({ cover, onChange }: { cover: Cover; onChange: (c: Cover) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const img = await uploadImage(file);
      onChange({ id: img.id, color: img.color });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <div className="grid content-start gap-2">
      <Caps>Cover</Caps>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void onFile(e.dataTransfer.files[0]);
        }}
        className="relative grid aspect-[3/4] w-full max-w-[220px] place-items-center overflow-hidden rounded-cover border-[1.5px] border-dashed border-line bg-wall text-ink-muted"
        style={cover ? { background: cover.color ?? undefined, borderStyle: 'solid' } : undefined}
        aria-label={cover ? 'Replace cover' : 'Upload a cover'}
      >
        {cover ? (
          <img src={mediaUrl(cover.id, 'lg')} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <span className="grid justify-items-center gap-1.5 px-4 text-center text-[0.85rem]">
            <Icon name="image" size={28} />
            {busy ? 'Uploading…' : 'Drop an image here or click to choose one'}
          </span>
        )}
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      {error && <span className="text-[0.8rem] text-danger">{error}</span>}
      {cover && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
            Replace
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

function initialValues(fields: FieldDefinition[], item?: ItemDto): Record<string, FormValue> {
  const out: Record<string, FormValue> = {};
  for (const f of fields) out[f.id] = (item?.data[f.id] as FormValue) ?? undefined;
  return out;
}

export function ItemFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const params = useParams({ strict: false }) as { collectionId?: string; itemId?: string };
  const item = useItem(params.itemId ?? '');
  const collectionId = params.collectionId ?? item.data?.collectionId ?? '';
  const collection = useCollection(collectionId);
  const template = useTemplate(collection.data?.templateId);
  const { data: users } = useUsers();
  const { create, update } = useItemMutations();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [cover, setCover] = useState<Cover>(null);
  const [values, setValues] = useState<Record<string, FormValue> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const fields = (template.data?.fields ?? []).filter((f) => !f.hidden);
  const ready = template.data && collection.data && (mode === 'create' || item.data);

  useEffect(() => {
    if (!ready || values) return;
    if (mode === 'edit' && item.data) {
      setTitle(item.data.title);
      setCover(item.data.cover ? { id: item.data.cover.id, color: item.data.cover.color } : null);
    }
    setValues(initialValues(fields, item.data));
  }, [ready, values, mode, item.data, fields]);

  if (!ready || !values || !template.data || !collection.data)
    return (
      <div className="px-8">
        <Spinner />
      </div>
    );
  const c = collection.data;
  const busy = create.isPending || update.isPending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values || !template.data) return;
    const nextErrors: Record<string, string> = {};
    if (!title.trim()) nextErrors.title = 'Give it a title';
    const parsed = buildItemSchema(template.data.fields).safeParse(values);
    if (!parsed.success) for (const i of parsed.error.issues) nextErrors[String(i.path[0])] = i.message;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setError('');
    try {
      if (mode === 'create') {
        const created = await create.mutateAsync({
          collectionId,
          title,
          coverImageId: cover?.id ?? null,
          data: parsed.data ?? {},
        });
        navigate({ to: '/i/$itemId', params: { itemId: created.id } });
      } else if (params.itemId) {
        // Send every visible field so emptied ones are cleared.
        const data = Object.fromEntries(fields.map((f) => [f.id, values[f.id] ?? null]));
        await update.mutateAsync({ id: params.itemId, title, coverImageId: cover?.id ?? null, data });
        navigate({ to: '/i/$itemId', params: { itemId: params.itemId } });
      }
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) {
        setErrors(Object.fromEntries(Object.entries(err.issues).map(([k, v]) => [k.replace(/^data\./, ''), v])));
      }
    }
  }

  const cancel =
    mode === 'edit' && params.itemId
      ? { to: '/i/$itemId', params: { itemId: params.itemId } }
      : { to: '/c/$collectionId', params: { collectionId } };

  return (
    <form onSubmit={onSubmit} data-accent={c.accent} className="grid gap-6 px-4 pt-6 pb-24 sm:px-8 sm:pt-8" noValidate>
      <div className="grid gap-1">
        <Caps>{c.name}</Caps>
        <h1 className="text-[2rem] leading-none font-bold">
          {mode === 'create' ? 'Add an item' : `Edit ${item.data?.title}`}
        </h1>
        {mode === 'create' && (
          <p className="text-ink-muted">
            Searching data sources to fill this in arrives in a later version; for now, add it by hand.
          </p>
        )}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid gap-8 md:grid-cols-[220px_1fr]">
        <CoverPicker cover={cover} onChange={setCover} />
        <div className="grid content-start gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField
              label={
                <>
                  Title<span className="text-danger"> *</span>
                </>
              }
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              error={errors.title}
              autoFocus={mode === 'create'}
            />
          </div>
          {fields.map((f) => (
            <FieldInput
              key={f.id}
              field={f}
              value={values[f.id]}
              users={users}
              error={errors[f.id]}
              onChange={(v) => setValues((prev) => ({ ...prev, [f.id]: v }))}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 md:pl-[252px]">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : mode === 'create' ? `Add to ${c.name}` : 'Save changes'}
        </Button>
        <Link {...cancel}>
          <Button tabIndex={-1}>Cancel</Button>
        </Link>
      </div>
    </form>
  );
}
