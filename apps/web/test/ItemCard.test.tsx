// @vitest-environment jsdom
import { type CardLayout, DEFAULT_COVER, type FieldDefinition, fieldSchema, type ItemDto } from '@precious/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ItemCard } from '../src/components/ItemCard.tsx';

afterEach(cleanup);

const fields: FieldDefinition[] = [
  { id: 'author', label: 'Author', type: 'text' },
  { id: 'publisher', label: 'Publisher', type: 'text' },
  { id: 'language', label: 'Language', type: 'choice', options: { choices: ['ES', 'EN'] } },
  { id: 'year_bought', label: 'Year bought', type: 'number' },
].map((f) => fieldSchema.parse(f));

const item: ItemDto = {
  id: 'i1',
  collectionId: 'c1',
  accessionNo: 7,
  accession: 'BK·0007',
  title: 'Las horas pequeñas',
  cover: null,
  data: { author: 'Itziar Arrieta', publisher: 'Ediciones Faro', language: 'ES', year_bought: 2024 },
  fieldMeta: {},
  externalRefs: {},
  createdBy: null,
  createdByName: null,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
};

describe('ItemCard', () => {
  it('puts the template’s fields on and under the cover', () => {
    const card: CardLayout = {
      cover: DEFAULT_COVER,
      slots: { tl: 'language', tr: 'publisher', b: 'author' },
      lines: [
        { fields: ['$title'], style: 'title' },
        { fields: ['author', 'year_bought'], style: 'muted', prefix: 'By ' },
      ],
    };
    render(<ItemCard item={item} card={card} fields={fields} to={null} />);
    expect(screen.getByText('ES')).toBeTruthy();
    expect(screen.getByText('Ediciones Faro')).toBeTruthy();
    expect(screen.getByText('Itziar Arrieta')).toBeTruthy();
    expect(screen.getByText('By Itziar Arrieta · 2024')).toBeTruthy();
    expect(screen.getAllByText('Las horas pequeñas').length).toBeGreaterThan(0);
  });

  it('skips empty slots and lines', () => {
    const card: CardLayout = {
      cover: DEFAULT_COVER,
      slots: { tl: null, tr: '$accession', b: null },
      lines: [
        { fields: ['$title'], style: 'title' },
        { fields: ['publisher'], style: 'normal' },
      ],
    };
    const bare = { ...item, data: {} };
    const { container } = render(<ItemCard item={bare} card={card} fields={fields} to={null} />);
    expect(screen.getByText('BK·0007')).toBeTruthy();
    expect(screen.queryByText('Ediciones Faro')).toBeNull();
    expect(container.querySelectorAll('.grid.min-w-0.gap-px > span')).toHaveLength(1);
  });

  it('shows why a search matched, with the hit highlighted', () => {
    const card: CardLayout = {
      cover: DEFAULT_COVER,
      slots: { tl: null, tr: null, b: null },
      lines: [{ fields: ['$title'], style: 'title' }],
    };
    render(
      <ItemCard
        item={item}
        card={card}
        fields={fields}
        to={null}
        match={{ label: 'Publisher', snippet: 'Ediciones «Faro»' }}
      />,
    );
    expect(screen.getByText('Faro').tagName).toBe('MARK');
  });
});
