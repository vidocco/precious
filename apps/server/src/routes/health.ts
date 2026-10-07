import type { HealthResponse } from '@precious/shared';
import type { FastifyInstance } from 'fastify';
import { VERSION } from '../version.ts';

export interface HealthDeps {
  pingDatabase: () => Promise<boolean>;
}

export async function healthRoutes(app: FastifyInstance, deps: HealthDeps) {
  app.get('/api/health', async (_req, reply) => {
    const databaseUp = await deps.pingDatabase();
    const body: HealthResponse = {
      status: databaseUp ? 'ok' : 'degraded',
      version: VERSION,
      database: databaseUp ? 'up' : 'down',
    };
    return reply.code(databaseUp ? 200 : 503).send(body);
  });
}
