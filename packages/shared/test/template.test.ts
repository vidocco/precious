import { describe, expect, it } from 'vitest';
import {
  diffTemplateFields,
  type FieldDefinition,
  fieldSchema,
  isCompatibleTypeChange,
  makeFieldId,
  STARTER_TEMPLATES,
  templateInputSchema,
} from '../src/index.ts';

describe('templateInputSchema', () => {
  it('accepts every starter template', () => {
    for (const t of STARTER_TEMPLATES) {
      const result = templateInputSchema.safeParse(t);
      expect(result.success, `${t.name}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('rejects layouts that reference unknown fields', () => {
    const result = templateInputSchema.safeParse({
      name: 'Broken',
      fields: [{ id: 'author', label: 'Author', type: 'text' }],
      card: { lines: [{ fields: ['$title', 'publisher'] }] },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('publisher');
  });

  it('rejects duplicate field ids and choice fields without choices', () => {
    const result = templateInputSchema.safeParse({
      name: 'Dupes',
      fields: [
        { id: 'a', label: 'A', type: 'text' },
        { id: 'a', label: 'A again', type: 'choice' },
      ],
    });
    const messages = result.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain('Duplicate field id "a"');
    expect(messages).toContain('Add at least one choice');
  });

  it('only sums numeric fields', () => {
    const result = templateInputSchema.safeParse({
      name: 'Sums',
      fields: [{ id: 'author', label: 'Author', type: 'text' }],
      header: { figures: [{ id: 's', kind: 'sum', label: 'Total', field: 'author' }] },
    });
    expect(result.error?.issues[0]?.message).toContain("can't be summed");
  });
});

describe('field changes', () => {
  const f = (type: FieldDefinition['type'], id = 'x'): FieldDefinition =>
    fieldSchema.parse({ id, label: id.toUpperCase(), type, options: type === 'choice' ? { choices: ['a'] } : {} });

  it('allows compatible type changes only', () => {
    expect(isCompatibleTypeChange('text', 'longtext')).toBe(true);
    expect(isCompatibleTypeChange('number', 'money')).toBe(true);
    expect(isCompatibleTypeChange('text', 'number')).toBe(false);
    expect(isCompatibleTypeChange('date', 'boolean')).toBe(false);
  });

  it('reports removed fields and incompatible changes', () => {
    const problems = diffTemplateFields([f('text', 'a'), f('number', 'b')], [f('date', 'a')]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("can't change from text to date");
    expect(problems[1]).toContain('was removed');
  });

  it('makes readable, unique field ids', () => {
    expect(makeFieldId('Año de compra', [])).toBe('ano_de_compra');
    expect(makeFieldId('Notes', ['notes'])).toBe('notes_2');
    expect(makeFieldId('123', [])).toBe('field');
  });
});
