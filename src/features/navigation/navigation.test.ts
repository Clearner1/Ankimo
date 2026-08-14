import { describe, expect, it } from 'vitest';
import { completeTagValue, tagSuggestions } from './TagInput';
import { filterTagPaths } from './TagTree';
import { parsePinnedTags } from './pinnedTags';

describe('navigation pure helpers', () => {
  it('keeps full paths while filtering tags case-insensitively', () => {
    expect(filterTagPaths(['topic::Anki', 'topic::notes', 'plain'], 'anki')).toEqual(['topic::Anki']);
  });

  it('reads pinned tags from either config shape and ignores invalid entries', () => {
    expect(parsePinnedTags('{"pinnedTags":["topic", 3]}')).toEqual(['topic']);
    expect(parsePinnedTags('["notes", false]')).toEqual(['notes']);
    expect(parsePinnedTags('not json')).toEqual([]);
  });

  it('fuzzy-completes the current tag and skips tags already selected', () => {
    const tags = ['topic::Anki', '学习::方法', '其他::学习'];
    expect(tagSuggestions(tags, 'anki')).toEqual(['topic::Anki']);
    expect(tagSuggestions(tags, '学习::方法 学')).toEqual(['其他::学习']);
    expect(completeTagValue('topic::Anki 学', '学习::方法')).toBe('topic::Anki 学习::方法 ');
  });
});
