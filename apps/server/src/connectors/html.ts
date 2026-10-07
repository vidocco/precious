import type { Extract, ExtractNode } from '@precious/shared';
import { JSDOM } from 'jsdom';
import { StageError } from './errors.ts';

/** Parses HTML without running scripts or fetching anything. */
export function loadHtml(text: string, url: string): Document {
  return new JSDOM(text, { url, contentType: 'text/html' }).window.document;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Escapes a value for use inside a quoted CSS attribute selector. */
const cssString = (s: string) => s.replace(/["\\]/g, '\\$&');

function ownText(el: Element): string {
  let out = '';
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) out += n.textContent ?? '';
  return out;
}

function takeValue(node: Node, value = 'text'): string | null {
  if (node.nodeType === 2) return (node as Attr).value;
  if (node.nodeType !== 1) return node.textContent;
  const el = node as Element;
  if (value === 'text') return el.textContent;
  if (value === 'ownText') return ownText(el);
  if (value === 'html') return el.innerHTML;
  if (value.startsWith('attr:')) return el.getAttribute(value.slice(5));
  return el.textContent;
}

function toNumber(s: string): number | null {
  const cleaned = s.replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;
  // "1.234,5" and "1,234.5" both mean 1234.5; a lone comma is a decimal comma.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const normal = lastComma > lastDot ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  const n = Number.parseFloat(normal);
  return Number.isFinite(n) ? n : null;
}

function postProcess(raw: string | null, node: ExtractNode, baseUrl: string, path: string): unknown {
  if (raw === null || raw === undefined) return null;
  let v: string | null = node.trim === false ? raw : collapse(raw);
  if (node.regex) {
    let re: RegExp;
    try {
      re = new RegExp(node.regex, 'u');
    } catch (err) {
      throw new StageError('extract', `${path}: the regex is not valid (${(err as Error).message}).`, path);
    }
    const m = v.match(re);
    v = m ? (m[1] ?? m[0]) : null;
  }
  if (v === null || v === '') return null;
  if (node.absoluteUrl) {
    try {
      v = new URL(v, baseUrl).href;
    } catch {
      return null;
    }
  }
  switch (node.as) {
    case 'number':
      return toNumber(v);
    case 'boolean':
      return /^(true|yes|y|1|s[ií]|on)$/i.test(v);
    case 'date': {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    default:
      return v;
  }
}

function jsonLd(doc: Document, type: string | true): unknown[] {
  const out: unknown[] = [];
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(s.textContent ?? '');
    } catch {
      continue;
    }
    const queue = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of queue) {
      const graph = (entry as { '@graph'?: unknown[] })?.['@graph'];
      for (const obj of Array.isArray(graph) ? graph : [entry]) {
        const t = (obj as { '@type'?: string | string[] })?.['@type'];
        const types = Array.isArray(t) ? t : [t];
        if (type === true || types.includes(type)) out.push(obj);
      }
    }
  }
  return out;
}

function matches(ctx: Document | Element, doc: Document, node: ExtractNode, path: string): Node[] {
  if (node.css) {
    try {
      return Array.from(ctx.querySelectorAll(node.css));
    } catch {
      throw new StageError('extract', `${path}: "${node.css}" is not a valid CSS selector.`, path);
    }
  }
  if (node.xpath) {
    let snap: XPathResult;
    try {
      snap = doc.evaluate(node.xpath, ctx, null, 7 /* ORDERED_NODE_SNAPSHOT_TYPE */, null);
    } catch {
      throw new StageError('extract', `${path}: "${node.xpath}" is not a valid XPath expression.`, path);
    }
    const out: Node[] = [];
    for (let i = 0; i < snap.snapshotLength; i++) {
      const n = snap.snapshotItem(i);
      if (n) out.push(n);
    }
    return out;
  }
  return [ctx];
}

function evalNode(ctx: Document | Element, doc: Document, node: ExtractNode, baseUrl: string, path: string): unknown {
  const fallback = node.default ?? (node.many ? [] : null);
  let values: unknown[];

  if (node.jsonld !== undefined) {
    values = jsonLd(doc, node.jsonld);
  } else if (node.meta) {
    const el = doc.querySelector(`meta[property="${cssString(node.meta)}"], meta[name="${cssString(node.meta)}"]`);
    values = el ? [postProcess(el.getAttribute('content'), node, baseUrl, path)] : [];
  } else if (node.scriptJson) {
    values = [];
    for (const el of matches(ctx, doc, { css: node.scriptJson }, path)) {
      try {
        values.push(JSON.parse(el.textContent ?? ''));
      } catch {
        throw new StageError(
          'extract',
          `${path}: the script matched by "${node.scriptJson}" doesn't contain valid JSON.`,
          path,
        );
      }
    }
  } else {
    const found = matches(ctx, doc, node, path);
    values = found.map((m, i) => {
      if (node.fields) {
        if (m.nodeType !== 1 && m.nodeType !== 9) return null;
        const obj: Record<string, unknown> = {};
        for (const [k, child] of Object.entries(node.fields)) {
          obj[k] = evalNode(m as Element, doc, child, baseUrl, `${path}[${i}].${k}`);
        }
        return obj;
      }
      return postProcess(takeValue(m, node.value), node, baseUrl, path);
    });
  }

  const present = values.filter((v) => v !== null && v !== undefined);
  if (node.many) return present.length ? present : fallback;
  return present[0] ?? fallback;
}

/** Runs an extract tree against a page and returns plain JSON. */
export function extract(doc: Document, spec: Extract, baseUrl: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, node] of Object.entries(spec)) out[key] = evalNode(doc, doc, node, baseUrl, key);
  return out;
}

const MAX_PREVIEW = 2 * 1024 * 1024;

/**
 * A copy of the page that is safe to show in the console's picker: no scripts, no
 * event handlers, no frames, and a <base> so relative images still load.
 */
export function previewHtml(doc: Document, url: string): string {
  const copy = doc.cloneNode(true) as Document;
  for (const el of Array.from(
    copy.querySelectorAll(
      'script, noscript, iframe, frame, object, embed, link[rel="preload"], meta[http-equiv], base',
    ),
  )) {
    el.remove();
  }
  for (const el of Array.from(copy.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || /^\s*javascript:/i.test(attr.value) || name === 'srcdoc')
        el.removeAttribute(attr.name);
    }
  }
  const head = copy.head ?? copy.documentElement;
  const base = copy.createElement('base');
  base.setAttribute('href', url);
  head.prepend(base);
  const html = `<!doctype html>${copy.documentElement.outerHTML}`;
  return html.length > MAX_PREVIEW ? html.slice(0, MAX_PREVIEW) : html;
}
