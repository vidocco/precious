import type { SourceAuth } from '@precious/shared';
import { StageError } from './errors.ts';

export type FetchLike = typeof fetch;

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** OAuth2 client-credentials tokens, kept in memory until shortly before they expire. */
export class TokenCache {
  private tokens = new Map<string, CachedToken>();

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  private key(sourceId: string, auth: Extract<SourceAuth, { type: 'oauth2' }>, clientId: string) {
    return `${sourceId}|${auth.tokenUrl}|${clientId}|${auth.scope ?? ''}`;
  }

  invalidate(sourceId: string, auth: Extract<SourceAuth, { type: 'oauth2' }>, clientId: string) {
    this.tokens.delete(this.key(sourceId, auth, clientId));
  }

  async get(
    sourceId: string,
    auth: Extract<SourceAuth, { type: 'oauth2' }>,
    clientId: string,
    clientSecret: string,
  ): Promise<string> {
    const key = this.key(sourceId, auth, clientId);
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (auth.scope) form.set('scope', auth.scope);
    let res: Response;
    try {
      res = await this.fetchImpl(auth.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: form,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new StageError('auth', `Couldn't reach the token address: ${(err as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new StageError(
        'auth',
        `The token address answered ${res.status}. Check the client ID and secret. ${text.slice(0, 200)}`,
      );
    }
    let json: { access_token?: string; expires_in?: number };
    try {
      json = JSON.parse(text);
    } catch {
      throw new StageError('auth', 'The token address did not answer with JSON.');
    }
    if (!json.access_token) throw new StageError('auth', 'The token address answered without an access_token.');
    const lifetime = (json.expires_in ?? 3600) * 1000;
    this.tokens.set(key, { token: json.access_token, expiresAt: Date.now() + Math.max(lifetime - 60_000, 30_000) });
    return json.access_token;
  }
}

function needSecret(secrets: Record<string, string>, name: string): string {
  const v = secrets[name];
  if (!v) throw new StageError('auth', `The secret "${name}" isn't set. Add it in the source's settings.`);
  return v;
}

/** Adds credentials to a request according to the source's auth settings. */
export async function applyAuth(
  auth: SourceAuth,
  ctx: {
    sourceId: string;
    secrets: Record<string, string>;
    renderText: (t: string, where: string) => Promise<string>;
    tokens: TokenCache;
  },
  req: { url: URL; headers: Headers },
): Promise<void> {
  switch (auth.type) {
    case 'none':
      return;
    case 'apiKey': {
      const v = needSecret(ctx.secrets, auth.secret);
      if (auth.in === 'query') req.url.searchParams.set(auth.name, v);
      else req.headers.set(auth.name, v);
      return;
    }
    case 'bearer':
      req.headers.set('authorization', `Bearer ${needSecret(ctx.secrets, auth.secret)}`);
      return;
    case 'basic': {
      const user = await ctx.renderText(auth.username, 'username');
      const pass = needSecret(ctx.secrets, auth.secret);
      req.headers.set('authorization', `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`);
      return;
    }
    case 'oauth2': {
      const clientId = await ctx.renderText(auth.clientId, 'client ID');
      const token = await ctx.tokens.get(ctx.sourceId, auth, clientId, needSecret(ctx.secrets, auth.secret));
      req.headers.set('authorization', `Bearer ${token}`);
      return;
    }
  }
}
