import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '../src/index.ts';

describe('healthResponseSchema', () => {
  it('accepts a healthy response', () => {
    const parsed = healthResponseSchema.parse({ status: 'ok', version: '0.0.0', database: 'up' });
    expect(parsed.database).toBe('up');
  });

  it('rejects an unknown status', () => {
    expect(healthResponseSchema.safeParse({ status: 'meh', version: '0.0.0', database: 'up' }).success).toBe(false);
  });
});
