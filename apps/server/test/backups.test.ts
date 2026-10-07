import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BackupStatus, pgEnv } from '../src/services/backups.ts';
import { type Client, setupHousehold, startTestServer, TEST_DATABASE_URL, type TestServer } from './harness.ts';

describe('pgEnv', () => {
  it('turns a database address into libpq settings', () => {
    expect(pgEnv('postgres://precious:p%40ss@db.lan:5433/collections?sslmode=require')).toEqual({
      PGHOST: 'db.lan',
      PGPORT: '5433',
      PGDATABASE: 'collections',
      PGUSER: 'precious',
      PGPASSWORD: 'p@ss',
      PGSSLMODE: 'require',
    });
  });
});

describe.runIf(TEST_DATABASE_URL)('backups', () => {
  let server: TestServer;
  let admin: Client;
  let member: Client;
  const dir = mkdtempSync(join(tmpdir(), 'precious-backups-'));
  const bin = mkdtempSync(join(tmpdir(), 'precious-bin-'));
  const fake = join(bin, 'pg_dump');

  beforeAll(async () => {
    // Stands in for pg_dump: writes what it was asked to back up, or fails when told to.
    writeFileSync(
      fake,
      `#!/bin/sh
if [ -f "${bin}/fail" ]; then echo "pg_dump: error: connection refused" >&2; exit 1; fi
for a in "$@"; do case "$a" in --file=*) f="\${a#--file=}";; esac; done
echo "dump of $PGDATABASE on $PGHOST as $PGUSER" > "$f"
`,
    );
    chmodSync(fake, 0o755);
    server = await startTestServer({ BACKUP_DIR: dir, PG_DUMP: fake, BACKUP_KEEP: '2' });
    ({ admin, member } = await setupHousehold(server.app));
  });
  afterAll(async () => {
    await server?.close();
  });

  it('is for admins only', async () => {
    expect((await member.get('/api/server/backups')).status).toBe(403);
    expect((await member.post('/api/server/backups')).status).toBe(403);
  });

  it('backs up now, keeps only the newest ones, and downloads them', async () => {
    const first = await admin.post<BackupStatus>('/api/server/backups');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ enabled: true, keep: 2, at: '03:30', last: { ok: true } });
    const name = first.body.backups[0]?.name as string;
    expect(name).toMatch(/^precious-\d{4}-\d{2}-\d{2}-\d{4}\.dump$/);
    const db = new URL(server.config.DATABASE_URL);
    expect(readFileSync(join(dir, name), 'utf8')).toBe(
      `dump of ${db.pathname.slice(1)} on ${db.hostname} as ${db.username}\n`,
    );

    await admin.post('/api/server/backups');
    const third = await admin.post<BackupStatus>('/api/server/backups');
    expect(third.body.backups).toHaveLength(2);
    expect(readdirSync(dir).filter((n) => n.endsWith('.dump'))).toHaveLength(2);

    const download = await admin.app.inject({
      method: 'GET',
      url: `/api/server/backups/${third.body.backups[0]?.name}`,
      headers: { cookie: admin.cookie },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toMatch(/^attachment; filename="precious-/);
    expect(download.body).toMatch(/^dump of /);
    expect((await admin.get('/api/server/backups/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
    expect((await admin.get('/api/server/backups/precious-2001-01-01-0000.dump')).status).toBe(404);
  });

  it('reports a failed backup and leaves no half-written file', async () => {
    writeFileSync(join(bin, 'fail'), '');
    const res = await admin.post<{ message: string }>('/api/server/backups');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('The backup failed: pg_dump: error: connection refused');
    expect(readdirSync(dir).filter((n) => n.includes('partial'))).toEqual([]);
    expect((await admin.get<BackupStatus>('/api/server/backups')).body.last).toMatchObject({ ok: false });
  });
});
