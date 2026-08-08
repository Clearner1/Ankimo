import { useRef } from 'react';
import { calculateHeatmap, computeReviewStats, reviewDateRange } from '../../domain/heatmap';
import type { ReviewClient } from './useReview';
import { useReview } from './useReview';

export type ReviewDateSelection = ReturnType<typeof reviewDateRange> & {
  count: number;
  label: string;
};

export type TooltipPosition = { left: number; top: number };

export function boundTooltipPosition(
  left: number,
  above: number,
  below: number,
  containerWidth: number,
  containerHeight: number,
  tooltipWidth: number,
  tooltipHeight: number
): TooltipPosition {
  const maxLeft = Math.max(0, containerWidth - tooltipWidth);
  const maxTop = Math.max(0, containerHeight - tooltipHeight);
  const top = above >= 0 ? above : below;
  return {
    left: Math.max(0, Math.min(left, maxLeft)),
    top: Math.max(0, Math.min(top, maxTop))
  };
}

export type ReviewOverviewProps = {
  noteCount: number;
  tagCount: number;
  selectedDate: string | null;
  onReviewDateSelect: (selection: ReviewDateSelection) => void;
  onMobileClose?: () => void;
  client?: ReviewClient;
};

const weeks = 12;
const cellSize = 13;
const gap = 2;
const total = cellSize + gap;
const svgWidth = weeks * total + 2;
const svgHeight = 7 * total + 2;

export function ReviewOverview({
  noteCount,
  tagCount,
  selectedDate,
  onReviewDateSelect,
  onMobileClose,
  client
}: ReviewOverviewProps) {
  const review = useReview(client);
  const heatmapRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const heatmap = review.loaded ? calculateHeatmap(review.reviewByDay) : null;
  const stats = review.loaded ? computeReviewStats(review.reviewByDay) : null;

  const showTooltip = (cell: SVGRectElement) => {
    const container = heatmapRef.current;
    const tooltip = tooltipRef.current;
    if (!container || !tooltip) return;

    tooltip.textContent = `${cell.dataset.date}：${cell.dataset.count} 张卡片`;
    tooltip.classList.add('visible');

    const cellRect = cell.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const left = cellRect.left - containerRect.left + cellRect.width / 2 - tooltip.offsetWidth / 2;
    const above = cellRect.top - containerRect.top - tooltip.offsetHeight - 4;
    const below = cellRect.bottom - containerRect.top + 4;
    const position = boundTooltipPosition(
      left,
      above,
      below,
      containerRect.width,
      containerRect.height,
      tooltip.offsetWidth,
      tooltip.offsetHeight
    );
    tooltip.style.left = `${position.left}px`;
    tooltip.style.top = `${position.top}px`;
  };

  const selectCell = (date: string, count: number) => {
    if (count === 0) return;
    const range = reviewDateRange(date);
    onReviewDateSelect({
      ...range,
      count,
      label: `${date} 复习的卡片 (${count}张)`
    });
    onMobileClose?.();
  };

  return (
    <section className="stats-card" id="statsCard" aria-labelledby="statsTitle">
      <h2 className="stats-title" id="statsTitle">复习概览</h2>
      <div className="stats-row">
        <div className="stat-item"><span className="stat-num" id="statNotes">{noteCount}</span><span className="stat-label">笔记</span></div>
        <div className="stat-item"><span className="stat-num" id="statTags">{tagCount}</span><span className="stat-label">标签</span></div>
        <div className="stat-item"><span className="stat-num" id="statReviewed">{review.reviewedToday ?? '—'}</span><span className="stat-label">今日复习</span></div>
      </div>
      <div className="heatmap-container" id="heatmap" role="group" aria-label="最近十二周复习热力图" ref={heatmapRef}>
        {heatmap && (
          <svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} xmlns="http://www.w3.org/2000/svg">
            {heatmap.cells.map((cell) => (
              <rect
                key={cell.date}
                x={cell.week * total + 1}
                y={cell.day * total + 1}
                width={cellSize}
                height={cellSize}
                rx="2"
                fill="var(--green)"
                fillOpacity={cell.opacity.toFixed(2)}
                data-date={cell.date}
                data-count={cell.count}
                className={cell.date === selectedDate ? 'selected' : undefined}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(event) => showTooltip(event.currentTarget)}
                onMouseLeave={() => tooltipRef.current?.classList.remove('visible')}
                onClick={() => selectCell(cell.date, cell.count)}
              />
            ))}
          </svg>
        )}
        <div className="heatmap-tooltip" ref={tooltipRef} />
      </div>
      <div className="review-stats" id="reviewStats">
        <ReviewStat id="statDailyAvg" value={stats ? stats.dailyAverage : '—'} description="日均复习" />
        <ReviewStat id="statDaysLearned" value={stats ? `${stats.daysLearnedPercent}%` : '—'} description="学习天数" />
        <ReviewStat id="statCurrentStreak" value={stats ? `${stats.currentStreak}天` : '—'} description="当前连续" />
        <ReviewStat id="statLongestStreak" value={stats ? `${stats.longestStreak}天` : '—'} description="最长连续" />
      </div>
    </section>
  );
}

function ReviewStat({ id, value, description }: { id: string; value: number | string; description: string }) {
  return (
    <div className="review-stat-item">
      <span className="review-stat-icon" aria-hidden="true" />
      <div className="review-stat-info">
        <span className="review-stat-value" id={id}>{value}</span>
        <span className="review-stat-desc">{description}</span>
      </div>
    </div>
  );
}
