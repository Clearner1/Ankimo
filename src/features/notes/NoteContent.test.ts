import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './NoteContent';

describe('sanitizeHtml', () => {
  it('keeps ordinary Anki markup while removing scripts and event handlers', () => {
    expect(sanitizeHtml('<p onclick="alert(1)">ok</p><script>alert(2)</script><img onerror=bad>')).toBe('<p>ok</p><img>');
  });
});
