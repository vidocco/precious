import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/db', APP_SECRET: 'x'.repeat(32) });
    expect(config).toMatchObject({ PORT: 3000, HOST: '0.0.0.0', LOG_LEVEL: 'info' });
  });

  it('explains what is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/db', APP_SECRET: 'short' })).toThrow(
      /APP_SECRET/,
    );
  });
});
