/**
 * Starts the production build against a brand-new database for end-to-end tests.
 * Uses DATABASE_URL's server; the database itself is recreated on every run.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import postgres from 'postgres';

const base = process.env.DATABASE_URL ?? 'postgres://precious:precious@localhost:5432/precious';
const name = 'precious_e2e';
const admin = postgres(base, { max: 1, onnotice: () => {} });
await admin.unsafe(`drop database if exists ${name} with (force)`);
await admin.unsafe(`create database ${name}`);
await admin.end();

const url = new URL(base);
url.pathname = `/${name}`;
const port = process.env.E2E_PORT ?? '3400';
Object.assign(process.env, {
  DATABASE_URL: url.toString(),
  PORT: port,
  PUBLIC_URL: `http://localhost:${port}`,
  APP_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-00',
  UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'precious-e2e-')),
  WEB_DIST_DIR: resolve(import.meta.dirname, '../../web/dist'),
  MIGRATIONS_DIR: resolve(import.meta.dirname, '../drizzle'),
  LOG_LEVEL: 'warn',
});
await import('../dist/index.mjs');
