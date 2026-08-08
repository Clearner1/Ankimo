import { useCallback, useEffect, useState } from 'react';
import { AnkiConnect } from '../../api/ankiConnect';
import type { ReviewCountByDay } from '../../api/ankiConnect';

export type ReviewClient = Pick<AnkiConnect, 'getNumCardsReviewedToday' | 'getNumCardsReviewedByDay'>;

export type ReviewState = {
  reviewedToday: number | null;
  reviewByDay: ReviewCountByDay[];
  loaded: boolean;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
};

const defaultClient = new AnkiConnect();

export function useReview(client: ReviewClient = defaultClient): ReviewState {
  const [reviewedToday, setReviewedToday] = useState<number | null>(null);
  const [reviewByDay, setReviewByDay] = useState<ReviewCountByDay[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [today, byDay] = await Promise.all([
        client.getNumCardsReviewedToday(),
        client.getNumCardsReviewedByDay()
      ]);
      setReviewedToday(today);
      setReviewByDay(byDay);
      setLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    // The initial request is the hook's external data synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return { reviewedToday, reviewByDay, loaded, loading, error, reload };
}
