import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { type App, buildApp } from '../src/app.ts';
import { createAuth } from '../src/auth/auth.ts';
import { type Config, loadConfig } from '../src/config.ts';
import { createRuntime } from '../src/connectors/runner.ts';
import { createDb, type Database } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStarterTemplates } from '../src/db/seed.ts';

export const TEST_DATABASE_URL = process.env.DATABASE_URL;

export interface TestServer {
  app: App;
  database: Database;
  config: Config;
  close: () => Promise<void>;
}

/**
 * Starts the app against a brand-new database (created from DATABASE_URL's server,
 * migrated and seeded) and a temporary upload folder. Everything is removed on close.
 */
export async function startTestServer(): Promise<TestServer> {
  if (!TEST_DATABASE_URL) throw new Error('DATABASE_URL is required for integration tests');
  const name = `precious_test_${randomBytes(5).toString('hex')}`;
  const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  const uploadDir = await mkdtemp(join(tmpdir(), 'precious-uploads-'));

  const config = loadConfig({
    DATABASE_URL: url.toString(),
    APP_SECRET: 'test-secret-test-secret-test-secret-0000',
    PUBLIC_URL: 'http://localhost:3000',
    UPLOAD_DIR: uploadDir,
    MIGRATIONS_DIR: resolve(import.meta.dirname, '../drizzle'),
    RECIPES_DIR: resolve(import.meta.dirname, '../../../recipes'),
    LOG_LEVEL: 'silent',
  });
  const database = createDb(config.DATABASE_URL);
  await runMigrations(database, config.MIGRATIONS_DIR);
  await seedStarterTemplates(database.db);
  const auth = createAuth(database.db, config);
  const connectors = createRuntime(database.db, config.APP_SECRET);
  const app = await buildApp({ config, database, auth, connectors }, { logger: false });
  await app.ready();

  return {
    app,
    database,
    config,
    async close() {
      await app.close();
      await database.close();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
      await rm(uploadDir, { recursive: true, force: true });
    },
  };
}

/** A signed-in client: keeps the session cookie and sends JSON. */
export class Client {
  cookie = '';
  readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  async request<T = unknown>(method: string, url: string, body?: unknown) {
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      headers: {
        ...(this.cookie && { cookie: this.cookie }),
        origin: 'http://localhost:3000',
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { payload: JSON.stringify(body) }),
    });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const list = Array.isArray(setCookie) ? setCookie : [setCookie];
      this.cookie = list.map((c) => c.split(';')[0]).join('; ');
    }
    const json = res.body ? safeJson(res.body) : undefined;
    return { status: res.statusCode, body: json as T, raw: res };
  }

  get = <T = unknown>(url: string) => this.request<T>('GET', url);
  post = <T = unknown>(url: string, body?: unknown) => this.request<T>('POST', url, body ?? {});
  patch = <T = unknown>(url: string, body: unknown) => this.request<T>('PATCH', url, body);
  put = <T = unknown>(url: string, body: unknown) => this.request<T>('PUT', url, body);
  del = <T = unknown>(url: string) => this.request<T>('DELETE', url);

  async signIn(email: string, password: string) {
    const res = await this.post('/api/auth/sign-in/email', { email, password });
    if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
    return this;
  }
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const ADMIN = { name: 'Marta Vidal', email: 'marta@example.com', password: 'correct-horse-battery' };
export const MEMBER = { name: 'Juan Pérez', email: 'juan@example.com', password: 'another-long-password' };

/** Runs first-run setup and returns signed-in clients for an admin and a member. */
export async function setupHousehold(app: App) {
  const anon = new Client(app);
  const setup = await anon.post('/api/setup', ADMIN);
  if (setup.status !== 201) throw new Error(`setup failed: ${setup.status} ${JSON.stringify(setup.body)}`);
  const admin = await new Client(app).signIn(ADMIN.email, ADMIN.password);
  const created = await admin.post('/api/users', { ...MEMBER, role: 'member' });
  if (created.status !== 201) throw new Error(`create user failed: ${JSON.stringify(created.body)}`);
  const member = await new Client(app).signIn(MEMBER.email, MEMBER.password);
  return { anon, admin, member };
}
