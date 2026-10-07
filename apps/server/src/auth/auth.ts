import type { Role } from '@precious/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import * as schema from '../db/schema.ts';

export function createAuth(db: Db, config: Config) {
  return betterAuth({
    secret: config.APP_SECRET,
    baseURL: config.PUBLIC_URL,
    basePath: '/api/auth',
    // Sign-in works from whichever address the household uses (http://tower.local:8080,
    // http://192.168.1.10:8080, a proxy's https address): the request's own host is trusted,
    // so only cross-site requests, whose Origin differs from it, are refused.
    trustedOrigins: async (request?: Request) => {
      const host = request?.headers.get('host');
      return [config.PUBLIC_URL, ...(host ? [`http://${host}`, `https://${host}`] : [])];
    },
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    // Accounts are created by an admin (or the first-run setup), never by open sign-up.
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10, maxPasswordLength: 128 },
    user: {
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'member', input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      // Behind a plain-HTTP LAN address (common on Unraid) secure cookies would never be sent.
      useSecureCookies: config.PUBLIC_URL.startsWith('https://'),
      // Always on: Better Auth would otherwise skip it under test, so tests wouldn't match production.
      disableOriginCheck: false,
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Creates a user with an email + password login, bypassing the closed sign-up. */
export async function createUserWithPassword(
  auth: Auth,
  input: { name: string; email: string; password: string; role: Role },
): Promise<SessionUser> {
  const ctx = await auth.$context;
  const created = await ctx.internalAdapter.createUser(
    { name: input.name, email: input.email.toLowerCase(), emailVerified: true, role: input.role },
    { method: 'admin' },
  );
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: 'credential',
    accountId: created.id,
    password: await ctx.password.hash(input.password),
  });
  return { id: created.id, name: created.name, email: created.email, role: input.role };
}

export async function setUserPassword(auth: Auth, userId: string, password: string) {
  const ctx = await auth.$context;
  await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password));
  await ctx.internalAdapter.deleteUserSessions(userId);
}
