import {
  BODY_TYPES,
  ENDPOINT_ROLES,
  type EndpointData,
  type EndpointKind,
  type EndpointRole,
  endpointInputSchema,
  HTTP_METHODS,
  RESPONSE_FORMATS,
  type RunResult,
} from '@precious/shared';
import { Link, useBlocker, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, errorMessage } from '../../api/client.ts';
import { useEndpointMutations, useMe, useSource } from '../../api/queries.ts';
import {
  Button,
  Caps,
  ConfirmStrip,
  ErrorBox,
  Field,
  Segmented,
  Select,
  Spinner,
  TextArea,
  TextField,
  TextInput,
} from '../../components/ui.tsx';
import { ExtractEditor } from './ExtractEditor.tsx';
import { type PathSegment, toJsonataPath } from './JsonTree.tsx';
import { KeyValueTable } from './KeyValueTable.tsx';
import { KIND_LABEL, ROLE_LABEL } from './labels.ts';
import { MapEditor } from './MapEditor.tsx';
import { RunPanes, RunStatus } from './RunView.tsx';

function blankEndpoint(): EndpointData {
  return endpointInputSchema.parse({
    key: 'search',
    name: 'Search',
    role: 'search',
    kind: 'rest',
    map: { results: '', id: 'id', title: 'title' },
  });
}

/** Strips the results path from a clicked path so per-result keys stay relative. */
function relativeTo(results: string, path: string): string {
  const base = results.trim();
  if (!base || base === '$') return path;
  if (path === base) return '$';
  return path.startsWith(`${base}.`) ? path.slice(base.length + 1) : path;
}

function slugFrom(text: string, taken: string[]): string {
  const base =
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 20) || 'value';
  let k = base;
  for (let n = 2; taken.includes(k); n++) k = `${base}_${n}`;
  return k;
}

export function EndpointPage() {
  const { sourceId, endpointId } = useParams({ from: '/app/data/sources/$sourceId/e/$endpointId' });
  const isNew = endpointId === 'new';
  const source = useSource(sourceId);
  const { data: me } = useMe();
  const { create, update, remove, run } = useEndpointMutations(sourceId);
  const navigate = useNavigate();

  const [draft, setDraft] = useState<EndpointData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [refsText, setRefsText] = useState('{}');
  const [itemText, setItemText] = useState('{}');
  const [useCache, setUseCache] = useState(true);
  const [result, setResult] = useState<RunResult | null>(null);
  const [focusedMap, setFocusedMap] = useState<string | null>(null);
  const [activeExtract, setActiveExtract] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [inputError, setInputError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const isAdmin = me?.role === 'admin';

  const existing = useMemo(() => source.data?.endpoints.find((e) => e.id === endpointId), [source.data, endpointId]);

  useEffect(() => {
    if (draft || !source.data) return;
    const start = isNew ? blankEndpoint() : existing ? endpointInputSchema.parse(existing) : null;
    if (!start) return;
    setDraft(start);
    setQuery(start.sample.query ?? '');
    setRefsText(JSON.stringify(start.sample.refs ?? {}, null, 0));
    setItemText(JSON.stringify(start.sample.item ?? {}, null, 0));
  }, [draft, source.data, isNew, existing]);

  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm('Leave without saving your changes to this endpoint?'),
  });
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (source.isError) return <ErrorBox>{errorMessage(source.error)}</ErrorBox>;
  if (!source.data) return <Spinner />;
  if (!draft) return isNew || existing ? <Spinner /> : <ErrorBox>That endpoint no longer exists.</ErrorBox>;
  const s = source.data;
  const set = (patch: Partial<EndpointData>) => {
    setDirty(true);
    setDraft({ ...draft, ...patch });
  };

  function parseInputs() {
    try {
      const refs = JSON.parse(refsText || '{}');
      const item = JSON.parse(itemText || '{}');
      setInputError('');
      return { query, refs, item };
    } catch {
      setInputError('Refs and item must be JSON, e.g. { "igdb": "1022" }.');
      return null;
    }
  }

  async function onRun() {
    if (!draft) return;
    const input = parseInputs();
    if (!input) return;
    try {
      setResult(await run.mutateAsync({ endpoint: draft, input, useCache }));
    } catch (err) {
      setResult({ ok: false, errors: [{ stage: 'validate', message: errorMessage(err) }] });
    }
  }

  async function onSave() {
    if (!draft) return;
    const input = parseInputs();
    if (!input) return;
    const parsed = endpointInputSchema.safeParse({ ...draft, sample: input });
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      return;
    }
    setIssues([]);
    try {
      if (isNew) {
        const created = await create.mutateAsync(parsed.data);
        setDirty(false);
        navigate({
          to: '/data/sources/$sourceId/e/$endpointId',
          params: { sourceId, endpointId: created.id },
          replace: true,
        });
      } else {
        await update.mutateAsync({ id: endpointId, ...parsed.data });
        setDirty(false);
      }
    } catch (err) {
      setIssues(
        err instanceof ApiError && err.body.issues?.length
          ? err.body.issues.map((i) => `${i.path}: ${i.message}`)
          : [errorMessage(err)],
      );
    }
  }

  function onPickPath(path: PathSegment[]) {
    if (!draft) return;
    const full = toJsonataPath(path);
    const target = focusedMap ?? (draft.role === 'compute' ? 'value' : draft.role === 'search' ? 'title' : null);
    if (!target) return;
    const value = draft.role === 'search' && target !== 'results' ? relativeTo(draft.map.results ?? '', full) : full;
    set({ map: { ...draft.map, [target]: value } });
    setFocusedMap(target);
  }

  function onPickElement(selector: string, sample: string) {
    if (!draft) return;
    if (activeExtract && draft.extract[activeExtract]) {
      const { css: _c, xpath: _x, jsonld: _j, meta: _m, scriptJson: _s, ...rest } = draft.extract[activeExtract];
      set({ extract: { ...draft.extract, [activeExtract]: { ...rest, css: selector } } });
    } else {
      const name = slugFrom(sample, Object.keys(draft.extract));
      set({ extract: { ...draft.extract, [name]: { css: selector } } });
      setActiveExtract(name);
    }
  }

  const kind = draft.kind;
  const methodChoices = kind === 'html' ? (['GET', 'POST'] as const) : HTTP_METHODS;
  const activeSelector = activeExtract ? draft.extract[activeExtract]?.css : undefined;

  return (
    <div className="grid gap-5">
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-2 text-[0.88rem] text-ink-muted">
        <Link to="/data/sources" className="text-ink-muted no-underline hover:text-ink">
          Data sources
        </Link>
        <span>/</span>
        <Link to="/data/sources/$sourceId" params={{ sourceId }} className="text-ink-muted no-underline hover:text-ink">
          {s.name}
        </Link>
        <span>/</span>
        <b className="font-semibold text-ink">{draft.name || 'New endpoint'}</b>
      </nav>
      {confirming && (
        <ConfirmStrip
          message={
            <>
              Delete the <b>{draft.name}</b> endpoint?
            </>
          }
          confirmLabel="Delete endpoint"
          busy={remove.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await remove.mutateAsync(endpointId);
            setDirty(false);
            navigate({ to: '/data/sources/$sourceId', params: { sourceId } });
          }}
        />
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-[2rem] leading-none font-bold">
            {s.name} · {draft.name || 'New endpoint'}
          </h1>
          <span className="text-[0.86rem] text-ink-muted">
            {KIND_LABEL[kind]} · {ROLE_LABEL[draft.role]}
            {dirty && ' · unsaved changes'}
          </span>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            {!isNew && (
              <Button icon="trash" variant="danger" onClick={() => setConfirming(true)}>
                Delete
              </Button>
            )}
            <Button
              variant="primary"
              onClick={onSave}
              disabled={create.isPending || update.isPending || (!dirty && !isNew)}
            >
              {isNew ? 'Create endpoint' : dirty ? 'Save changes' : 'Saved'}
            </Button>
          </div>
        )}
      </div>
      {issues.length > 0 && (
        <ErrorBox>
          <ul className="m-0 list-disc pl-5">
            {issues.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </ErrorBox>
      )}

      <fieldset disabled={!isAdmin} className="m-0 grid gap-5 border-0 p-0 xl:grid-cols-2">
        <section className="grid content-start gap-4 rounded-sheet border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Caps>Request</Caps>
            <Segmented
              label="Kind"
              value={kind}
              onChange={(k: EndpointKind) =>
                set({
                  kind: k,
                  method: k === 'graphql' ? 'POST' : draft.method === 'GET' || k === 'rest' ? draft.method : 'GET',
                })
              }
              options={[
                { value: 'rest', label: 'REST' },
                { value: 'graphql', label: 'GraphQL' },
                { value: 'html', label: 'HTML' },
              ]}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            <TextField
              label="Key"
              help="Used to refer to it"
              value={draft.key}
              onChange={(e) => set({ key: e.target.value.toLowerCase() })}
            />
            <Field label="Used to" htmlFor="role">
              <Select id="role" value={draft.role} onChange={(e) => set({ role: e.target.value as EndpointRole })}>
                {ENDPOINT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label={kind === 'graphql' ? 'Path' : 'Method and path'}
            help={`Added to ${s.baseUrl}. Templates: {{ query }}, {{ refs.name }}, {{ item.title }}, {{ secrets.name }}`}
          >
            <div className="flex gap-2">
              {kind !== 'graphql' && (
                <Select
                  aria-label="Method"
                  value={draft.method}
                  onChange={(e) => set({ method: e.target.value as EndpointData['method'] })}
                  className="w-auto font-bold text-accent"
                >
                  {methodChoices.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              )}
              <TextInput
                aria-label="Path"
                value={draft.path}
                placeholder="/search"
                onChange={(e) => set({ path: e.target.value })}
                className="italic"
              />
            </div>
          </Field>
          {kind === 'graphql' ? (
            <>
              <Field label="Query" htmlFor="gql-query">
                <TextArea
                  id="gql-query"
                  value={draft.graphql.query}
                  onChange={(e) => set({ graphql: { ...draft.graphql, query: e.target.value } })}
                  className="min-h-40 text-[0.85rem]"
                  spellCheck={false}
                />
              </Field>
              <Field
                label="Variables"
                help='A template that makes JSON, e.g. { "search": {{ query | json }} }'
                htmlFor="gql-vars"
              >
                <TextArea
                  id="gql-vars"
                  value={draft.graphql.variables}
                  onChange={(e) => set({ graphql: { ...draft.graphql, variables: e.target.value } })}
                  className="min-h-16 text-[0.85rem] italic"
                  spellCheck={false}
                />
              </Field>
              <div className="flex flex-wrap gap-4 text-[0.88rem] text-ink-muted">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.graphql.useGet}
                    onChange={(e) => set({ graphql: { ...draft.graphql, useGet: e.target.checked } })}
                    className="accent-[var(--accent)]"
                  />
                  Send as GET (query in the address)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.graphql.allowPartial}
                    onChange={(e) => set({ graphql: { ...draft.graphql, allowPartial: e.target.checked } })}
                    className="accent-[var(--accent)]"
                  />
                  Accept partial results with errors
                </label>
              </div>
            </>
          ) : (
            <Field label="Query parameters">
              <KeyValueTable
                label="Parameter"
                rows={draft.query}
                onChange={(q) => set({ query: q })}
                disabled={!isAdmin}
              />
            </Field>
          )}
          <Field label="Headers" help="Added to the source’s default headers; same name overrides.">
            <KeyValueTable
              label="Header"
              rows={draft.headers}
              onChange={(h) => set({ headers: h })}
              disabled={!isAdmin}
            />
          </Field>
          {kind !== 'graphql' && draft.method !== 'GET' && (
            <Field label="Body" htmlFor="body">
              <div className="grid gap-2">
                <Select
                  aria-label="Body type"
                  value={draft.body.type}
                  onChange={(e) =>
                    set({ body: { ...draft.body, type: e.target.value as EndpointData['body']['type'] } })
                  }
                  className="w-auto max-w-48"
                >
                  {BODY_TYPES.map((b) => (
                    <option key={b} value={b}>
                      {{ none: 'None', json: 'JSON', form: 'Form', raw: 'Raw text' }[b]}
                    </option>
                  ))}
                </Select>
                {draft.body.type !== 'none' && (
                  <TextArea
                    id="body"
                    value={draft.body.template}
                    onChange={(e) => set({ body: { ...draft.body, template: e.target.value } })}
                    className="min-h-24 text-[0.85rem] italic"
                    spellCheck={false}
                  />
                )}
              </div>
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {kind === 'rest' && (
              <Field label="Response format" htmlFor="format">
                <Select
                  id="format"
                  value={draft.format}
                  onChange={(e) => set({ format: e.target.value as EndpointData['format'] })}
                >
                  {RESPONSE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f === 'auto' ? 'Detect' : f.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Reuse answers for" htmlFor="ep-cache">
              <Select
                id="ep-cache"
                value={draft.cacheSeconds ?? ''}
                onChange={(e) => set({ cacheSeconds: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">Same as the source</option>
                <option value={0}>Don’t cache</option>
                <option value={3600}>1 hour</option>
                <option value={86400}>1 day</option>
                <option value={604800}>1 week</option>
              </Select>
            </Field>
          </div>
          {kind === 'html' && (
            <Field label="Values to pick out of the page">
              <ExtractEditor
                value={draft.extract}
                onChange={(extract) => set({ extract })}
                active={activeExtract}
                onActive={setActiveExtract}
              />
            </Field>
          )}
        </section>

        <section className="grid content-start gap-4 rounded-sheet border border-line bg-surface p-5">
          <Caps>Mapping</Caps>
          <MapEditor
            role={draft.role}
            map={draft.map}
            onChange={(map) => set({ map })}
            focused={focusedMap}
            onFocus={setFocusedMap}
          />
        </section>
      </fieldset>

      {isAdmin && (
        <section className="grid gap-4 rounded-sheet border border-line bg-wall p-5">
          <Caps>Try it</Caps>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
            <TextField
              label="Query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What you’d type in search"
            />
            <TextField
              label="Refs (JSON)"
              value={refsText}
              onChange={(e) => setRefsText(e.target.value)}
              placeholder='{ "igdb": "1022" }'
              className="italic"
            />
            <TextField
              label="Item (JSON)"
              value={itemText}
              onChange={(e) => setItemText(e.target.value)}
              placeholder='{ "title": "…" }'
              className="italic"
            />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[0.85rem] whitespace-nowrap text-ink-muted">
                <input
                  type="checkbox"
                  checked={useCache}
                  onChange={(e) => setUseCache(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Use cache
              </label>
              <Button variant="primary" onClick={onRun} disabled={run.isPending}>
                {run.isPending ? 'Running…' : 'Run'}
              </Button>
            </div>
          </div>
          {inputError && <ErrorBox>{inputError}</ErrorBox>}
          {result && <RunStatus result={result} />}
          {result && (
            <RunPanes
              result={result}
              role={draft.role}
              isHtml={kind === 'html'}
              selectedPath={focusedMap ? draft.map[focusedMap] : undefined}
              onPickPath={onPickPath}
              highlight={activeSelector || undefined}
              onPickElement={onPickElement}
            />
          )}
        </section>
      )}
    </div>
  );
}
