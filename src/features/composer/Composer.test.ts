import { describe, expect, it } from 'vitest';
import { buildComposerFields } from './Composer';

describe('buildComposerFields', () => {
  it('maps only the first two model fields for QA and clears the rest', () => {
    expect(buildComposerFields(['Front', 'Back', 'Extra'], 'question', 'answer', 'qa')).toEqual({
      Front: 'question', Back: 'answer', Extra: ''
    });
    expect(buildComposerFields(['Text', 'Back'], 'memo', 'ignored', 'memo')).toEqual({ Text: 'memo', Back: '' });
  });
});
