import { describe, expect, it } from 'vitest';
import {
  availableOption,
  buildComposerFields,
  loadComposerPreferences,
  MEMO_MODEL,
  QA_MODEL,
  saveComposerPreference,
  suspendMemoNote,
  type ComposerPreferences
} from './Composer';

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    value: () => value
  };
}

describe('composer preferences', () => {
  it('uses defaults for empty or invalid storage', () => {
    const defaults = {
      memo: { model: MEMO_MODEL, tags: '' },
      qa: { deck: '', model: QA_MODEL, tags: '' }
    };
    const blockedStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); }
    };
    expect(loadComposerPreferences(memoryStorage())).toEqual(defaults);
    expect(loadComposerPreferences(memoryStorage('not json'))).toEqual(defaults);
    expect(loadComposerPreferences(blockedStorage)).toEqual(defaults);
    expect(() => saveComposerPreference('memo', defaults, blockedStorage)).not.toThrow();
  });

  it('persists only the successfully used mode', () => {
    const storage = memoryStorage(JSON.stringify({
      memo: { model: MEMO_MODEL, tags: 'old-memo' },
      qa: { deck: 'mubu', model: QA_MODEL, tags: 'old-qa' }
    }));
    const current: ComposerPreferences = {
      memo: { model: MEMO_MODEL, tags: 'new-memo' },
      qa: { deck: 'other', model: 'other-model', tags: 'unsaved-qa' }
    };

    saveComposerPreference('memo', current, storage);

    expect(JSON.parse(storage.value() || '')).toEqual({
      memo: { model: MEMO_MODEL, tags: 'new-memo' },
      qa: { deck: 'mubu', model: QA_MODEL, tags: 'old-qa' }
    });
  });

  it('prefers saved, then default, then the first available option', () => {
    expect(availableOption('saved', 'default', ['saved', 'default'])).toBe('saved');
    expect(availableOption('missing', 'default', ['first', 'default'])).toBe('default');
    expect(availableOption('missing', 'default', ['first'])).toBe('first');
  });
});

describe('buildComposerFields', () => {
  it('maps only the first two model fields for QA and clears the rest', () => {
    expect(buildComposerFields(['问题', '答案', '引用'], 'question', 'answer', 'qa')).toEqual({
      问题: 'question', 答案: 'answer', 引用: ''
    });
    expect(buildComposerFields(['引用'], 'memo', 'ignored', 'memo')).toEqual({ 引用: 'memo' });
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
