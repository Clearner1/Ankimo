import type { CardReview, ReviewCountByDay } from '../api/ankiConnect';

export type ReviewDateRange = { date: string; startMs: number; endMs: number; query: string };
export type HeatmapCell = { date: string; count: number; opacity: number; week: number; day: number };
export type Heatmap = { cells: HeatmapCell[]; maxCount: number };
export type ReviewStats = {
  dailyAverage: number;
  daysLearnedPercent: number;
  currentStreak: number;
  longestStreak: number;
};

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function reviewDateRange(date: Date | string): ReviewDateRange {
  const start = typeof date === 'string' ? new Date(`${date}T00:00:00`) : new Date(date);
  if (Number.isNaN(start.getTime())) throw new RangeError('Invalid review date');
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const dateKey = localDateKey(start);
  const startMs = start.getTime();
  const endMs = end.getTime() - 1;
  return { date: dateKey, startMs, endMs, query: `rid:${startMs}:${endMs}` };
}

export function cardIdsInReviewRange(reviews: readonly CardReview[], range: Pick<ReviewDateRange, 'startMs' | 'endMs'>) {
  const cardIds = new Set<number>();
  for (const review of reviews) {
    if (review[0] >= range.startMs && review[0] <= range.endMs) cardIds.add(review[1]);
  }
  return [...cardIds];
}

function dayNumber(date: string) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? Date.UTC(+match[1], +match[2] - 1, +match[3]) / 86400000 : NaN;
}

export function calculateHeatmap(data: readonly ReviewCountByDay[], today = new Date(), weeks = 12): Heatmap {
  const currentDay = new Date(today);
  currentDay.setHours(0, 0, 0, 0);
  const todayDay = currentDay.getDay() === 0 ? 6 : currentDay.getDay() - 1;
  const dayMap: Record<string, number> = {};
  for (const [date, count] of data) dayMap[date] = count;

  const firstDay = new Date(currentDay);
  firstDay.setDate(firstDay.getDate() - ((weeks - 1) * 7 + todayDay));
  const firstKey = localDateKey(firstDay);
  const todayKey = localDateKey(currentDay);
  const maxCount = Math.max(1, ...data
    .filter(([date]) => date >= firstKey && date <= todayKey)
    .map(([, count]) => count));
  const cells: HeatmapCell[] = [];

  for (let week = 0; week < weeks; week++) {
    for (let day = 0; day < 7; day++) {
      const daysAgo = (weeks - 1 - week) * 7 + (todayDay - day);
      const date = new Date(currentDay);
      date.setDate(date.getDate() - daysAgo);
      if (date > currentDay) continue;
      const dateKey = localDateKey(date);
      const count = dayMap[dateKey] || 0;
      const opacity = count === 0 ? 0.08 : 0.28 + Math.sqrt(count / maxCount) * 0.72;
      cells.push({ date: dateKey, count, opacity, week, day });
    }
  }
  return { cells, maxCount };
}

export function computeReviewStats(data: readonly ReviewCountByDay[], dayMap: Record<string, number> = Object.fromEntries(data), today = new Date()): ReviewStats {
  if (data.length === 0) return { dailyAverage: 0, daysLearnedPercent: 0, currentStreak: 0, longestStreak: 0 };

  const allDates = data.map(([date]) => date).sort();
  const totalReviews = data.reduce((sum, [, count]) => sum + count, 0);
  const totalDaysInRange = Math.max(1, dayNumber(allDates[allDates.length - 1]) - dayNumber(allDates[0]) + 1);
  const daysWithReviews = data.filter(([, count]) => count > 0).length;
  const todayDate = new Date(today);
  todayDate.setHours(0, 0, 0, 0);
  const todayKey = localDateKey(todayDate);
  const checkDate = new Date(todayDate);
  if (!dayMap[todayKey] || dayMap[todayKey] === 0) checkDate.setDate(checkDate.getDate() - 1);

  let currentStreak = 0;
  while (dayMap[localDateKey(checkDate)] > 0) {
    currentStreak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }

  let longestStreak = 0;
  let streak = 0;
  const reviewedDates = data.filter(([, count]) => count > 0).map(([date]) => date).sort();
  for (let i = 0; i < reviewedDates.length; i++) {
    streak = i > 0 && dayNumber(reviewedDates[i]) - dayNumber(reviewedDates[i - 1]) === 1 ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak);
  }

  return {
    dailyAverage: Math.round(totalReviews / totalDaysInRange),
    daysLearnedPercent: Math.round((daysWithReviews / totalDaysInRange) * 100),
    currentStreak,
    longestStreak
  };
}
