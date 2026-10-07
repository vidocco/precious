import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const serverRoot = resolve(import.meta.dirname, '..');

const configSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Signs sessions and encrypts stored secrets. Keep it stable: changing it signs everyone out. */
  APP_SECRET: z.string().min(32, 'Use at least 32 random characters (e.g. openssl rand -hex 32)'),
  /** The address people open Precious at, e.g. http://tower.local:8080. */
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  UPLOAD_DIR: z.string().default(resolve(serverRoot, '../../data/uploads')),
  MIGRATIONS_DIR: z.string().default(resolve(serverRoot, 'drizzle')),
  /** Bundled data source recipes offered as presets. */
  RECIPES_DIR: z.string().default(resolve(serverRoot, '../../recipes')),
  /** Built web app to serve. Empty in development, where Vite serves it. */
  WEB_DIST_DIR: z.string().optional(),
  /** Where nightly database backups go. Unset turns them off (the Docker image sets /data/backups). */
  BACKUP_DIR: z.string().optional(),
  /** How many backups to keep. */
  BACKUP_KEEP: z.coerce.number().int().min(1).max(365).default(14),
  /** When the nightly backup runs, in the server's time zone. */
  BACKUP_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 03:30')
    .default('03:30'),
  PG_DUMP: z.string().default('pg_dump'),
  /** Behind a reverse proxy: take visitors' addresses from X-Forwarded-For. */
  TRUST_PROXY: z
    .enum(['true', 'false', '1', '0', ''])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
