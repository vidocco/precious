import {
  AUTH_TYPES,
  type AuthType,
  type SourceAuth,
  type SourceDto,
  type SourceInput,
  sourceInputSchema,
} from '@precious/shared';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../../api/client.ts';
import { downloadRecipe, useMe, useSource, useSourceMutations } from '../../api/queries.ts';
import {
  Button,
  Caps,
  ConfirmStrip,
  cx,
  ErrorBox,
  Field,
  Select,
  Spinner,
  TextField,
  TextInput,
} from '../../components/ui.tsx';
import { KeyValueTable } from './KeyValueTable.tsx';
import { AUTH_LABEL, KIND_LABEL, lastCallText, ROLE_LABEL } from './labels.ts';

type Form = Omit<SourceInput, 'auth'> & { auth: SourceAuth };

const BLANK: Form = {
  name: '',
  description: '',
  baseUrl: '',
  auth: { type: 'none' },
  headers: [],
  rateLimit: { requests: 2, perSeconds: 1 },
  cacheSeconds: 86400,
};

const CACHE_OPTIONS = [
  { value: 0, label: 'Don’t cache' },
  { value: 600, label: '10 minutes' },
  { value: 3600, label: '1 hour' },
  { value: 86400, label: '1 day' },
  { value: 604800, label: '1 week' },
  { value: 2592000, label: '30 days' },
];

function formFrom(s: SourceDto): Form {
  return {
    name: s.name,
    description: s.description,
    baseUrl: s.baseUrl,
    auth: s.auth,
    headers: s.headers,
    rateLimit: s.rateLimit,
    cacheSeconds: s.cacheSeconds,
    ...(s.userAgent && { userAgent: s.userAgent }),
  };
}

function defaultAuth(type: AuthType): SourceAuth {
  switch (type) {
    case 'apiKey':
      return { type, in: 'header', name: 'X-Api-Key', secret: 'apiKey' };
    case 'bearer':
      return { type, secret: 'token' };
    case 'basic':
      return { type, username: '', secret: 'password' };
    case 'oauth2':
      return { type, tokenUrl: '', clientId: '{{ secrets.clientId }}', secret: 'clientSecret' };
    default:
      return { type: 'none' };
  }
}

function AuthFields({
  auth,
  onChange,
  disabled,
}: {
  auth: SourceAuth;
  onChange: (a: SourceAuth) => void;
  disabled?: boolean;
}) {
  const secretField = 'secret' in auth && (
    <TextField
      label="Secret it uses"
      help={`Set its value under Secrets below; templates can also use {{ secrets.${auth.secret || 'name'} }}.`}
      value={auth.secret}
      onChange={(e) => onChange({ ...auth, secret: e.target.value } as SourceAuth)}
      disabled={disabled}
    />
  );
  switch (auth.type) {
    case 'apiKey':
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Send it as" htmlFor="apikey-in">
            <Select
              id="apikey-in"
              value={auth.in}
              onChange={(e) => onChange({ ...auth, in: e.target.value as 'header' | 'query' })}
              disabled={disabled}
            >
              <option value="header">A header</option>
              <option value="query">A query parameter</option>
            </Select>
          </Field>
          <TextField
            label={auth.in === 'header' ? 'Header name' : 'Parameter name'}
            value={auth.name}
            onChange={(e) => onChange({ ...auth, name: e.target.value })}
            disabled={disabled}
          />
          {secretField}
        </div>
      );
    case 'bearer':
      return <div className="grid gap-3 sm:grid-cols-2">{secretField}</div>;
    case 'basic':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="User name"
            value={auth.username}
            onChange={(e) => onChange({ ...auth, username: e.target.value })}
            disabled={disabled}
          />
          {secretField}
        </div>
      );
    case 'oauth2':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Token address"
            placeholder="https://id.example.com/oauth2/token"
            value={auth.tokenUrl}
            onChange={(e) => onChange({ ...auth, tokenUrl: e.target.value })}
            disabled={disabled}
          />
          <TextField
            label="Client ID"
            help="Text or a template like {{ secrets.clientId }}"
            value={auth.clientId}
            onChange={(e) => onChange({ ...auth, clientId: e.target.value })}
            disabled={disabled}
          />
          {secretField}
          <TextField
            label="Scope (optional)"
            value={auth.scope ?? ''}
            onChange={(e) => onChange({ ...auth, scope: e.target.value || undefined })}
            disabled={disabled}
          />
        </div>
      );
    default:
      return null;
  }
}

/** Secret names the settings refer to (auth + {{ secrets.x }} in headers). */
function wantedSecrets(form: Form): string[] {
  const names = new Set<string>();
  if ('secret' in form.auth && form.auth.secret) names.add(form.auth.secret);
  for (const m of JSON.stringify([form.auth, form.headers]).matchAll(/secrets\.([A-Za-z_]\w*)/g))
    names.add(m[1] as string);
  return [...names];
}

function SecretsPanel({ source, wanted }: { source: SourceDto; wanted: string[] }) {
  const { setSecrets } = useSourceMutations();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const set = new Set(source.secrets.map((s) => s.name));
  const names = [...new Set([...wanted, ...set])].sort();

  async function save(name: string, v: string | null) {
    setError('');
    try {
      await setSecrets.mutateAsync({ id: source.id, secrets: { [name]: v } });
      setEditing(null);
      setValue('');
      setNewName('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section className="grid gap-3 rounded-sheet border border-line bg-surface p-5">
      <div className="grid gap-1">
        <Caps>Secrets</Caps>
        <p className="text-[0.85rem] text-ink-muted">
          Stored encrypted. Once saved, a secret is never shown again; you can replace or remove it.
        </p>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="overflow-hidden rounded-[9px] border border-line">
        {names.map((name) => (
          <div key={name} className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 last:border-b-0">
            <b className="min-w-32 text-[0.9rem]">{name}</b>
            {editing === name ? (
              <form
                className="flex flex-1 flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save(name, value);
                }}
              >
                <TextInput
                  type="password"
                  autoComplete="off"
                  aria-label={`Value for ${name}`}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="max-w-72 py-1.5"
                  autoFocus
                />
                <Button type="submit" size="sm" variant="primary" disabled={!value}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <span
                  className={cx(
                    'flex-1 text-[0.88rem]',
                    set.has(name) ? 'tracking-[0.16em] text-ink-muted' : 'font-semibold text-warn',
                  )}
                >
                  {set.has(name) ? '••••••••' : 'Not set'}
                </span>
                <Button size="sm" onClick={() => setEditing(name)}>
                  {set.has(name) ? 'Replace' : 'Set'}
                </Button>
                {set.has(name) && (
                  <Button size="sm" variant="ghost" onClick={() => save(name, null)}>
                    Remove
                  </Button>
                )}
              </>
            )}
          </div>
        ))}
        <form
          className="flex flex-wrap gap-2 bg-wall px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName) setEditing(newName.trim());
            setNewName('');
          }}
        >
          <TextInput
            aria-label="New secret name"
            placeholder="New secret name, e.g. apiKey"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="max-w-64 py-1.5"
          />
          <Button type="submit" size="sm" disabled={!newName.trim()}>
            Add secret
          </Button>
        </form>
      </div>
    </section>
  );
}

export function SourcePage({ mode }: { mode: 'create' | 'edit' }) {
  const params = useParams({ strict: false }) as { sourceId?: string };
  const { missing } = useSearch({ strict: false }) as { missing?: string };
  const source = useSource(params.sourceId ?? '');
  const { data: me } = useMe();
  const { create, update, remove } = useSourceMutations();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form | null>(mode === 'create' ? BLANK : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const isAdmin = me?.role === 'admin';

  useEffect(() => {
    if (mode === 'edit' && source.data && !form) setForm(formFrom(source.data));
  }, [mode, source.data, form]);

  if (source.isError) return <ErrorBox>{errorMessage(source.error)}</ErrorBox>;
  if (!form) return <Spinner />;
  const s = source.data;
  const set = (patch: Partial<Form>) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };
  const missingNow = (missing?.split(',') ?? []).filter((n) => !s?.secrets.some((x) => x.name === n));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const parsed = sourceInputSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    setError('');
    try {
      if (mode === 'create') {
        const created = await create.mutateAsync(parsed.data);
        navigate({ to: '/data/sources/$sourceId', params: { sourceId: created.id } });
      } else if (s) {
        await update.mutateAsync({ id: s.id, ...parsed.data });
        setSaved(true);
      }
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) setErrors(err.issues);
    }
  }

  return (
    <div className="grid gap-5">
      <nav aria-label="Breadcrumb" className="flex gap-2 text-[0.88rem] text-ink-muted">
        <Link to="/data/sources" className="text-ink-muted no-underline hover:text-ink">
          Data sources
        </Link>
        <span>/</span>
        <b className="font-semibold text-ink">{s?.name ?? 'New source'}</b>
      </nav>
      {confirming && s && (
        <ConfirmStrip
          message={
            <>
              Delete <b>{s.name}</b> and its {s.endpoints.length} endpoint{s.endpoints.length === 1 ? '' : 's'}? This
              can’t be undone.
            </>
          }
          confirmLabel="Delete source"
          busy={remove.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await remove.mutateAsync(s.id);
            navigate({ to: '/data/sources' });
          }}
        />
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-[2rem] leading-none font-bold">{s?.name ?? 'New source'}</h1>
          {s && <span className="text-[0.86rem] text-ink-muted">Last call: {lastCallText(s.lastCall)}</span>}
        </div>
        {s && isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button icon="swap" onClick={() => downloadRecipe(s)}>
              Export recipe
            </Button>
            <Button icon="trash" variant="danger" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          </div>
        )}
      </div>
      {missingNow.length > 0 && (
        <ErrorBox>
          Set {missingNow.length === 1 ? 'this secret' : 'these secrets'} before using the source:{' '}
          <b>{missingNow.join(', ')}</b>.
        </ErrorBox>
      )}
      {!isAdmin && <p className="text-[0.88rem] text-ink-muted">Only admins can change data sources.</p>}

      <form onSubmit={onSubmit} className="grid gap-4 rounded-sheet border border-line bg-surface p-5" noValidate>
        <Caps>Source settings</Caps>
        {error && <ErrorBox>{error}</ErrorBox>}
        <fieldset disabled={!isAdmin} className="m-0 grid gap-4 border-0 p-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              error={errors.name}
              autoFocus={mode === 'create'}
            />
            <TextField
              label="Base address"
              placeholder="https://api.example.com/v1"
              value={form.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
              error={errors.baseUrl}
            />
          </div>
          <TextField
            label="Description"
            value={form.description ?? ''}
            onChange={(e) => set({ description: e.target.value })}
          />
          <Field label="Sign-in" htmlFor="auth-type">
            <Select
              id="auth-type"
              value={form.auth.type}
              onChange={(e) => set({ auth: defaultAuth(e.target.value as AuthType) })}
              className="max-w-80"
            >
              {AUTH_TYPES.map((t) => (
                <option key={t} value={t}>
                  {AUTH_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <AuthFields auth={form.auth} onChange={(auth) => set({ auth })} disabled={!isAdmin} />
          <Field
            label="Default headers"
            help="Sent with every request to this source. Endpoints can add more or override these."
          >
            <KeyValueTable
              label="Header"
              rows={form.headers ?? []}
              onChange={(headers) => set({ headers })}
              disabled={!isAdmin}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Rate limit" help="Requests are spaced out to stay under this.">
              <div className="flex items-center gap-2 text-[0.9rem] text-ink-muted">
                <TextInput
                  type="number"
                  min={1}
                  aria-label="Requests"
                  value={form.rateLimit?.requests ?? 2}
                  onChange={(e) =>
                    set({
                      rateLimit: { requests: Number(e.target.value) || 1, perSeconds: form.rateLimit?.perSeconds ?? 1 },
                    })
                  }
                  className="w-20"
                />
                per
                <TextInput
                  type="number"
                  min={1}
                  aria-label="Seconds"
                  value={form.rateLimit?.perSeconds ?? 1}
                  onChange={(e) =>
                    set({
                      rateLimit: { requests: form.rateLimit?.requests ?? 2, perSeconds: Number(e.target.value) || 1 },
                    })
                  }
                  className="w-20"
                />
                s
              </div>
            </Field>
            <Field label="Reuse answers for" htmlFor="cache">
              <Select
                id="cache"
                value={form.cacheSeconds ?? 86400}
                onChange={(e) => set({ cacheSeconds: Number(e.target.value) })}
              >
                {CACHE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <TextField
              label="User-Agent (optional)"
              placeholder="Precious/… (self-hosted collection manager)"
              value={form.userAgent ?? ''}
              onChange={(e) => set({ userAgent: e.target.value || undefined })}
            />
          </div>
          {isAdmin && (
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" disabled={create.isPending || update.isPending}>
                {mode === 'create' ? 'Create source' : saved ? 'Saved' : 'Save settings'}
              </Button>
              {mode === 'create' && (
                <span className="text-[0.85rem] text-ink-muted">You’ll add endpoints and secrets next.</span>
              )}
            </div>
          )}
        </fieldset>
      </form>

      {s && isAdmin && <SecretsPanel source={s} wanted={wantedSecrets(form)} />}

      {s && (
        <section className="grid gap-3 rounded-sheet border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Caps>Endpoints</Caps>
            {isAdmin && (
              <Link to="/data/sources/$sourceId/e/$endpointId" params={{ sourceId: s.id, endpointId: 'new' }}>
                <Button size="sm" icon="plus" tabIndex={-1}>
                  New endpoint
                </Button>
              </Link>
            )}
          </div>
          {s.endpoints.length === 0 ? (
            <p className="text-[0.9rem] text-ink-muted">
              No endpoints yet. Add one to search this source or look up details.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0">
              {s.endpoints.map((e) => (
                <li key={e.id}>
                  <Link
                    to="/data/sources/$sourceId/e/$endpointId"
                    params={{ sourceId: s.id, endpointId: e.id }}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] px-3 py-2.5 text-ink no-underline hover:bg-surface-sunk"
                  >
                    <b>{e.name}</b>
                    <span className="rounded-[5px] bg-surface-sunk px-1.5 text-[0.7rem] font-semibold">
                      {KIND_LABEL[e.kind]}
                    </span>
                    <span className="text-[0.85rem] text-ink-muted">{ROLE_LABEL[e.role]}</span>
                    <span className="ml-auto text-[0.8rem] text-ink-faint">
                      {e.kind === 'graphql' ? (e.graphql.useGet ? 'GET' : 'POST') : e.method} {e.path || '/'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
