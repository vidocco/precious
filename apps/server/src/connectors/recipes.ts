import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type EndpointData, type PresetDto, type Recipe, recipeSchema } from '@precious/shared';
import type { dataSources } from '../db/schema.ts';

type SourceRow = typeof dataSources.$inferSelect;

/** Secret names a source's settings refer to, from auth and {{ secrets.x }} templates. */
export function referencedSecrets(source: Pick<SourceRow, 'auth' | 'headers'>, endpoints: EndpointData[]): string[] {
  const names = new Set<string>();
  if ('secret' in source.auth) names.add(source.auth.secret);
  const scan = (text: string) => {
    for (const m of text.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1] as string);
  };
  scan(JSON.stringify(source.auth));
  scan(JSON.stringify(source.headers));
  for (const e of endpoints) scan(JSON.stringify([e.path, e.query, e.headers, e.body, e.graphql]));
  return [...names].sort();
}

export function toRecipe(source: SourceRow, endpoints: EndpointData[]): Recipe {
  return {
    format: 'precious-recipe',
    version: 1,
    source: {
      name: source.name,
      description: source.description,
      baseUrl: source.baseUrl,
      auth: source.auth,
      headers: source.headers,
      rateLimit: source.rateLimit,
      cacheSeconds: source.cacheSeconds,
      ...(source.userAgent && { userAgent: source.userAgent }),
    },
    secretNames: [...new Set([...Object.keys(source.secrets), ...referencedSecrets(source, endpoints)])].sort(),
    endpoints: endpoints.map(
      ({
        key,
        name,
        role,
        kind,
        method,
        path,
        query,
        headers,
        body,
        graphql,
        format,
        extract,
        map,
        cacheSeconds,
        sample,
      }) => ({
        key,
        name,
        role,
        kind,
        method,
        path,
        query,
        headers,
        body,
        graphql,
        format,
        extract,
        map,
        cacheSeconds,
        sample,
      }),
    ),
  };
}

export interface Preset extends PresetDto {
  recipe: ReturnType<typeof recipeSchema.parse>;
}

/** Reads the bundled recipes. A broken file is skipped rather than breaking the list. */
export async function loadPresets(dir: string): Promise<Preset[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const presets: Preset[] = [];
  for (const file of files) {
    try {
      const recipe = recipeSchema.parse(JSON.parse(await readFile(join(dir, file), 'utf8')));
      presets.push({
        key: file.replace(/\.json$/, ''),
        name: recipe.source.name,
        description: recipe.source.description,
        kinds: [...new Set(recipe.endpoints.map((e) => e.kind))],
        secretNames: recipe.secretNames,
        recipe,
      });
    } catch {
      // Skip files that aren't valid recipes.
    }
  }
  return presets;
}
