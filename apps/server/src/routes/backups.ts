import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { mustAdmin } from '../auth/guard.ts';
import type { AppContext } from '../context.ts';
import { HttpError, notFound } from '../errors.ts';
import type { BackupStatus } from '../services/backups.ts';

/** Database backups, for admins: what's there, making one now, downloading one. */
export const backupRoutes: FastifyPluginAsyncZod<AppContext> = async (app, ctx) => {
  const off: BackupStatus = { enabled: false, keep: 0, at: '', nextRunAt: null, last: null, backups: [] };

  app.get('/api/server/backups', { schema: { tags: ['server'] } }, async (req) => {
    mustAdmin(req);
    return ctx.backups ? ctx.backups.status() : off;
  });

  app.post('/api/server/backups', { schema: { tags: ['server'] } }, async (req) => {
    mustAdmin(req);
    if (!ctx.backups) throw new HttpError(409, 'backups_off', 'Backups are off: set BACKUP_DIR to turn them on.');
    try {
      await ctx.backups.run();
    } catch (err) {
      throw new HttpError(500, 'backup_failed', `The backup failed: ${(err as Error).message}`);
    }
    return ctx.backups.status();
  });

  app.get(
    '/api/server/backups/:name',
    { schema: { tags: ['server'], params: z.object({ name: z.string().max(80) }) } },
    async (req, reply) => {
      mustAdmin(req);
      const stream = ctx.backups?.file(req.params.name);
      if (!stream) throw notFound('Backup');
      const opened = await new Promise<boolean>((resolve) => {
        stream.once('open', () => resolve(true));
        stream.once('error', () => resolve(false));
      });
      if (!opened) throw notFound('Backup');
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', `attachment; filename="${req.params.name}"`)
        .send(stream);
    },
  );
};
