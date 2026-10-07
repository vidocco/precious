import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { loadSessionUser } from './auth/guard.ts';
import type { AppContext } from './context.ts';
import { HttpError } from './errors.ts';
import { authRoutes } from './routes/auth.ts';
import { collectionRoutes } from './routes/collections.ts';
import { healthRoutes } from './routes/health.ts';
import { imageRoutes } from './routes/images.ts';
import { itemRoutes } from './routes/items.ts';
import { publicRoutes } from './routes/public.ts';
import { searchRoutes } from './routes/search.ts';
import { templateRoutes } from './routes/templates.ts';
import { userRoutes } from './routes/users.ts';
import { VERSION } from './version.ts';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function buildApp(ctx: AppContext, options: FastifyServerOptions = {}) {
  const app = Fastify({ bodyLimit: 1024 * 1024, ...options }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, issues: err.issues });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const issues = err.validation.map((v) => ({
        path: v.instancePath.replace(/^\//, '').replaceAll('/', '.'),
        message: v.message ?? 'Invalid value',
      }));
      return reply.code(400).send({ error: 'bad_request', message: 'Some values are not valid.', issues });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong on the server.' });
  });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/') && !req.url.startsWith('/api/auth/') && !req.url.startsWith('/api/health')) {
      req.user = await loadSessionUser(ctx.auth, req);
    }
  });

  await app.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  await app.register(fastifySwagger, {
    openapi: { info: { title: 'Precious API', version: VERSION } },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/api/docs' });

  await app.register(healthRoutes, ctx);
  await app.register(authRoutes, ctx);
  await app.register(userRoutes, ctx);
  await app.register(templateRoutes, ctx);
  await app.register(collectionRoutes, ctx);
  await app.register(itemRoutes, ctx);
  await app.register(imageRoutes, ctx);
  await app.register(searchRoutes, ctx);
  await app.register(publicRoutes, ctx);

  const webDist = ctx.config.WEB_DIST_DIR ? resolve(ctx.config.WEB_DIST_DIR) : undefined;
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    // Client-side routes: anything that isn't an API or media path gets the app shell.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/media/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found', message: 'Not found.' });
    });
  }

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
