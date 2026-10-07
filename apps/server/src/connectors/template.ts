import { Liquid } from 'liquidjs';
import { StageError } from './errors.ts';

/**
 * Liquid renders request templates: {{ query }}, {{ refs.igdb }}, {{ item.title }},
 * {{ secrets.apiKey }}. It has no access to code, and renders are capped in time,
 * size and memory.
 */
const engine = new Liquid({
  strictFilters: true,
  ownPropertyOnly: true,
  jsTruthy: true,
  cache: 500,
  parseLimit: 100_000,
  renderLimit: 1000,
  memoryLimit: 10_000_000,
});

/** Escapes a value for use inside a JSON or Apicalypse string literal. */
engine.registerFilter('json_escape', (v: unknown) => JSON.stringify(String(v ?? '')).slice(1, -1));
/** Writes a value as JSON (strings get quotes). */
engine.registerFilter('json', (v: unknown) => JSON.stringify(v ?? null));

export interface TemplateContext {
  query: string;
  refs: Record<string, string>;
  item: Record<string, unknown>;
  previous: Record<string, unknown>;
  secrets: Record<string, string>;
}

export async function render(template: string, ctx: TemplateContext, where: string): Promise<string> {
  if (!template.includes('{')) return template;
  try {
    return String(await engine.parseAndRender(template, ctx));
  } catch (err) {
    throw new StageError('template', `${where}: ${(err as Error).message.split('\n')[0]}`, where);
  }
}
