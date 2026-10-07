import { EXTRACT_AS, type Extract, type ExtractNode, extractSchema } from '@precious/shared';
import { useEffect, useState } from 'react';
import { Button, cx, IconButton, Select, TextArea, TextInput } from '../../components/ui.tsx';

type Mode = 'css' | 'xpath' | 'jsonld' | 'meta' | 'scriptJson';

const MODE_LABEL: Record<Mode, string> = {
  css: 'CSS selector',
  xpath: 'XPath',
  jsonld: 'JSON-LD (schema.org)',
  meta: 'Meta tag',
  scriptJson: 'JSON in a <script>',
};

function modeOf(n: ExtractNode): Mode {
  if (n.xpath !== undefined) return 'xpath';
  if (n.jsonld !== undefined) return 'jsonld';
  if (n.meta !== undefined) return 'meta';
  if (n.scriptJson !== undefined) return 'scriptJson';
  return 'css';
}

function selectorOf(n: ExtractNode): string {
  const m = modeOf(n);
  if (m === 'jsonld') return n.jsonld === true ? '' : String(n.jsonld ?? '');
  return String(n[m] ?? '');
}

function withSelector(n: ExtractNode, mode: Mode, value: string): ExtractNode {
  const { css: _c, xpath: _x, jsonld: _j, meta: _m, scriptJson: _s, ...rest } = n;
  if (mode === 'jsonld') return { ...rest, jsonld: value.trim() || true };
  return { ...rest, [mode]: value };
}

function Row({
  name,
  node,
  onRename,
  onChange,
  onRemove,
  onFocus,
  active,
}: {
  name: string;
  node: ExtractNode;
  onRename: (n: string) => void;
  onChange: (n: ExtractNode) => void;
  onRemove: () => void;
  onFocus: () => void;
  active: boolean;
}) {
  const mode = modeOf(node);
  const value = node.value ?? 'text';
  const valueKind = value.startsWith('attr:') ? 'attr' : value;
  const nested = !!node.fields;
  const takesValue = mode === 'css' || mode === 'xpath';
  return (
    <div
      onFocusCapture={onFocus}
      className={cx('grid gap-2 rounded-[10px] border bg-surface p-2.5', active ? 'border-accent' : 'border-line')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          aria-label="Name"
          value={name}
          onChange={(e) => onRename(e.target.value)}
          className="w-36 py-1 font-semibold"
        />
        <Select
          aria-label="Find it by"
          value={mode}
          onChange={(e) => onChange(withSelector(node, e.target.value as Mode, selectorOf(node)))}
          className="w-auto py-1 text-[0.85rem]"
        >
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </Select>
        <TextInput
          aria-label="Selector"
          value={selectorOf(node)}
          placeholder={
            mode === 'css'
              ? 'h1.title'
              : mode === 'xpath'
                ? './td[3]/text()'
                : mode === 'jsonld'
                  ? 'Book (optional type)'
                  : mode === 'meta'
                    ? 'og:image'
                    : 'script#__NEXT_DATA__'
          }
          onChange={(e) => onChange(withSelector(node, mode, e.target.value))}
          className="min-w-40 flex-1 py-1 text-[0.88rem] italic"
        />
        <IconButton icon="x" label={`Remove ${name}`} onClick={onRemove} className="size-8" />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.82rem] text-ink-muted">
        {takesValue && !nested && (
          <>
            <Select
              aria-label="Take"
              value={valueKind}
              onChange={(e) => onChange({ ...node, value: e.target.value === 'attr' ? 'attr:href' : e.target.value })}
              className="w-auto py-0.5 text-[0.82rem]"
            >
              <option value="text">Text</option>
              <option value="ownText">Own text only</option>
              <option value="html">HTML</option>
              <option value="attr">Attribute…</option>
            </Select>
            {valueKind === 'attr' && (
              <TextInput
                aria-label="Attribute"
                value={value.slice(5)}
                onChange={(e) => onChange({ ...node, value: `attr:${e.target.value}` })}
                className="w-28 py-0.5 text-[0.82rem]"
              />
            )}
          </>
        )}
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={!!node.many}
            onChange={(e) => onChange({ ...node, many: e.target.checked || undefined })}
            className="accent-[var(--accent)]"
          />
          Every match
        </label>
        {!nested && (
          <>
            <TextInput
              aria-label="Regex"
              placeholder="Regex, e.g. (\d{4})"
              value={node.regex ?? ''}
              onChange={(e) => onChange({ ...node, regex: e.target.value || undefined })}
              className="w-40 py-0.5 text-[0.82rem]"
            />
            <Select
              aria-label="As"
              value={node.as ?? 'string'}
              onChange={(e) =>
                onChange({
                  ...node,
                  as: e.target.value === 'string' ? undefined : (e.target.value as ExtractNode['as']),
                })
              }
              className="w-auto py-0.5 text-[0.82rem]"
            >
              {EXTRACT_AS.map((a) => (
                <option key={a} value={a}>
                  {a === 'string' ? 'As text' : `As ${a}`}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={!!node.absoluteUrl}
                onChange={(e) => onChange({ ...node, absoluteUrl: e.target.checked || undefined })}
                className="accent-[var(--accent)]"
              />
              Full address
            </label>
          </>
        )}
        {nested && (
          <span className="italic">Has nested fields: {Object.keys(node.fields ?? {}).join(', ')} (edit as JSON)</span>
        )}
      </div>
    </div>
  );
}

/** Edits the HTML extract tree: simple rows for top-level values, or the whole tree as JSON. */
export function ExtractEditor({
  value,
  onChange,
  active,
  onActive,
}: {
  value: Extract;
  onChange: (v: Extract) => void;
  active: string | null;
  onActive: (name: string | null) => void;
}) {
  const [asJson, setAsJson] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [jsonError, setJsonError] = useState('');
  useEffect(() => {
    if (!asJson) setText(JSON.stringify(value, null, 2));
  }, [value, asJson]);

  const entries = Object.entries(value);
  const rename = (from: string, to: string) => {
    if (!to || (to !== from && value[to])) return;
    onChange(Object.fromEntries(entries.map(([k, v]) => (k === from ? [to, v] : [k, v]))));
    if (active === from) onActive(to);
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.82rem] text-ink-muted">
          Turns the page into JSON. Click an element in the page preview to add it.
        </span>
        <Button size="sm" variant="ghost" onClick={() => setAsJson(!asJson)}>
          {asJson ? 'Edit as rows' : 'Edit as JSON'}
        </Button>
      </div>
      {asJson ? (
        <>
          <TextArea
            aria-label="Extract as JSON"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              try {
                const parsed = extractSchema.parse(JSON.parse(e.target.value));
                setJsonError('');
                onChange(parsed);
              } catch (err) {
                setJsonError(
                  err instanceof SyntaxError ? 'Not valid JSON yet.' : 'Valid JSON, but not a valid extract tree.',
                );
              }
            }}
            className="min-h-60 text-[0.82rem]"
          />
          {jsonError && <span className="text-[0.8rem] text-danger">{jsonError}</span>}
        </>
      ) : (
        <>
          {entries.map(([name, node]) => (
            <Row
              key={name}
              name={name}
              node={node}
              active={active === name}
              onFocus={() => onActive(name)}
              onRename={(to) => rename(name, to)}
              onChange={(n) => onChange({ ...value, [name]: n })}
              onRemove={() => {
                const { [name]: _gone, ...rest } = value;
                onChange(rest);
                if (active === name) onActive(null);
              }}
            />
          ))}
          <Button
            size="sm"
            icon="plus"
            variant="ghost"
            className="justify-self-start text-accent"
            onClick={() => {
              let n = entries.length + 1;
              while (value[`field${n}`]) n++;
              onChange({ ...value, [`field${n}`]: { css: '' } });
              onActive(`field${n}`);
            }}
          >
            Add a value
          </Button>
        </>
      )}
    </div>
  );
}
