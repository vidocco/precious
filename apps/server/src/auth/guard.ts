import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import { HttpError } from '../errors.ts';
import type { Auth, SessionUser } from './auth.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export async function loadSessionUser(auth: Auth, req: FastifyRequest): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: string };
  return { id: u.id, name: u.name, email: u.email, role: u.role === 'admin' ? 'admin' : 'member' };
}

export function mustUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
  return req.user;
}

export function mustAdmin(req: FastifyRequest): SessionUser {
  const user = mustUser(req);
  if (user.role !== 'admin') throw new HttpError(403, 'forbidden', 'Only admins can do this.');
  return user;
}
