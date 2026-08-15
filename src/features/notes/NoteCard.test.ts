import { describe, expect, it } from 'vitest';
import { shouldCollapseMemo } from './NoteCard';

describe('shouldCollapseMemo', () => {
  it('collapses only when rendered text is longer than the limit', () => {
    expect(shouldCollapseMemo('<p>four</p>', 3)).toBe(true);
    expect(shouldCollapseMemo('<p>short</p>', 5)).toBe(false);
  });
});
