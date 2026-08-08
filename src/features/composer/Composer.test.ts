import { describe, expect, it } from 'vitest';
import {
  availableOption,
  buildComposerFields,
  appendMemoImages,
  base64FromDataUrl,
  createMediaFilename,
  imageExtensionForType,
  loadComposerPreferences,
  MEMO_MODEL,
  MAX_COMPOSER_IMAGE_SIZE,
  QA_MODEL,
  saveComposerPreference,
  suspendMemoNote,
  validateImageFile,
  writeComposerNote,
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

describe('composer image helpers', () => {
  it('accepts supported images, extracts base64, and builds Anki media HTML', () => {
    expect(imageExtensionForType('image/png')).toBe('png');
    expect(imageExtensionForType('image/jpeg')).toBe('jpg');
    expect(imageExtensionForType('image/webp')).toBe('webp');
    expect(imageExtensionForType('image/gif')).toBeNull();
    expect(validateImageFile({ type: 'image/png', size: MAX_COMPOSER_IMAGE_SIZE })).toBeNull();
    expect(validateImageFile({ type: 'image/png', size: MAX_COMPOSER_IMAGE_SIZE + 1 })).toContain('10MB');
    expect(validateImageFile({ type: 'image/gif', size: 1 })).toContain('PNG');
    expect(base64FromDataUrl('data:image/png;base64,abc123')).toBe('abc123');
    expect(createMediaFilename('jpg', 'test-uuid')).toBe('ankimo-test-uuid.jpg');
    expect(appendMemoImages('想法', ['ankimo-one.png', 'ankimo-two.webp']))
      .toBe('想法\n\n<img src="ankimo-one.png" alt="" />\n\n<img src="ankimo-two.webp" alt="" />');
    expect(appendMemoImages('', ['ankimo-one.png'])).toBe('<img src="ankimo-one.png" alt="" />');
  });

  it('cleans partial uploads but preserves media when the note write status is unknown', async () => {
    const deleted: string[] = [];
    let uploads = 0;
    let addNoteCalls = 0;
    const baseInput = {
      deck: 'Ankimo',
      model: MEMO_MODEL,
      fieldNames: ['引用'],
      front: '',
      back: '',
      mode: 'memo' as const,
      tags: [],
      images: [
        { name: 'one.png', extension: 'png' as const, dataUrl: 'data:image/png;base64,b25l' },
        { name: 'two.png', extension: 'png' as const, dataUrl: 'data:image/png;base64,dHdv' }
      ]
    };
    const partialUpload = await writeComposerNote({
      storeMediaFileBase64: async filename => ++uploads === 1 ? filename : false,
      deleteMediaFile: async filename => { deleted.push(filename); return null; },
      addNote: async () => { addNoteCalls++; return 7; }
    }, baseInput);
    expect(partialUpload).toMatchObject({ error: expect.stringContaining('图片上传失败') });
    expect(deleted).toHaveLength(2);
    expect(addNoteCalls).toBe(0);

    deleted.length = 0;
    const unknownWrite = await writeComposerNote({
      storeMediaFileBase64: async filename => filename,
      deleteMediaFile: async filename => { deleted.push(filename); return null; },
      addNote: async () => { throw new Error('network lost'); }
    }, { ...baseInput, images: baseInput.images.slice(0, 1) });
    expect(unknownWrite).toMatchObject({ error: expect.stringContaining('写入状态未知') });
    expect(deleted).toEqual([]);
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
