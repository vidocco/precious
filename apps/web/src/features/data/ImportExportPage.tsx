import {
  type CollectionDto,
  coerceToField,
  guessColumns,
  IMPORT_MAX_ROWS,
  type ImportInput,
  type ImportResult,
  type ParsedCsv,
  parseCsv,
} from '@precious/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { ApiError, api, errorMessage } from '../../api/client.ts';
import { keys, useCollections, useTemplate } from '../../api/queries.ts';
import { Icon } from '../../components/Icon.tsx';
import { Button, Caps, cx, EmptyState, ErrorBox, Select, Spinner } from '../../components/ui.tsx';

const PREVIEW_ROWS = 5;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 rounded-sheet border border-line bg-surface p-5">
      <Caps>{title}</Caps>
      {children}
    </section>
  );
}

function ExportList({ collections }: { collections: CollectionDto[] }) {
  return (
    <Section title="Export">
      <p className="text-[0.9rem] text-ink-muted">
        CSV opens in any spreadsheet and imports back into Precious. JSON keeps everything, including where each value
        came from.
      </p>
      <ul className="m-0 grid list-none gap-1 p-0">
        {collections.map((c) => (
          <li
            key={c.id}
            data-accent={c.accent}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[9px] px-2 py-1.5 hover:bg-surface-sunk"
          >
            <span className="size-2.5 rounded-[2px] bg-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
            <span className="text-[0.84rem] text-ink-faint tabular">
              {c.itemCount} item{c.itemCount === 1 ? '' : 's'}
            </span>
            <a className="text-[0.88rem] font-semibold" href={`/api/collections/${c.id}/export?format=csv`} download>
              CSV
            </a>
            <a className="text-[0.88rem] font-semibold" href={`/api/collections/${c.id}/export?format=json`} download>
              JSON
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Importer({ collections }: { collections: CollectionDto[] }) {
  const editable = collections.filter((c) => c.canEdit);
  const [collectionId, setCollectionId] = useState(editable[0]?.id ?? '');
  const collection = editable.find((c) => c.id === collectionId);
  const template = useTemplate(collection?.templateId);
  const [file, setFile] = useState<{ name: string; csv: ParsedCsv } | null>(null);
  const [targets, setTargets] = useState<(string | null)[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string[] | null>(null);
  const [done, setDone] = useState<(ImportResult & { collection: CollectionDto }) | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const fields = (template.data?.fields ?? []).filter((f) => !f.hidden);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    setDone(null);
    const csv = parseCsv(await f.text());
    if (csv.headers.length === 0) {
      setError(['That file has no rows.']);
      return;
    }
    setFile({ name: f.name, csv });
    setTargets(guessColumns(csv.headers, fields));
  }

  // Each cell converted to what its field stores; cells that can't be used are counted.
  const converted = useMemo(() => {
    if (!file) return null;
    const titleCol = targets.indexOf('$title');
    let bad = 0;
    const rows = file.csv.rows.map((r, i) => {
      const data: Record<string, unknown> = {};
      const problems = new Set<number>();
      targets.forEach((t, c) => {
        const field = fields.find((f) => f.id === t);
        if (!field) return;
        const v = coerceToField(field, r[c]);
        if (!v.ok) {
          problems.add(c);
          bad++;
        } else if (v.value !== undefined) data[field.id] = v.value;
      });
      return { line: i + 2, title: titleCol < 0 ? '' : (r[titleCol] ?? '').trim(), data, problems };
    });
    return { rows, bad, untitled: rows.filter((r) => !r.title).length, hasTitle: titleCol >= 0 };
  }, [file, targets, fields]);

  // Columns and rows have no ids of their own: they're keyed by position, once.
  const columns = (file?.csv.headers ?? []).map((h, c) => ({ h, c, key: `col-${c}` }));
  const previewRows = (file?.csv.rows ?? [])
    .slice(0, PREVIEW_ROWS)
    .map((r, i) => ({ r, row: converted?.rows[i], key: `line-${i + 2}` }));

  async function runImport() {
    if (!converted || !collection) return;
    setBusy(true);
    setError(null);
    try {
      const body: ImportInput = {
        rows: converted.rows.filter((r) => r.title).map(({ line, title, data }) => ({ line, title, data })),
      };
      const res = await api.post<ImportResult>(`/api/collections/${collection.id}/import`, body);
      setDone({ ...res, collection });
      setFile(null);
      qc.invalidateQueries({ queryKey: keys.collections });
      qc.invalidateQueries({ queryKey: ['items'] });
    } catch (err) {
      setError(
        err instanceof ApiError && err.body.issues?.length
          ? [err.message, ...err.body.issues.map((i) => i.message)]
          : [errorMessage(err)],
      );
    } finally {
      setBusy(false);
    }
  }

  if (editable.length === 0) {
    return (
      <Section title="Import from CSV">
        <p className="text-[0.9rem] text-ink-muted">You can only import into collections you can edit.</p>
      </Section>
    );
  }

  return (
    <Section title="Import from CSV">
      <p className="text-[0.9rem] text-ink-muted">
        Each row becomes an item. Commas, semicolons and tabs all work; the first row names the columns.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[0.9rem] text-ink-muted">
          Into
          <Select
            aria-label="Collection to import into"
            value={collectionId}
            onChange={(e) => {
              setCollectionId(e.target.value);
              setFile(null);
              setDone(null);
            }}
            className="w-auto"
          >
            {editable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <Button icon="plus" onClick={() => input.current?.click()} disabled={!template.data}>
          {file ? 'Choose another file' : 'Choose a CSV file'}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          hidden
          aria-label="CSV file"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {file && (
          <span className="text-[0.86rem] text-ink-muted">
            {file.name} · {file.csv.rows.length} row{file.csv.rows.length === 1 ? '' : 's'} ·{' '}
            {{ ',': 'commas', ';': 'semicolons', '\t': 'tabs' }[file.csv.delimiter]}
          </span>
        )}
      </div>

      {done && (
        <p
          className="flex flex-wrap items-center gap-2 rounded-[10px] bg-surface-sunk px-3 py-2.5 text-[0.92rem]"
          role="status"
        >
          <Icon name="check" size={16} className="text-ok" />
          Imported {done.created} item{done.created === 1 ? '' : 's'} into {done.collection.name} ({done.firstAccession}
          {done.created > 1 && `–${done.lastAccession}`}).
          <Link to="/c/$collectionId" params={{ collectionId: done.collection.id }} className="font-semibold">
            Open {done.collection.name}
          </Link>
        </p>
      )}
      {error && (
        <ErrorBox>
          <ul className="m-0 list-disc pl-5">
            {error.slice(0, 12).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </ErrorBox>
      )}

      {file && converted && (
        <>
          <div className="grid gap-1.5">
            <span className="text-[0.86rem] text-ink-muted">
              What each column fills. Columns were matched to fields by name; change any of them.
            </span>
            <div className="overflow-x-auto rounded-[10px] border border-line">
              <table className="w-full border-collapse text-[0.86rem]">
                <thead>
                  <tr className="bg-surface-sunk text-left">
                    {columns.map(({ h, c, key }) => (
                      <th key={key} className="min-w-36 border-b border-line px-2.5 py-2 align-top font-normal">
                        <div className="truncate pb-1 text-[0.72rem] font-semibold tracking-[0.06em] text-ink-muted uppercase">
                          {h || `Column ${c + 1}`}
                        </div>
                        <Select
                          aria-label={`Column ${h || c + 1} fills`}
                          value={targets[c] ?? ''}
                          onChange={(e) =>
                            setTargets((prev) =>
                              prev.map((t, j) => (j === c ? e.target.value || null : t === e.target.value ? null : t)),
                            )
                          }
                          className="py-1 text-[0.84rem]"
                        >
                          <option value="">Don’t import</option>
                          <option value="$title">Title</option>
                          {fields
                            .filter((f) => f.type !== 'person')
                            .map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.label}
                              </option>
                            ))}
                        </Select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map(({ r, row, key }) => {
                    return (
                      <tr key={key} className="border-t border-line">
                        {columns.map(({ c, key: colKey }) => (
                          <td
                            key={colKey}
                            className={cx(
                              'max-w-60 truncate px-2.5 py-1.5',
                              !targets[c] && 'text-ink-faint',
                              row?.problems.has(c) && 'bg-danger-soft text-danger',
                            )}
                            title={row?.problems.has(c) ? 'This value can’t be used; it will be left empty' : r[c]}
                          >
                            {r[c]}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {file.csv.rows.length > PREVIEW_ROWS && (
              <span className="text-[0.8rem] text-ink-faint">
                Showing the first {PREVIEW_ROWS} of {file.csv.rows.length} rows.
              </span>
            )}
          </div>
          <ul className="m-0 grid list-disc gap-0.5 pl-5 text-[0.88rem] text-ink-muted">
            {!converted.hasTitle && <li className="text-danger">Pick the column that holds each item’s title.</li>}
            {converted.hasTitle && converted.untitled > 0 && (
              <li>
                {converted.untitled} row{converted.untitled === 1 ? ' has' : 's have'} no title and will be skipped.
              </li>
            )}
            {converted.bad > 0 && (
              <li>
                {converted.bad} value{converted.bad === 1 ? '' : 's'} can’t be used (marked in red in the preview) and
                will be left empty.
              </li>
            )}
            {file.csv.rows.length > IMPORT_MAX_ROWS && (
              <li className="text-danger">
                That’s more than {IMPORT_MAX_ROWS} rows; split the file and import it in parts.
              </li>
            )}
          </ul>
          <div>
            <Button
              variant="primary"
              onClick={() => void runImport()}
              disabled={
                busy ||
                !converted.hasTitle ||
                converted.rows.length - converted.untitled === 0 ||
                file.csv.rows.length > IMPORT_MAX_ROWS
              }
            >
              {busy
                ? 'Importing…'
                : `Import ${converted.rows.length - converted.untitled} item${converted.rows.length - converted.untitled === 1 ? '' : 's'} into ${collection?.name}`}
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}

export function ImportExportPage() {
  const collections = useCollections();
  return (
    <div className="grid gap-5">
      <h1 className="text-[2rem] leading-none font-bold">Import & export</h1>
      {collections.isPending ? (
        <Spinner />
      ) : collections.isError ? (
        <ErrorBox>{errorMessage(collections.error)}</ErrorBox>
      ) : collections.data.length === 0 ? (
        <EmptyState title="No collections yet">Make a collection first, then import items into it.</EmptyState>
      ) : (
        <>
          <Importer collections={collections.data} />
          <ExportList collections={collections.data} />
        </>
      )}
    </div>
  );
}
