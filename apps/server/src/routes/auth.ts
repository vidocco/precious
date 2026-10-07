import { type SetupStatus, setupInputSchema, type UserDto } from '@precious/shared';
import { fromNodeHeaders } from 'better-auth/node';
import { count, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CLIENT_IP_HEADER, createUserWithPassword } from '../auth/auth.ts';
import { mustUser } from '../auth/guard.ts';
import type { AppContext } from '../context.ts';
import { user } from '../db/schema.ts';
import { HttpError } from '../errors.ts';

export const authRoutes: FastifyPluginAsyncZod<AppContext> = async (app, ctx) => {
  const { db } = ctx.database;

  // Better Auth handles sign-in, sign-out, sessions and password changes.
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    schema: { hide: true },
    async handler(req, reply) {
      const url = new URL(req.url, ctx.config.PUBLIC_URL);
      const headers = fromNodeHeaders(req.headers);
      // Better Auth limits sign-in attempts per address; this header (always overwritten,
      // so it can't be faked) carries the one Fastify saw, or the proxy's X-Forwarded-For
      // when TRUST_PROXY is on.
      headers.set(CLIENT_IP_HEADER, req.ip);
      const request = new Request(url, {
        method: req.method,
        headers,
        body: req.method === 'POST' && req.body !== undefined ? JSON.stringify(req.body) : undefined,
      });
      const res = await ctx.auth.handler(request);
      reply.code(res.status);
      for (const [key, value] of res.headers) {
        if (key.toLowerCase() !== 'set-cookie') reply.header(key, value);
      }
      const cookies = res.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(res.body ? Buffer.from(await res.arrayBuffer()) : null);
    },
  });

  async function userCount() {
    const [row] = await db.select({ n: count() }).from(user);
    return row?.n ?? 0;
  }

  app.get('/api/setup', { schema: { tags: ['auth'] } }, async (): Promise<SetupStatus> => {
    return { needsSetup: (await userCount()) === 0 };
  });

  // First run only: creates the admin account. Afterwards admins create accounts.
  app.post('/api/setup', { schema: { tags: ['auth'], body: setupInputSchema } }, async (req, reply) => {
    if ((await userCount()) > 0) {
      throw new HttpError(409, 'already_set_up', 'Precious is already set up. Ask an admin for an account.');
    }
    const created = await createUserWithPassword(ctx.auth, { ...req.body, role: 'admin' });
    return reply.code(201).send(created);
  });

  app.get('/api/me', { schema: { tags: ['auth'] } }, async (req): Promise<UserDto> => {
    const me = mustUser(req);
    const [row] = await db.select().from(user).where(eq(user.id, me.id));
    if (!row) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role === 'admin' ? 'admin' : 'member',
      createdAt: row.createdAt.toISOString(),
    };
  });

  app.patch(
    '/api/me',
    { schema: { tags: ['auth'], body: z.object({ name: z.string().trim().min(1).max(60) }) } },
    async (req) => {
      const me = mustUser(req);
      await db.update(user).set({ name: req.body.name }).where(eq(user.id, me.id));
      return { ok: true };
    },
  );
};
