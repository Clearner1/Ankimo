import { describe, expect, it } from 'vitest';
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
});
