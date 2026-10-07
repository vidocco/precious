import { createUserInputSchema, type UserDto, updateUserInputSchema } from '@precious/shared';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createUserWithPassword, setUserPassword } from '../auth/auth.ts';
import { mustAdmin, mustUser } from '../auth/guard.ts';
import type { AppContext } from '../context.ts';
import { collections, user } from '../db/schema.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';

const toDto = (row: typeof user.$inferSelect): UserDto => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role === 'admin' ? 'admin' : 'member',
  createdAt: row.createdAt.toISOString(),
});

export const userRoutes: FastifyPluginAsyncZod<AppContext> = async (app, ctx) => {
  const { db } = ctx.database;
  const idParams = z.object({ id: z.string().min(1) });

  // Everyone signed in can list people (for "lent to", owners and sharing); only admins manage them.
  app.get('/api/users', { schema: { tags: ['users'] } }, async (req) => {
    mustUser(req);
    const rows = await db.select().from(user).orderBy(asc(user.name));
    return rows.map(toDto);
  });

  app.post('/api/users', { schema: { tags: ['users'], body: createUserInputSchema } }, async (req, reply) => {
    mustAdmin(req);
    const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, req.body.email));
    if (existing) throw new HttpError(409, 'email_taken', 'Someone already uses that email address.');
    const created = await createUserWithPassword(ctx.auth, req.body);
    const [row] = await db.select().from(user).where(eq(user.id, created.id));
    return reply.code(201).send(toDto(row as typeof user.$inferSelect));
  });

  app.patch(
    '/api/users/:id',
    { schema: { tags: ['users'], params: idParams, body: updateUserInputSchema } },
    async (req) => {
      const admin = mustAdmin(req);
      const [row] = await db.select().from(user).where(eq(user.id, req.params.id));
      if (!row) throw notFound('Person');
      const { name, role, password } = req.body;
      if (role === 'member' && row.role === 'admin') {
        if (row.id === admin.id) throw badRequest("You can't remove your own admin role.");
        await ensureAnotherAdmin(row.id);
      }
      if (name !== undefined || role !== undefined) {
        await db
          .update(user)
          .set({ ...(name !== undefined && { name }), ...(role !== undefined && { role }) })
          .where(eq(user.id, row.id));
      }
      if (password) await setUserPassword(ctx.auth, row.id, password);
      const [updated] = await db.select().from(user).where(eq(user.id, row.id));
      return toDto(updated as typeof user.$inferSelect);
    },
  );

  app.delete('/api/users/:id', { schema: { tags: ['users'], params: idParams } }, async (req, reply) => {
    const admin = mustAdmin(req);
    if (req.params.id === admin.id) throw badRequest("You can't delete your own account.");
    const [row] = await db.select().from(user).where(eq(user.id, req.params.id));
    if (!row) throw notFound('Person');
    if (row.role === 'admin') await ensureAnotherAdmin(row.id);
    const [owned] = await db.select({ n: count() }).from(collections).where(eq(collections.ownerId, row.id));
    if ((owned?.n ?? 0) > 0) {
      throw new HttpError(
        409,
        'owns_collections',
        `${row.name} owns ${owned?.n} collection(s). Delete them or give them to someone else first.`,
      );
    }
    await db.delete(user).where(eq(user.id, row.id));
    return reply.code(204).send();
  });

  async function ensureAnotherAdmin(exceptId: string) {
    const [others] = await db
      .select({ n: count() })
      .from(user)
      .where(and(eq(user.role, 'admin'), ne(user.id, exceptId)));
    if ((others?.n ?? 0) === 0) throw badRequest('Precious needs at least one admin.');
  }
};
