import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { type BackupFile, type BackupStatus, nextRun } from '@precious/shared';

export type { BackupStatus };

/**
 * Nightly database backups with pg_dump, kept in BACKUP_DIR (the Docker image uses
 * /data/backups). Only the newest BACKUP_KEEP files are kept. A backup is one file
 * that pg_restore puts back; see the README.
 */

export interface BackupSettings {
  dir: string;
  keep: number;
  /** Local time of the nightly backup, e.g. 03:30. */
  at: string;
  databaseUrl: string;
  pgDump: string;
}

export const BACKUP_NAME = /^precious-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.dump$/;

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

export async function listBackups(dir: string): Promise<BackupFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files = await Promise.all(
    names
      .filter((n) => BACKUP_NAME.test(n))
      .map(async (name) => {
        const s = await stat(join(dir, name));
        return { name, bytes: s.size, createdAt: s.mtime.toISOString() };
      }),
  );
  return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

/** Deletes all but the newest `keep` backups. */
export async function pruneBackups(dir: string, keep: number): Promise<string[]> {
  const old = (await listBackups(dir)).slice(keep);
  for (const f of old) await rm(join(dir, f.name), { force: true });
  return old.map((f) => f.name);
}

/** libpq's environment variables for a postgres:// address. */
export function pgEnv(databaseUrl: string): Record<string, string> {
  const u = new URL(databaseUrl);
  const env: Record<string, string> = {
    PGHOST: u.searchParams.get('host') ?? decodeURIComponent(u.hostname),
    PGPORT: u.port || '5432',
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
  if (u.username) env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const ssl = u.searchParams.get('sslmode');
  if (ssl) env.PGSSLMODE = ssl;
  return env;
}

function dump(s: BackupSettings, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // The connection goes in the environment, so its password never shows in process lists.
    const child = spawn(s.pgDump, ['--format=custom', '--no-owner', '--no-privileges', `--file=${file}`], {
      env: { ...process.env, ...pgEnv(s.databaseUrl) },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.on('error', (err) => reject(new Error(`pg_dump couldn't be started: ${err.message}`)));
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim().split('\n').at(-1) || `pg_dump exited with ${code}`)),
    );
  });
}

export class Backups {
  readonly settings: BackupSettings;
  readonly onError: (err: unknown) => void;
  last: BackupStatus['last'] = null;
  nextAt: Date | null = null;
  timer: ReturnType<typeof setTimeout> | undefined;
  running: Promise<BackupFile> | null = null;

  constructor(settings: BackupSettings, onError: (err: unknown) => void = () => {}) {
    this.settings = settings;
    this.onError = onError;
  }

  /** Makes a backup now (or joins the one already running). */
  run(): Promise<BackupFile> {
    this.running ??= this.make().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async make(): Promise<BackupFile> {
    const { dir, keep } = this.settings;
    const now = new Date();
    try {
      await mkdir(dir, { recursive: true });
      let name = `precious-${stamp(now)}.dump`;
      for (let n = 2; (await listBackups(dir)).some((f) => f.name === name); n++)
        name = `precious-${stamp(now)}-${n}.dump`;
      // Written under a temporary name first, so a half-written file never looks like a backup.
      const tmp = join(dir, `.${name}.partial`);
      try {
        await dump(this.settings, tmp);
        await rename(tmp, join(dir, name));
      } finally {
        await rm(tmp, { force: true });
      }
      await pruneBackups(dir, keep);
      const s = await stat(join(dir, name));
      this.last = { at: now.toISOString(), ok: true };
      return { name, bytes: s.size, createdAt: s.mtime.toISOString() };
    } catch (err) {
      this.last = { at: now.toISOString(), ok: false, message: (err as Error).message };
      throw err;
    }
  }

  /** Backs up every night at the set time. */
  start() {
    const schedule = () => {
      this.nextAt = nextRun({ every: 'day', at: this.settings.at }, new Date());
      this.timer = setTimeout(
        () => {
          this.run()
            .catch((err) => this.onError(err))
            .finally(schedule);
        },
        Math.max(1000, this.nextAt.getTime() - Date.now()),
      );
      this.timer.unref();
    };
    schedule();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  async status(): Promise<BackupStatus> {
    return {
      enabled: true,
      keep: this.settings.keep,
      at: this.settings.at,
      nextRunAt: this.nextAt?.toISOString() ?? null,
      last: this.last,
      backups: await listBackups(this.settings.dir),
    };
  }

  file(name: string) {
    if (!BACKUP_NAME.test(name)) return null;
    return createReadStream(join(this.settings.dir, name));
  }
}

/** Backups as configured, or null when BACKUP_DIR isn't set. */
export function backupsFrom(
  config: { BACKUP_DIR?: string; BACKUP_KEEP: number; BACKUP_TIME: string; DATABASE_URL: string; PG_DUMP: string },
  onError?: (err: unknown) => void,
): Backups | null {
  if (!config.BACKUP_DIR) return null;
  return new Backups(
    {
      dir: config.BACKUP_DIR,
      keep: config.BACKUP_KEEP,
      at: config.BACKUP_TIME,
      databaseUrl: config.DATABASE_URL,
      pgDump: config.PG_DUMP,
    },
    onError,
  );
}
