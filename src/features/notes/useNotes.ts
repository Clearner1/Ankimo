import { useCallback, useEffect, useRef, useState } from 'react';
import { AnkiConnect, type NoteInfo } from '../../api/ankiConnect';
import { cardIdsInReviewRange } from '../../domain/heatmap';
import { classifyQuery, parseReviewDateQuery, type QueryRoute } from '../../domain/queries';

export type NotesApi = Pick<AnkiConnect,
  'findNotes' | 'findCards' | 'cardsToNotes' | 'deckNames' | 'cardReviews' | 'notesInfo' | 'deleteNotes'>;

export type NotesOptions = {
  client?: NotesApi;
  initialQuery?: string;
  batchSize?: number;
};

export type NotesState = {
  notes: NoteInfo[];
  count: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  setQuery: (query: string) => void;
  reload: () => void;
  loadMore: () => Promise<void>;
  deleteNote: (noteId: number) => Promise<void>;
};

const defaultClient = new AnkiConnect();

export function newestFirstUniqueNoteIds(ids: readonly number[]): number[] {
  return [...new Set(ids)].reverse();
}

export async function findNoteIds(query: string, client: NotesApi): Promise<number[]> {
  const route: QueryRoute = classifyQuery(query);
  if (route === 'invalid') throw new Error('仅支持红旗、橙旗、绿旗筛选');

  if (route === 'notes') return newestFirstUniqueNoteIds(await client.findNotes(query));

  if (route === 'cards') {
    const cards = await client.findCards(query);
    return newestFirstUniqueNoteIds(cards.length ? await client.cardsToNotes(cards) : []);
  }

  const range = parseReviewDateQuery(query);
  if (!range) return [];
  const reviews = (await Promise.all(
    (await client.deckNames()).map(deck => client.cardReviews(deck, 0))
  )).flat();
  const cards = cardIdsInReviewRange(reviews, range);
  return newestFirstUniqueNoteIds(cards.length ? await client.cardsToNotes(cards) : []);
}

export function useNotes({ client = defaultClient, initialQuery = '*', batchSize = 30 }: NotesOptions = {}): NotesState {
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [noteIds, setNoteIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const idsRef = useRef<number[]>([]);
  const loadedRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const queryRef = useRef(initialQuery);

  const loadBatch = useCallback(async (ids: number[], requestId: number) => {
    if (loadingMoreRef.current || loadedRef.current >= ids.length) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const start = loadedRef.current;
    const end = Math.min(start + batchSize, ids.length);
    try {
      const batch = await client.notesInfo(ids.slice(start, end));
      if (request.current !== requestId) return;
      const byId = new Map(batch.map(note => [note.noteId, note]));
      const ordered = ids.slice(start, end).flatMap(id => {
        const note = byId.get(id);
        return note ? [note] : [];
      });
      setNotes(current => [...current, ...ordered]);
      loadedRef.current = end;
      setLoaded(end);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [batchSize, client]);

  const load = useCallback(async (nextQuery: string) => {
    const requestId = ++request.current;
    queryRef.current = nextQuery;
    setLoading(true);
    setError(null);
    setNotes([]);
    setLoaded(0);
    loadedRef.current = 0;
    try {
      const ids = await findNoteIds(nextQuery, client);
      if (request.current !== requestId) return;
      idsRef.current = ids;
      setNoteIds(ids);
      await loadBatch(ids, requestId);
    } catch (cause) {
      if (request.current !== requestId) return;
      setNoteIds([]);
      idsRef.current = [];
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request.current === requestId) setLoading(false);
    }
  }, [client, loadBatch]);

  useEffect(() => {
    queueMicrotask(() => void load(initialQuery));
  }, [initialQuery, load]);

  const setQuery = useCallback((nextQuery: string) => {
    void load(nextQuery || '*');
  }, [load]);

  const reload = useCallback(() => {
    void load(queryRef.current);
  }, [load]);

  const loadMore = useCallback(async () => {
    setError(null);
    try {
      await loadBatch(idsRef.current, request.current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [loadBatch]);

  const deleteNote = useCallback(async (noteId: number) => {
    await client.deleteNotes([noteId]);
    const wasLoaded = notes.some(note => note.noteId === noteId);
    const nextIds = idsRef.current.filter(id => id !== noteId);
    idsRef.current = nextIds;
    setNoteIds(nextIds);
    setNotes(current => current.filter(note => note.noteId !== noteId));
    if (wasLoaded) {
      loadedRef.current = Math.max(0, loadedRef.current - 1);
      setLoaded(loadedRef.current);
    }
  }, [client, notes]);

  return {
    notes,
    count: noteIds.length,
    loading,
    loadingMore,
    hasMore: loaded < noteIds.length,
    error,
    setQuery,
    reload,
    loadMore,
    deleteNote
  };
}
