import type { HealthResponse } from '@precious/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { VERSION } from '../version.ts';

export async function healthRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/health', { schema: { hide: true } }, async (_req, reply) => {
    const databaseUp = await ctx.database.ping();
    const body: HealthResponse = {
      status: databaseUp ? 'ok' : 'degraded',
      version: VERSION,
      database: databaseUp ? 'up' : 'down',
    };
    return reply.code(databaseUp ? 200 : 503).send(body);
  });
}
