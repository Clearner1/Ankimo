import { useCallback, useEffect, useState } from 'react';
import { AnkiConnect } from './api/ankiConnect';
import { NewNoteDialog } from './features/composer';
import {
  Sidebar,
  TopBar,
  usePinnedTags,
  type ConnectionState,
  type NavigationFilter,
  type SyncState
} from './features/navigation';
import { EditModal, NoteStream, useNotes, type Toast } from './features/notes';
import { ReviewOverview, type ReviewDateSelection } from './features/review';
import styles from './App.module.css';

const client = new AnkiConnect();

function initialBlurState() {
  try {
    return localStorage.getItem('ankimo_blur_enabled') !== 'false';
  } catch {
    return true;
  }
}

export default function App() {
  const notes = useNotes({ client });
  const setNotesQuery = notes.setQuery;
  const { pinnedTags, togglePinnedTag } = usePinnedTags(client);
  const [tags, setTags] = useState<string[]>([]);
  const [decks, setDecks] = useState<string[]>([]);
  const [filter, setFilter] = useState<NavigationFilter | null>(null);
  const [selectedReviewDate, setSelectedReviewDate] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [answersHidden, setAnswersHidden] = useState(initialBlurState);
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking');
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [reviewVersion, setReviewVersion] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback<Toast>((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  const loadNavigation = useCallback(async () => {
    const [nextTags, nextDecks] = await Promise.all([client.getTags(), client.deckNames()]);
    setTags(nextTags);
    setDecks(nextDecks);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(loadNavigation).then(() => {
      if (active) setConnectionState('connected');
    }).catch(() => {
      if (!active) return;
      setConnectionState('disconnected');
      showToast('无法连接 AnkiConnect，请打开 Anki 并检查 AnkiConnect 后重试', 'error');
    });
    return () => { active = false; };
  }, [loadNavigation, showToast]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      if (notes.error) setConnectionState('disconnected');
      else if (!notes.loading) setConnectionState('connected');
    });
  }, [notes.error, notes.loading]);

  const applyFilter = useCallback((next: NavigationFilter | null) => {
    setFilter(next);
    setSelectedReviewDate(null);
    setNotesQuery(next?.query || '*');
  }, [setNotesQuery]);

  const applyReviewDate = useCallback((selection: ReviewDateSelection) => {
    setSelectedReviewDate(selection.date);
    const next = { query: selection.query, label: selection.label };
    setFilter(next);
    setNotesQuery(next.query);
  }, [setNotesQuery]);

  const toggleAnswers = () => {
    setAnswersHidden(current => {
      const next = !current;
      try {
        localStorage.setItem('ankimo_blur_enabled', String(next));
      } catch {
        // Persistence is optional; the UI still works without localStorage.
      }
      return next;
    });
  };

  const sync = async () => {
    setSyncState('busy');
    try {
      await client.sync();
      await loadNavigation();
      await notes.reload();
      setReviewVersion(version => version + 1);
      setConnectionState('connected');
      setSyncState('success');
      showToast('同步完成');
    } catch (cause) {
      setConnectionState('disconnected');
      setSyncState('error');
      showToast(`同步失败: ${cause instanceof Error ? cause.message : String(cause)}`, 'error');
    }
  };

  const deleteNote = async (noteId: number) => {
    try {
      await notes.deleteNote(noteId);
      showToast('已删除');
    } catch (cause) {
      showToast(`删除失败: ${cause instanceof Error ? cause.message : String(cause)}`, 'error');
    }
  };

  const refreshAfterWrite = async () => {
    await notes.reload();
    try {
      await loadNavigation();
    } catch {
      // The note write already succeeded; stale navigation metadata can refresh on sync.
    }
  };

  return (
    <>
      <Sidebar
        open={sidebarOpen}
        allTags={tags}
        pinnedTags={pinnedTags}
        decks={decks}
        activeFilter={filter?.query}
        onFilter={applyFilter}
        onTogglePin={togglePinnedTag}
        onMobileClose={() => setSidebarOpen(false)}
      >
        <ReviewOverview
          key={reviewVersion}
          client={client}
          noteCount={notes.count}
          tagCount={tags.length}
          selectedDate={selectedReviewDate}
          onReviewDateSelect={applyReviewDate}
          onMobileClose={() => setSidebarOpen(false)}
        />
      </Sidebar>

      <main className="main-content">
        <TopBar
          menuOpen={sidebarOpen}
          connectionState={connectionState}
          syncState={syncState}
          answersHidden={answersHidden}
          onMenuToggle={() => setSidebarOpen(current => !current)}
          onSearch={query => applyFilter(query ? { query, label: `搜索: ${query}` } : null)}
          onToggleAnswers={toggleAnswers}
          onSync={sync}
        />

        <div className="content-area" id="contentArea">
          <div className="content-column">
            {filter && (
              <div className="filter-info" id="filterInfo">
                <span className="filter-dot" aria-hidden="true" />
                <span id="filterText">{filter.label}</span>
                <button className="clear-filter" id="clearFilter" type="button" onClick={() => applyFilter(null)}>清除筛选</button>
              </div>
            )}

            <NoteStream
              notes={notes.notes}
              count={notes.count}
              loading={notes.loading}
              loadingMore={notes.loadingMore}
              hasMore={notes.hasMore}
              error={notes.error}
              blurAnswers={answersHidden}
              onLoadMore={notes.loadMore}
              onEdit={setEditingNoteId}
              onDelete={deleteNote}
              onTagClick={tag => applyFilter({ query: `tag:${tag}`, label: `标签: ${tag}` })}
            />
          </div>
        </div>

        <button className={styles.newNoteButton} type="button" aria-haspopup="dialog" onClick={() => setComposerOpen(true)}>
          <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false"><path d="M9 2v14M2 9h14" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" /></svg>
          <span>新建笔记</span>
        </button>
      </main>

      <button
        className={`overlay${sidebarOpen ? ' active' : ''}`}
        type="button"
        aria-label="关闭侧栏"
        onClick={() => setSidebarOpen(false)}
      />

      <EditModal
        key={editingNoteId ?? 'closed'}
        noteId={editingNoteId}
        client={client}
        allTags={tags}
        onClose={() => setEditingNoteId(null)}
        onUpdated={refreshAfterWrite}
        onToast={showToast}
      />

      <NewNoteDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        client={client}
        allTags={tags}
        onCreated={refreshAfterWrite}
        onToast={showToast}
      />

      {toast && <div className={`toast ${toast.type}`} role="status">{toast.message}</div>}
    </>
  );
}
