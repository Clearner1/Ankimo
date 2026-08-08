import { describe, expect, it } from 'vitest';
import { boundTooltipPosition } from './ReviewOverview';

describe('review tooltip positioning', () => {
  it('keeps the tooltip inside the heatmap container', () => {
    expect(boundTooltipPosition(-4, -20, 110, 182, 107, 60, 20)).toEqual({ left: 0, top: 87 });
    expect(boundTooltipPosition(160, 10, 40, 182, 107, 60, 20)).toEqual({ left: 122, top: 10 });
  });
});
