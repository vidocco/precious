/** Lower-cases and strips accents so "Linternas" and "línternas" compare equal. */
export function normalize(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function trigrams(word: string): Set<string> {
  const padded = `  ${word} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Trigram similarity between two words, the same idea Postgres pg_trgm uses. */
export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared || 1);
}

const SNIPPET_RADIUS = 36;

/** Cuts a snippet around [start, end) and wraps the match in « ». */
export function snippet(text: string, start: number, end: number): string {
  const from = Math.max(0, start - SNIPPET_RADIUS);
  const to = Math.min(text.length, end + SNIPPET_RADIUS);
  return `${from > 0 ? '…' : ''}${text.slice(from, start)}«${text.slice(start, end)}»${text.slice(end, to)}${to < text.length ? '…' : ''}`;
}

/**
 * Finds where a query matches among labelled texts: an exact (accent-free) substring
 * first, otherwise the most similar word. Returns null when nothing is close.
 */
export function findMatch(
  query: string,
  entries: { label: string; text: string }[],
): { label: string; snippet: string } | null {
  const q = normalize(query.trim());
  if (!q) return null;
  for (const e of entries) {
    // normalize() keeps string length for precomposed accents, so indexes line up.
    const idx = normalize(e.text).indexOf(q);
    if (idx !== -1) return { label: e.label, snippet: snippet(e.text, idx, idx + q.length) };
  }
  let best: { label: string; text: string; start: number; end: number; score: number } | null = null;
  for (const e of entries) {
    const re = /[\p{L}\p{N}]+/gu;
    for (let m = re.exec(e.text); m; m = re.exec(e.text)) {
      const score = similarity(q, normalize(m[0]));
      if (!best || score > best.score) {
        best = { label: e.label, text: e.text, start: m.index, end: m.index + m[0].length, score };
      }
    }
  }
  if (!best || best.score < 0.3) return null;
  return { label: `${best.label} (similar)`, snippet: snippet(best.text, best.start, best.end) };
}
