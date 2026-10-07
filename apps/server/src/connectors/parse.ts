import type { EndpointData } from '@precious/shared';
import { XMLParser } from 'fast-xml-parser';
import { StageError } from './errors.ts';

export type BodyFormat = 'json' | 'xml' | 'html';

export function detectFormat(
  endpoint: Pick<EndpointData, 'format' | 'kind'>,
  contentType: string,
  text: string,
): BodyFormat {
  if (endpoint.format !== 'auto') return endpoint.format;
  if (endpoint.kind === 'html') return 'html';
  if (endpoint.kind === 'graphql') return 'json';
  const ct = contentType.toLowerCase();
  if (ct.includes('json')) return 'json';
  if (ct.includes('html')) return 'html';
  if (ct.includes('xml')) return 'xml';
  const start = text.trimStart()[0];
  if (start === '{' || start === '[') return 'json';
  if (start === '<') return /^\s*<(!doctype html|html)/i.test(text) ? 'html' : 'xml';
  return 'json';
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: true,
});

export function parseBody(format: Exclude<BodyFormat, 'html'>, text: string): unknown {
  if (format === 'json') {
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new StageError(
        'parse',
        `The response isn't valid JSON (${(err as Error).message}). Starts with: ${text.slice(0, 120)}`,
      );
    }
  }
  try {
    return xml.parse(text, true);
  } catch (err) {
    throw new StageError('parse', `The response isn't valid XML: ${(err as Error).message}`);
  }
}

/**
 * GraphQL answers 200 even when it fails, with an `errors` list. Errors without data
 * always fail; with data they fail unless the endpoint accepts partial results.
 */
export function graphqlData(body: unknown, allowPartial: boolean): unknown {
  if (!body || typeof body !== 'object')
    throw new StageError('parse', 'The GraphQL API answered with something other than an object.');
  const { data, errors } = body as { data?: unknown; errors?: { message?: string }[] };
  if (Array.isArray(errors) && errors.length > 0 && (data == null || !allowPartial)) {
    const messages = errors
      .map((e) => e.message ?? 'Unknown error')
      .slice(0, 3)
      .join('; ');
    throw new StageError('parse', `The GraphQL API returned errors: ${messages}`);
  }
  if (data === undefined) throw new StageError('parse', 'The GraphQL answer has no "data".');
  return data;
}
