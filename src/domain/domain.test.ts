import { describe, expect, it } from 'vitest';
import { buildTagTree } from './tags';
import { isBlankHtml, noteFieldValue } from './notes';
import { classifyQuery, isCardQuery, parseReviewDateQuery } from './queries';
import { calculateHeatmap, cardIdsInReviewRange, computeReviewStats, reviewDateRange } from './heatmap';

describe('tag tree', () => {
  it('preserves nested Anki tag paths', () => {
    expect(buildTagTree(['topic::anki::api', 'topic::anki::cards', 'topic::notes', 'plain'])).toEqual({
      topic: { _children: {
        anki: { _children: { api: {}, cards: {} } },
        notes: {}
      } },
      plain: {}
    });
  });
});

describe('review dates and heatmap', () => {
  const today = new Date(2026, 7, 8, 15);

  it('builds an inclusive local-day rid range and de-duplicates cards', () => {
    const range = reviewDateRange(today);
    expect(range.date).toBe('2026-08-08');
    expect(range.endMs - range.startMs).toBe(86400000 - 1);
    expect(parseReviewDateQuery(range.query)).toEqual({ startMs: range.startMs, endMs: range.endMs });
    expect(cardIdsInReviewRange([
      [range.startMs, 10], [range.endMs, 10], [range.startMs - 1, 20], [range.endMs + 1, 30]
    ], range)).toEqual([10]);
  });

  it('scales from recent data and never creates future cells', () => {
    const result = calculateHeatmap([
      ['2020-01-01', 999], ['2026-08-07', 1], ['2026-08-08', 4], ['2026-08-09', 1000]
    ], today);
    expect(result.maxCount).toBe(4);
    expect(result.cells.every(cell => cell.date <= '2026-08-08')).toBe(true);
    expect(result.cells.find(cell => cell.date === '2026-08-08')?.opacity).toBe(1);
  });

  it('calculates review average, learned days, and streaks', () => {
    expect(computeReviewStats([
      ['2026-08-04', 4], ['2026-08-06', 3], ['2026-08-07', 1], ['2026-08-08', 2]
    ], undefined, today)).toEqual({
      dailyAverage: 2, daysLearnedPercent: 80, currentStreak: 3, longestStreak: 3
    });
  });
});

describe('note fields', () => {
  it('normalizes Anki field objects and detects blank HTML', () => {
    expect(noteFieldValue({ value: 'front' })).toBe('front');
    expect(noteFieldValue(undefined)).toBe('');
    expect(isBlankHtml({ value: '<p>&nbsp;</p><div><br></div>' })).toBe(true);
    expect(isBlankHtml('<p>answer</p>')).toBe(false);
  });
});

describe('query routing', () => {
  it('routes note, card, review, and unsupported flag queries', () => {
    expect(classifyQuery('tag:topic')).toBe('notes');
    expect(classifyQuery('flag:1')).toBe('cards');
    expect(isCardQuery('flag:3')).toBe(true);
    expect(classifyQuery('rid:1:2')).toBe('reviews');
    expect(classifyQuery('flag:4')).toBe('invalid');
  });
});
