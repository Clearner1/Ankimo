import { describe, expect, it } from 'vitest';
import { buildComposerFields, suspendMemoNote } from './Composer';

describe('buildComposerFields', () => {
  it('maps only the first two model fields for QA and clears the rest', () => {
    expect(buildComposerFields(['Front', 'Back', 'Extra'], 'question', 'answer', 'qa')).toEqual({
      Front: 'question', Back: 'answer', Extra: ''
    });
    expect(buildComposerFields(['Text', 'Back'], 'memo', 'ignored', 'memo')).toEqual({ Text: 'memo', Back: '' });
  });
});

describe('suspendMemoNote', () => {
  it('suspends every generated card and verifies the result', async () => {
    const suspended: number[][] = [];
    const client = {
      findCards: async () => [10, 11],
      suspend: async (cards: number[]) => { suspended.push(cards); return null; },
      areSuspended: async () => [true, true]
    };

    await suspendMemoNote(client, 7);
    expect(suspended).toEqual([[10, 11]]);

    await expect(suspendMemoNote({ ...client, areSuspended: async () => [true, false] }, 7))
      .rejects.toThrow('并非所有卡片都已暂停');
  });
});
