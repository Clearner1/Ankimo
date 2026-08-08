export type QueryRoute = 'notes' | 'cards' | 'reviews' | 'invalid';

export function classifyQuery(query: string): QueryRoute {
  if (query.startsWith('rid:')) return 'reviews';
  if (/^flag:\d+$/.test(query)) return /^flag:[123]$/.test(query) ? 'cards' : 'invalid';
  return 'notes';
}

export function parseReviewDateQuery(query: string) {
  const match = query.match(/^rid:(\d+):(\d+)$/);
  return match ? { startMs: parseInt(match[1], 10), endMs: parseInt(match[2], 10) } : null;
}

export function isCardQuery(query: string) {
  return classifyQuery(query) === 'cards';
}
