import type { SourceDto } from '@precious/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useMe, usePresets, useSourceMutations, useSources } from '../../api/queries.ts';
import { Button, Caps, cx, EmptyState, ErrorBox, Spinner, TextArea } from '../../components/ui.tsx';
import { KIND_LABEL, lastCallText } from './labels.ts';

function StatusDot({ s }: { s: SourceDto }) {
  const tone = !s.lastCall ? 'bg-line' : s.lastCall.ok ? 'bg-ok' : 'bg-gilt';
  return <span className={cx('mr-1.5 inline-block size-[7px] rounded-full', tone)} />;
}

function AddPanel({ onDone }: { onDone: (id: string, missing: string[]) => void }) {
  const { data: presets } = usePresets();
  const { importRecipe, installPreset } = useSourceMutations();
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);

  async function importText(text: string) {
    setError('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError('That isn’t valid JSON. Paste the whole recipe file.');
      return;
    }
    try {
      const r = await importRecipe.mutateAsync(parsed);
      onDone(r.source.id, r.missingSecrets);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="grid gap-5 rounded-sheet border border-line bg-surface p-5">
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid gap-2.5">
        <Caps>Start from a preset</Caps>
        <div className="grid gap-2 sm:grid-cols-2">
          {(presets ?? []).map((p) => (
            <button
              key={p.key}
              type="button"
              disabled={installPreset.isPending}
              onClick={async () => {
                setError('');
                try {
                  const r = await installPreset.mutateAsync(p.key);
                  onDone(r.source.id, r.missingSecrets);
                } catch (err) {
                  setError(errorMessage(err));
                }
              }}
              className="grid gap-1 rounded-[10px] border border-line bg-wall px-3.5 py-3 text-left hover:border-accent"
            >
              <span className="flex flex-wrap items-center gap-2">
                <b>{p.name}</b>
                {p.kinds.map((k) => (
                  <span key={k} className="rounded-[5px] bg-surface-sunk px-1.5 text-[0.7rem] font-semibold">
                    {KIND_LABEL[k]}
                  </span>
                ))}
              </span>
              <span className="text-[0.82rem] text-ink-muted">{p.description}</span>
              {p.secretNames.length > 0 && (
                <span className="text-[0.76rem] text-ink-faint">Needs: {p.secretNames.join(', ')}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2.5">
        <Caps>Or import a recipe file</Caps>
        <div className="flex flex-wrap gap-2">
          <Button icon="swap" onClick={() => file.current?.click()}>
            Choose a .json file
          </Button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await importText(await f.text());
              e.target.value = '';
            }}
          />
        </div>
        <TextArea
          aria-label="Paste a recipe"
          placeholder='…or paste it here: { "format": "precious-recipe", … }'
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          className="min-h-20 text-[0.85rem]"
        />
        {pasted.trim() && (
          <Button
            variant="primary"
            className="justify-self-start"
            onClick={() => importText(pasted)}
            disabled={importRecipe.isPending}
          >
            Import pasted recipe
          </Button>
        )}
      </div>
    </div>
  );
}

export function SourcesListPage() {
  const { data: me } = useMe();
  const { data: sources, isPending } = useSources();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const isAdmin = me?.role === 'admin';

  const opened = (id: string, missing: string[]) =>
    navigate({
      to: '/data/sources/$sourceId',
      params: { sourceId: id },
      search: missing.length ? { missing: missing.join(',') } : {},
    });

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-[2rem] leading-none font-bold">Data sources</h1>
          <p className="max-w-[64ch] text-ink-muted">
            APIs (REST or GraphQL) and web pages Precious can ask for information. Each source has endpoints: one to
            search, others to look up details or keep a value up to date.
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button icon={adding ? 'x' : 'swap'} onClick={() => setAdding(!adding)}>
              {adding ? 'Close' : 'Preset or recipe'}
            </Button>
            <Link to="/data/sources/new">
              <Button variant="primary" icon="plus" tabIndex={-1}>
                New source
              </Button>
            </Link>
          </div>
        )}
      </div>
      {!isAdmin && <p className="text-[0.88rem] text-ink-muted">Only admins can add or change data sources.</p>}
      {adding && <AddPanel onDone={opened} />}
      {isPending ? (
        <Spinner />
      ) : !sources?.length ? (
        !adding && (
          <EmptyState
            title="No data sources yet"
            action={
              isAdmin && (
                <Button variant="primary" className="mt-2" onClick={() => setAdding(true)}>
                  Start from a preset
                </Button>
              )
            }
          >
            Presets for Open Library (books), AniList (anime), IGDB (games) and Wikipedia are included.
          </EmptyState>
        )
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
          <table className="w-full border-collapse text-[0.88rem]">
            <thead>
              <tr className="text-left text-[0.68rem] font-semibold tracking-[0.08em] text-ink-muted uppercase">
                <th className="border-b border-line px-3.5 py-2">Source</th>
                <th className="border-b border-line px-3.5 py-2">Kind</th>
                <th className="border-b border-line px-3.5 py-2">Endpoints</th>
                <th className="border-b border-line px-3.5 py-2">Last call</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="hover:bg-surface-sunk">
                  <td className="border-b border-line px-3.5 py-2.5">
                    <Link
                      to="/data/sources/$sourceId"
                      params={{ sourceId: s.id }}
                      className="font-semibold text-ink no-underline"
                    >
                      {s.name}
                    </Link>
                  </td>
                  <td className="border-b border-line px-3.5 py-2.5">
                    <span className="flex gap-1">
                      {[...new Set(s.endpoints.map((e) => e.kind))].map((k) => (
                        <span key={k} className="rounded-[5px] bg-surface-sunk px-1.5 text-[0.7rem] font-semibold">
                          {KIND_LABEL[k]}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="border-b border-line px-3.5 py-2.5 text-ink-muted">
                    {s.endpoints.map((e) => e.name).join(', ') || '—'}
                  </td>
                  <td className="border-b border-line px-3.5 py-2.5 whitespace-nowrap">
                    <StatusDot s={s} />
                    {lastCallText(s.lastCall)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
