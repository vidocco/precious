import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * Short signatures for values the server hands to the browser and later gets back:
 * search results and cover addresses. A valid signature proves the server produced
 * the value, so a member can't make the server download an address of their choosing.
 */
const keys = new Map<string, Buffer>();

function keyFor(appSecret: string): Buffer {
  let key = keys.get(appSecret);
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', appSecret, 'precious', 'signed-values', 32));
    keys.set(appSecret, key);
  }
  return key;
}

export function sign(appSecret: string, kind: string, value: string): string {
  return createHmac('sha256', keyFor(appSecret)).update(`${kind}\n${value}`).digest('base64url').slice(0, 32);
}

export function verify(appSecret: string, kind: string, value: string, token: string): boolean {
  const want = Buffer.from(sign(appSecret, kind, value));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** JSON with sorted keys, so the same object always signs the same way. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
