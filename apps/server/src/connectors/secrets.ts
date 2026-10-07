import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { EncryptedSecret } from '../db/schema.ts';

function keyFrom(appSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', appSecret, 'precious', 'data-source-secrets', 32));
}

export function encryptSecret(appSecret: string, value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(appSecret), iv);
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

export function decryptSecret(appSecret: string, s: EncryptedSecret): string {
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(appSecret), Buffer.from(s.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(s.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(s.ct, 'base64')), decipher.final()]).toString('utf8');
}

/** Decrypts every secret. One that can't be read (APP_SECRET changed) is left out. */
export function decryptAll(appSecret: string, secrets: Record<string, EncryptedSecret>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, s] of Object.entries(secrets)) {
    try {
      out[name] = decryptSecret(appSecret, s);
    } catch {
      // Left out: the request will report the secret as missing.
    }
  }
  return out;
}

const MASK = '••••••••';
const SENSITIVE_HEADERS = /^(authorization|proxy-authorization|cookie|x-api-key|api-key)$/i;

/** Hides secret values (and their URL-encoded and base64 forms) in text shown back to people. */
export function maskSecrets(text: string, secretValues: string[]): string {
  let out = text;
  for (const v of secretValues) {
    if (v.length < 3) continue;
    for (const form of [v, encodeURIComponent(v), Buffer.from(v).toString('base64')]) {
      out = out.split(form).join(MASK);
    }
  }
  return out;
}

export function maskHeader(name: string, value: string, secretValues: string[]): string {
  if (SENSITIVE_HEADERS.test(name)) {
    const scheme = value.match(/^(Bearer|Basic|Token)\s/i)?.[1];
    return scheme ? `${scheme} ${MASK}` : MASK;
  }
  return maskSecrets(value, secretValues);
}
