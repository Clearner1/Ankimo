import { describe, expect, it } from 'vitest';
import { shouldCollapseMemo } from './NoteCard';

describe('shouldCollapseMemo', () => {
  it('counts rendered text rather than html tags', () => {
    expect(shouldCollapseMemo('<p>short</p>', 5)).toBe(true);
    expect(shouldCollapseMemo('<p>short</p>', 6)).toBe(false);
  });
});
