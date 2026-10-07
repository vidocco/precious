import Fastify, { type FastifyServerOptions } from 'fastify';
import { type HealthDeps, healthRoutes } from './routes/health.ts';

export interface AppDeps extends HealthDeps {}

export function buildApp(deps: AppDeps, options: FastifyServerOptions = {}) {
  const app = Fastify(options);
  app.register(healthRoutes, deps);
  return app;
}
