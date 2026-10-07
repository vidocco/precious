import { describe, expect, it } from 'vitest';
import {
  bindingsSchema,
  coerceToField,
  type FieldDefinition,
  fieldSchema,
  matchScore,
  normalizeTitle,
  STARTER_TEMPLATES,
  suggestFill,
  templateInputSchema,
} from '../src/index.ts';

const f = (x: Partial<FieldDefinition> & Pick<FieldDefinition, 'id' | 'type'>) =>
  fieldSchema.parse({ label: x.id, ...x });

const ID = '6f1c1f0e-3a55-4c47-9d1a-111111111111';
const ID2 = '6f1c1f0e-3a55-4c47-9d1a-222222222222';

describe('matchScore', () => {
  it('ignores case, accents, punctuation and a leading article', () => {
    expect(normalizeTitle('The Legend of Zelda: Breath of the Wild')).toBe('legend of zelda breath of the wild');
    expect(matchScore('Pokémon Red', { title: 'POKEMON red' })).toBe(1);
    expect(matchScore('The Witcher 3', { title: 'Witcher 3' })).toBe(1);
    expect(matchScore('El Quijote', { title: 'Quijote' })).toBe(1);
  });

  it('scores near titles high and different ones low', () => {
    expect(matchScore('Lanterns of Vell', { title: 'Lanterns of Vell: Ember Tide' })).toBeGreaterThan(0.6);
    expect(matchScore('Lanterns of Vell', { title: 'Lanterns of Vell: Ember Tide' })).toBeLessThan(0.85);
    expect(matchScore('Lanterns of Vell', { title: 'Hollow Knight' })).toBeLessThan(0.3);
  });

  it('adds for a matching year and takes away for a distant one', () => {
    const base = matchScore('Dune', { title: 'Dune Messiah' });
    expect(matchScore('Dune', { title: 'Dune Messiah', year: 1969 }, 1969)).toBeCloseTo(base + 0.1, 2);
    expect(matchScore('Dune', { title: 'Dune Messiah', year: '1969-10-15' }, 1965)).toBeCloseTo(base - 0.2, 2);
    expect(matchScore('Dune', { title: 'Dune', year: 1966 }, 1965)).toBe(1);
    expect(matchScore('Dune', { title: 'Dune', year: 1984 }, '1965-08-01')).toBe(0.8);
  });
});

describe('coerceToField', () => {
  it('converts numbers, durations and ratings', () => {
    expect(coerceToField(f({ id: 'n', type: 'number' }), '2019')).toEqual({ ok: true, value: 2019 });
    expect(coerceToField(f({ id: 'n', type: 'number' }), '12,5')).toEqual({ ok: true, value: 12.5 });
    expect(coerceToField(f({ id: 'n', type: 'money' }), '1 299.90')).toEqual({ ok: true, value: 1299.9 });
    expect(coerceToField(f({ id: 'n', type: 'number', options: { min: 0 } }), -3).ok).toBe(false);
    expect(coerceToField(f({ id: 'n', type: 'number' }), 'many').ok).toBe(false);
    expect(coerceToField(f({ id: 'd', type: 'duration' }), 1410.4)).toEqual({ ok: true, value: 1410 });
    expect(coerceToField(f({ id: 'r', type: 'rating' }), 4.4)).toEqual({ ok: true, value: 4 });
    expect(coerceToField(f({ id: 'r', type: 'rating' }), 87).ok).toBe(false);
  });

  it('converts dates from ISO text, years and Unix time', () => {
    const date = f({ id: 'd', type: 'date' });
    expect(coerceToField(date, '2019-03-07T00:00:00Z')).toEqual({ ok: true, value: '2019-03-07' });
    expect(coerceToField(date, 1998)).toEqual({ ok: true, value: '1998-01-01' });
    expect(coerceToField(date, '1998')).toEqual({ ok: true, value: '1998-01-01' });
    expect(coerceToField(date, 1551916800)).toEqual({ ok: true, value: '2019-03-07' });
    expect(coerceToField(date, 'March 7, 2019')).toEqual({ ok: true, value: '2019-03-07' });
    expect(coerceToField(date, 'someday').ok).toBe(false);
  });

  it('matches choices without caring about case', () => {
    const choice = f({ id: 'c', type: 'choice', options: { choices: ['Switch', 'PS5'] } });
    expect(coerceToField(choice, 'switch')).toEqual({ ok: true, value: 'Switch' });
    expect(coerceToField(choice, 'Xbox')).toMatchObject({ ok: false });
    const multi = f({ id: 'm', type: 'multichoice', options: { choices: ['Switch', 'PS5'] } });
    expect(coerceToField(multi, ['ps5', 'Xbox'])).toMatchObject({ ok: true, value: ['PS5'], note: expect.any(String) });
    expect(coerceToField(multi, 'Switch, PS5')).toEqual({ ok: true, value: ['Switch', 'PS5'] });
  });

  it('handles text, links, tags, booleans and empty values', () => {
    expect(coerceToField(f({ id: 't', type: 'text' }), 42)).toEqual({ ok: true, value: '42' });
    expect(coerceToField(f({ id: 't', type: 'text' }), ['Nintendo', 'Monolith'])).toEqual({
      ok: true,
      value: 'Nintendo, Monolith',
    });
    expect(coerceToField(f({ id: 't', type: 'text' }), { a: 1 }).ok).toBe(false);
    expect(coerceToField(f({ id: 'u', type: 'url' }), 'ftp://x').ok).toBe(false);
    expect(coerceToField(f({ id: 'g', type: 'tags' }), ['RPG', 'RPG', 'Action'])).toEqual({
      ok: true,
      value: ['RPG', 'Action'],
    });
    expect(coerceToField(f({ id: 'b', type: 'boolean' }), 'yes')).toEqual({ ok: true, value: true });
    expect(coerceToField(f({ id: 't', type: 'text' }), '')).toEqual({ ok: true, value: undefined });
    expect(coerceToField(f({ id: 't', type: 'tags' }), [])).toEqual({ ok: true, value: undefined });
    expect(coerceToField(f({ id: 'p', type: 'person' }), 'Marta').ok).toBe(false);
  });
});

describe('suggestFill', () => {
  const fields = [
    f({ id: 'release_year', label: 'Release year', type: 'number' }),
    f({ id: 'developer', label: 'Developer', type: 'text' }),
    f({ id: 'platform', label: 'Platform', type: 'text' }),
    f({ id: 'platform_family', label: 'Platform family', type: 'text' }),
  ];
  it('maps by name and label, and only when sure', () => {
    expect(suggestFill(['id', 'title', 'image', 'year', 'developer', 'subtitle', 'platform'], fields)).toEqual({
      $title: 'title',
      $cover: 'image',
      release_year: 'year',
      developer: 'developer',
      platform: 'platform',
    });
    expect(suggestFill(['name', 'coverUrl', 'family'], fields)).toEqual({
      $title: 'name',
      $cover: 'coverUrl',
      platform_family: 'family',
    });
  });
});

describe('bindings', () => {
  it('rejects repeated ids and matches without a ref', () => {
    const r = bindingsSchema.safeParse({
      search: [{ id: 'igdb', endpointId: ID, ref: 'igdb' }],
      steps: [{ id: 'igdb', endpointId: ID2, match: { endpointId: ID } }],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toEqual(['steps.0.id', 'steps.0.ref']);
  });

  it('checks fill targets against the template', () => {
    const books = STARTER_TEMPLATES.find((t) => t.name === 'Books');
    const r = templateInputSchema.safeParse({
      ...books,
      bindings: {
        search: [{ id: 'ol', endpointId: ID, ref: 'ol', fill: { $title: 'title', $cover: 'image', nope: 'x' } }],
        steps: [{ id: 'wiki', endpointId: ID2, ref: 'wiki', match: { endpointId: ID, yearField: 'gone' }, fill: {} }],
      },
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toEqual([
      'bindings.search.0.fill.nope',
      'bindings.steps.0.match.yearField',
    ]);
  });
});
