import type { EndpointRole, RunResult, SearchResult } from '@precious/shared';
import { useState } from 'react';
import { Caps, cx, Segmented } from '../../components/ui.tsx';
import { HtmlPicker } from './HtmlPicker.tsx';
import { JsonTree, type PathSegment } from './JsonTree.tsx';
import { STAGE_LABEL } from './labels.ts';

export function RunStatus({ result }: { result: RunResult }) {
  const r = result.response;
  const count = Array.isArray(result.output) ? result.output.length : null;
  return (
    <div className="grid gap-2">
      <span className={cx('text-[0.85rem] font-semibold tabular', result.ok ? 'text-ok' : 'text-danger')}>
        {r ? `${r.status} · ${r.cached ? 'from cache' : `${r.timeMs} ms`}` : 'Not sent'}
        {count !== null && ` · ${count} ${count === 1 ? 'result' : 'results'}`}
        {result.ok && ' · valid'}
      </span>
      {result.errors.length > 0 && (
        <ul className="m-0 grid list-none gap-1.5 p-0" aria-label="Problems">
          {result.errors.map((e) => (
            <li
              key={`${e.stage}:${e.path ?? ''}:${e.message}`}
              className="flex flex-wrap items-baseline gap-2 rounded-[8px] bg-danger-soft px-3 py-2 text-[0.86rem]"
            >
              <span className="rounded-full bg-danger px-2 text-[0.7rem] font-semibold text-surface">
                {STAGE_LABEL[e.stage]}
              </span>
              <span className="min-w-0 break-words">{e.message}</span>
            </li>
          ))}
        </ul>
      )}
      {result.request && (
        <details className="text-[0.82rem]">
          <summary className="cursor-pointer text-ink-muted">Request sent (secrets hidden)</summary>
          <div className="mt-2 grid gap-1 overflow-x-auto rounded-[8px] bg-surface-sunk p-3 tabular">
            <div className="break-all">
              <b>{result.request.method}</b> {result.request.url}
            </div>
            {result.request.headers.map((h) => (
              <div key={h.name} className="break-all text-ink-muted">
                {h.name}: {h.value}
              </div>
            ))}
            {result.request.body && (
              <pre className="m-0 mt-1 font-[inherit] whitespace-pre-wrap">{result.request.body}</pre>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function SearchResults({ results }: { results: SearchResult[] }) {
  if (results.length === 0) return <p className="text-[0.88rem] text-ink-muted">No results.</p>;
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {results.map((r) => (
        <li key={r.id} className="grid grid-cols-[40px_1fr] items-center gap-2.5">
          <span className="grid aspect-[3/4] place-items-center overflow-hidden rounded-[3px] bg-surface-sunk">
            {r.image ? <img src={r.image} alt="" className="size-full object-cover" loading="lazy" /> : null}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[0.9rem] leading-tight font-semibold">{r.title}</span>
            <span className="block truncate text-[0.76rem] text-ink-muted">
              {[r.subtitle, r.year].filter(Boolean).join(' · ')}
              <span className="text-ink-faint"> · id {r.id}</span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function OutputView({ role, output }: { role: EndpointRole; output: unknown }) {
  if (output === undefined) return <p className="text-[0.88rem] text-ink-muted">Nothing yet.</p>;
  if (role === 'search' && Array.isArray(output)) return <SearchResults results={output as SearchResult[]} />;
  if (role === 'compute') {
    return (
      <b className="text-[1.6rem] tabular [font-stretch:80%]">
        {typeof output === 'object' ? JSON.stringify(output) : String(output)}
      </b>
    );
  }
  const entries = Object.entries((output ?? {}) as Record<string, unknown>);
  if (entries.length === 0) return <p className="text-[0.88rem] text-ink-muted">The mapping produced no values.</p>;
  return (
    <dl className="m-0 grid gap-2">
      {entries.map(([k, v]) => (
        <div key={k} className="grid gap-0.5">
          <dt className="text-[0.7rem] font-semibold tracking-[0.08em] text-ink-muted uppercase">{k}</dt>
          <dd className="m-0 text-[0.88rem] whitespace-pre-line [overflow-wrap:anywhere]">
            {v !== null && typeof v === 'object' ? <JsonTree value={v} /> : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function RunPanes({
  result,
  role,
  isHtml,
  selectedPath,
  onPickPath,
  highlight,
  onPickElement,
}: {
  result: RunResult;
  role: EndpointRole;
  isHtml: boolean;
  selectedPath?: string;
  onPickPath: (p: PathSegment[]) => void;
  highlight?: string;
  onPickElement: (selector: string, sample: string) => void;
}) {
  const [tab, setTab] = useState<'page' | 'data'>('page');
  const preview = result.response?.preview;
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[1.3fr_1fr]">
      <div className="grid min-w-0 content-start gap-2 rounded-[12px] border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Caps>{isHtml ? 'Page' : 'Response'}</Caps>
          {isHtml && preview && (
            <Segmented
              label="Show"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'page', label: 'Page' },
                { value: 'data', label: 'Extracted JSON' },
              ]}
            />
          )}
        </div>
        <div className="max-h-[520px] min-w-0 overflow-auto">
          {isHtml && preview && tab === 'page' ? (
            <HtmlPicker html={preview} highlight={highlight} onPick={onPickElement} />
          ) : result.response ? (
            typeof result.response.body === 'string' ? (
              <pre className="m-0 text-[0.8rem] whitespace-pre-wrap">{result.response.body}</pre>
            ) : (
              <JsonTree value={result.response.body} onPick={onPickPath} selected={selectedPath} />
            )
          ) : (
            <p className="text-[0.88rem] text-ink-muted">No response.</p>
          )}
        </div>
      </div>
      <div className="grid min-w-0 content-start gap-2 rounded-[12px] border border-line bg-surface p-3">
        <Caps>Result</Caps>
        <OutputView role={role} output={result.output} />
      </div>
    </div>
  );
}
