import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { mustUser } from '../auth/guard.ts';
import type { AppContext } from '../context.ts';
import { images } from '../db/schema.ts';
import { badRequest, notFound } from '../errors.ts';
import { IMAGE_SIZES, type ImageSize, imagePath, storeImage } from '../services/images.ts';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif'];

export const imageRoutes: FastifyPluginAsyncZod<AppContext> = async (app, ctx) => {
  const { db } = ctx.database;

  app.post('/api/images', { schema: { tags: ['images'], consumes: ['multipart/form-data'] } }, async (req, reply) => {
    const viewer = mustUser(req);
    const file = await req.file();
    if (!file) throw badRequest('Choose an image to upload.');
    if (!ACCEPTED.includes(file.mimetype)) throw badRequest('Upload a JPEG, PNG, WebP, GIF, AVIF or HEIC image.');
    const buffer = await file.toBuffer();
    if (file.file.truncated) throw badRequest('That image is larger than 15 MB.');
    const id = randomUUID();
    let stored: Awaited<ReturnType<typeof storeImage>>;
    try {
      stored = await storeImage(ctx.config.UPLOAD_DIR, id, buffer);
    } catch {
      throw badRequest("That file couldn't be read as an image.");
    }
    await db.insert(images).values({ id, ownerId: viewer.id, mime: 'image/webp', bytes: buffer.length, ...stored });
    return reply.code(201).send({ id, ...stored });
  });

  // Image ids are random UUIDs, so they are served without a session (covers on public links need it too).
  app.get(
    '/media/:id/:size',
    {
      schema: {
        hide: true,
        params: z.object({ id: z.string().uuid(), size: z.enum(Object.keys(IMAGE_SIZES) as [ImageSize]) }),
      },
    },
    async (req, reply) => {
      const path = imagePath(ctx.config.UPLOAD_DIR, req.params.id, req.params.size);
      if (!existsSync(path)) {
        const [row] = await db.select({ id: images.id }).from(images).where(eq(images.id, req.params.id));
        throw notFound(row ? 'Image file' : 'Image');
      }
      return reply
        .header('content-type', 'image/webp')
        .header('cache-control', 'public, max-age=31536000, immutable')
        .send(createReadStream(path));
    },
  );
};
