import type { EndpointRole } from '@precious/shared';
import jsonata from 'jsonata';
import { StageError } from './errors.ts';

const MAX_RESULTS = 50;
const compiled = new Map<string, jsonata.Expression>();

/** Expressions get at most 1 s and 300 levels of nesting, so a runaway one can't hang the server. */
const GUARDRAILS = { timeout: 1000, stack: 300 };

function compile(text: string, key: string): jsonata.Expression {
  let expr = compiled.get(text);
  if (expr) return expr;
  try {
    expr = jsonata(text, GUARDRAILS as jsonata.JsonataOptions);
  } catch (err) {
    const e = err as { message?: string; position?: number };
    throw new StageError('map', `${key}: ${e.message}${e.position ? ` (at character ${e.position})` : ''}`, key);
  }
  if (compiled.size > 500) compiled.clear();
  compiled.set(text, expr);
  return expr;
}

export async function evaluate(text: string, input: unknown, key: string): Promise<unknown> {
  const expr = compile(text, key);
  try {
    const result = await expr.evaluate(input);
    // JSONata sequences carry hidden flags; a JSON round-trip leaves plain values.
    return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
  } catch (err) {
    const e = err as { message?: string; position?: number; code?: string };
    const message =
      e.code === 'D1012'
        ? 'the expression took longer than 1 s (an endless loop?)'
        : e.code === 'D1011'
          ? 'the expression nests too deeply (endless recursion?)'
          : (e.message ?? String(err));
    throw new StageError('map', `${key}: ${message}${e.position ? ` (at character ${e.position})` : ''}`, key);
  }
}

/** Applies an endpoint's mapping to the parsed response, shaped by its role. */
export async function mapOutput(role: EndpointRole, map: Record<string, string>, data: unknown): Promise<unknown> {
  if (role === 'compute') {
    return evaluate(map.value?.trim() || '$', data, 'value');
  }
  if (role === 'lookup') {
    const out: Record<string, unknown> = {};
    for (const [key, text] of Object.entries(map)) {
      if (!text.trim()) continue;
      const v = await evaluate(text, data, key);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  const listed = await evaluate(map.results?.trim() || '$', data, 'results');
  const list = listed === undefined || listed === null ? [] : Array.isArray(listed) ? listed : [listed];
  const keys = Object.entries(map).filter(([k, t]) => k !== 'results' && t.trim());
  const results: Record<string, unknown>[] = [];
  for (const [i, entry] of list.slice(0, MAX_RESULTS).entries()) {
    const obj: Record<string, unknown> = {};
    for (const [key, text] of keys) {
      const v = await evaluate(text, entry, `results[${i}].${key}`);
      if (v !== undefined && v !== null && v !== '') obj[key] = v;
    }
    results.push(obj);
  }
  return results;
}
