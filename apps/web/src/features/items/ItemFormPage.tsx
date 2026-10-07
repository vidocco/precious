import {
  buildItemSchema,
  type CoverShape,
  coverShape,
  type FieldDefinition,
  type FillResult,
  type FillSource,
  formatValue,
  type ItemDto,
  type PendingMatch,
} from '@precious/shared';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage, mediaUrl } from '../../api/client.ts';
import {
  importRemoteImage,
  uploadImage,
  useCollection,
  useItem,
  useItemMutations,
  useLookupMutations,
  useTemplate,
  useUsers,
} from '../../api/queries.ts';
import { Icon } from '../../components/Icon.tsx';
import { MatchChooser } from '../../components/MatchChooser.tsx';
import { Button, Caps, cx, ErrorBox, Field, Spinner, TextField } from '../../components/ui.tsx';
import { type Draft, getDraft } from '../../lib/drafts.ts';
import { FieldInput, type FormValue } from './FieldInput.tsx';

/** Where a value on the review screen came from: a data source, or you. */
function SourceTag({ source, edited }: { source?: FillSource; edited?: boolean }) {
  if (!source && !edited) return null;
  return (
    <span
      className={cx('max-w-[50%] truncate text-[0.72rem] font-medium', edited ? 'text-ink-muted' : 'text-accent')}
      title={edited ? 'You changed this' : `Filled in from ${source?.name}`}
    >
      {edited ? 'You' : source?.name}
    </span>
  );
}

type Cover = { id: string; color: string | null } | null;

function CoverPicker({
  cover,
  onChange,
  tag,
  loading,
  shape,
}: {
  cover: Cover;
  shape: CoverShape;
  onChange: (c: Cover) => void;
  tag?: ReactNode;
  loading?: boolean;
}) {
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
      <div className="flex max-w-[220px] items-baseline justify-between gap-2">
        <Caps>Cover</Caps>
        {tag}
      </div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void onFile(e.dataTransfer.files[0]);
        }}
        className="relative grid w-full max-w-[220px] place-items-center overflow-hidden rounded-cover border-[1.5px] border-dashed border-line bg-wall text-ink-muted"
        style={{
          aspectRatio: `${shape.width} / ${shape.height}`,
          ...(cover && { background: cover.color ?? undefined, borderStyle: 'solid' }),
        }}
        aria-label={cover ? 'Replace cover' : 'Upload a cover'}
      >
        {cover ? (
          <img
            src={mediaUrl(cover.id, 'lg')}
            alt=""
            className={cx('absolute inset-0 size-full', shape.fit === 'whole' ? 'object-contain' : 'object-cover')}
          />
        ) : (
          <span className="grid justify-items-center gap-1.5 px-4 text-center text-[0.85rem]">
            <Icon name="image" size={28} />
            {busy ? 'Uploading…' : loading ? 'Getting the cover…' : 'Drop an image here or click to choose one'}
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
  const { fill: refill } = useLookupMutations();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { title?: string; draft?: string };
  const [draft] = useState<Draft | undefined>(() => {
    const d = mode === 'create' ? getDraft(search.draft) : undefined;
    return d && d.collectionId === params.collectionId ? d : undefined;
  });

  const [title, setTitle] = useState('');
  const [cover, setCover] = useState<Cover>(null);
  const [values, setValues] = useState<Record<string, FormValue> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  // Review screen: the latest fill, what you changed by hand, and the matches asked about.
  const [fill, setFill] = useState<FillResult | undefined>(draft?.fill);
  const [edited, setEdited] = useState<Set<string>>(() => new Set());
  const [asked, setAsked] = useState<PendingMatch[]>(draft?.fill.pending ?? []);
  const [choices, setChoices] = useState<Record<string, string | null>>({});
  const [coverLoading, setCoverLoading] = useState(false);
  const coverUrl = useRef<string | undefined>(undefined);

  const fields = (template.data?.fields ?? []).filter((f) => !f.hidden);
  const ready = template.data && collection.data && (mode === 'create' || item.data);

  async function loadCover(f: FillResult) {
    if (!f.cover || f.cover.url === coverUrl.current) return;
    coverUrl.current = f.cover.url;
    setCoverLoading(true);
    try {
      const img = await importRemoteImage(f.cover);
      setCover({ id: img.id, color: img.color });
    } catch {
      coverUrl.current = undefined;
    } finally {
      setCoverLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: fills the form once, when everything has loaded
  useEffect(() => {
    if (!ready || values) return;
    if (mode === 'edit' && item.data) {
      setTitle(item.data.title);
      setCover(item.data.cover ? { id: item.data.cover.id, color: item.data.cover.color } : null);
    }
    if (draft) {
      setTitle(draft.fill.title ?? draft.result.title);
      setValues({ ...initialValues(fields), ...(draft.fill.data as Record<string, FormValue>) });
      void loadCover(draft.fill);
      return;
    }
    if (mode === 'create' && search.title) setTitle(search.title);
    setValues(initialValues(fields, item.data));
  }, [ready, values, mode, item.data, fields, draft, search.title]);

  /** Asks the server again with your match choices, keeping whatever you changed by hand. */
  async function choose(step: string, id: string | null) {
    if (!draft) return;
    const next = { ...choices, [step]: id };
    setChoices(next);
    try {
      const f = await refill.mutateAsync({
        collectionId: draft.collectionId,
        provider: draft.provider,
        query: draft.query,
        result: draft.result,
        choices: next,
      });
      setFill(f);
      setAsked((prev) => [...prev, ...f.pending.filter((p) => !prev.some((x) => x.step === p.step))]);
      if (!edited.has('$title') && f.title) setTitle(f.title);
      setValues((prev) => {
        const out = { ...prev };
        for (const field of fields) if (!edited.has(field.id)) out[field.id] = f.data[field.id] as FormValue;
        return out;
      });
      if (!edited.has('$cover')) void loadCover(f);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  const markEdited = (target: string) => setEdited((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));

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
        const sources = fill
          ? Object.fromEntries(
              Object.entries(fill.sources).filter(
                ([target]) => !edited.has(target) && (target !== '$cover' || (cover && coverUrl.current)),
              ),
            )
          : undefined;
        const created = await create.mutateAsync({
          collectionId,
          title,
          coverImageId: cover?.id ?? null,
          data: parsed.data ?? {},
          ...(fill && { externalRefs: fill.refs, sources }),
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
        {fill && (
          <p className="flex flex-wrap items-baseline gap-x-3 text-ink-muted">
            <span>
              Filled in from{' '}
              {[...new Set(Object.values(fill.sources).map((x) => x.name))].join(' and ') || 'nothing yet'}. Check the
              details, then add it.
            </span>
            {draft && (
              <Link
                to="/c/$collectionId"
                params={{ collectionId }}
                search={{ add: draft.query }}
                className="text-[0.9rem] font-semibold"
              >
                Back to results
              </Link>
            )}
          </p>
        )}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {asked.length > 0 && (
        <div className="grid gap-2 md:pl-[252px]">
          {asked.map((p) => (
            <MatchChooser
              key={p.step}
              pending={p}
              value={choices[p.step]}
              disabled={refill.isPending}
              onChoose={(id) => void choose(p.step, id)}
            />
          ))}
        </div>
      )}
      <div className="grid gap-8 md:grid-cols-[220px_1fr]">
        <CoverPicker
          cover={cover}
          shape={coverShape(template.data.card)}
          loading={coverLoading}
          onChange={(c) => {
            markEdited('$cover');
            setCover(c);
          }}
          tag={fill && <SourceTag source={cover ? fill.sources.$cover : undefined} edited={edited.has('$cover')} />}
        />
        <div className="grid content-start gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField
              label={
                <>
                  Title<span className="text-danger"> *</span>
                </>
              }
              value={title}
              onChange={(e) => {
                markEdited('$title');
                setTitle(e.target.value);
              }}
              aside={fill && <SourceTag source={fill.sources.$title} edited={edited.has('$title')} />}
              error={errors.title}
              autoFocus={mode === 'create'}
            />
          </div>
          {fields.map((f) => {
            const computed = template.data?.bindings.computed.find((c) => c.field === f.id);
            if (computed?.kind === 'formula') {
              const shown = values[f.id] === undefined ? '' : formatValue(f, values[f.id]);
              return (
                <Field
                  key={f.id}
                  label={f.label}
                  aside={<span className="text-[0.72rem] font-medium text-ink-faint">Calculated</span>}
                >
                  <div className="rounded-[9px] border border-dashed border-line px-3 py-2 text-[0.93rem] text-ink-muted">
                    {shown || 'Worked out when you save'}
                  </div>
                </Field>
              );
            }
            return (
              <FieldInput
                key={f.id}
                field={f}
                value={values[f.id]}
                users={users}
                error={errors[f.id]}
                aside={
                  fill ? (
                    <SourceTag
                      source={values[f.id] === undefined ? undefined : fill.sources[f.id]}
                      edited={edited.has(f.id)}
                    />
                  ) : (
                    computed && (
                      <span
                        className="text-[0.72rem] font-medium text-ink-faint"
                        title="Looked up again on a schedule. Typing a value here keeps yours instead."
                      >
                        Kept up to date
                      </span>
                    )
                  )
                }
                onChange={(v) => {
                  markEdited(f.id);
                  setValues((prev) => ({ ...prev, [f.id]: v }));
                }}
              />
            );
          })}
        </div>
      </div>
      {fill && fill.warnings.length > 0 && (
        <ul className="m-0 grid list-disc gap-0.5 pl-5 text-[0.85rem] text-ink-muted md:ml-[252px]" aria-label="Notes">
          {fill.warnings.map((w) => (
            <li key={`${w.step}-${w.target}-${w.message}`}>{w.message}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 md:pl-[252px]">
        <Button type="submit" variant="primary" disabled={busy || coverLoading || refill.isPending}>
          {busy ? 'Saving…' : mode === 'create' ? `Add to ${c.name}` : 'Save changes'}
        </Button>
        <Link {...cancel}>
          <Button tabIndex={-1}>Cancel</Button>
        </Link>
      </div>
    </form>
  );
}
