import { describe, expect, it } from 'vitest';
import { formatFigure, splitSnippet } from '../src/lib/format.ts';

describe('formatFigure', () => {
  it('formats money, durations and counts', () => {
    expect(formatFigure({ id: 'v', label: 'Value', value: 4318.6, format: 'money', currency: 'EUR' })).toBe(
      '€4,318.60',
    );
    expect(formatFigure({ id: 'd', label: 'Time', value: 1410, format: 'duration' })).toBe('23½ h');
    expect(formatFigure({ id: 'c', label: 'Items', value: 1420, format: 'count' })).toBe('1,420');
    expect(formatFigure({ id: 'x', label: 'Avg', value: null, format: 'number' })).toBe('–');
  });
});

describe('splitSnippet', () => {
  it('splits highlighted parts', () => {
    expect(splitSnippet('…the «lantern» pin')).toEqual([
      { text: '…the ', mark: false },
      { text: 'lantern', mark: true },
      { text: ' pin', mark: false },
    ]);
  });
});
