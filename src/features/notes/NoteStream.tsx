import { useEffect, useRef } from 'react';
import type { NoteInfo } from '../../api/ankiConnect';
import { NoteCard } from './NoteCard';
import styles from './NoteStream.module.css';

export type NoteStreamProps = {
  notes: readonly NoteInfo[];
  count?: number;
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  error?: string | null;
  blurAnswers?: boolean;
  onLoadMore?: () => void | Promise<void>;
  onEdit?: (noteId: number) => void;
  onDelete?: (noteId: number) => void | Promise<void>;
  onTagClick?: (tag: string) => void;
};

export function NoteStream({
  notes,
  count = notes.length,
  loading = false,
  loadingMore = false,
  hasMore = false,
  error = null,
  blurAnswers = true,
  onLoadMore,
  onEdit,
  onDelete,
  onTagClick
}: NoteStreamProps) {
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const empty = !loading && !loadingMore && notes.length === 0;
  const countText = loading ? '正在加载笔记' : error ? '笔记加载失败，请检查本地 Anki 连接后重试' : count === 0 ? '没有符合条件的笔记' : `共 ${count} 条笔记`;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !onLoadMore || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && !loadingMore) void onLoadMore();
    }, { rootMargin: '200px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  return (
    <section className={`stream-region ${styles.region}`} aria-labelledby="streamHeading">
      <div className={`stream-header ${styles.header}`}>
        <h2 id="streamHeading">全部笔记</h2>
        <span id="streamCount">{countText}</span>
      </div>
      <div id="notesList" className={`notes-list ${styles.notesList}`}>
        {notes.map(note => <NoteCard key={`${note.noteId}-${blurAnswers}`} note={note} blurAnswers={blurAnswers} onEdit={onEdit} onDelete={onDelete} onTagClick={onTagClick} />)}
        {hasMore && onLoadMore && <button ref={loadMoreRef} className={`load-more ${styles.loadMore}`} type="button" disabled={loadingMore} onClick={() => void onLoadMore()}>{loadingMore ? '加载中...' : '加载更多'}</button>}
      </div>
      <div id="loading" className={`loading ${styles.loading}`} style={{ display: loading || loadingMore ? 'flex' : 'none' }} aria-live="polite">
        <span className={`spinner ${styles.spinner}`} aria-hidden="true" />
        <span>加载中...</span>
      </div>
      {empty && <div id="emptyState" className={`empty-state ${styles.emptyState}`}><span className={`empty-icon ${styles.emptyIcon}`} aria-hidden="true" /><p>{error || '还没有笔记'}</p><span>{error ? '请重试或检查本地 AnkiConnect。' : '开始记录你的第一个想法吧。'}</span></div>}
    </section>
  );
}
