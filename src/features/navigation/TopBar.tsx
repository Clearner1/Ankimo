import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react';
import styles from './TopBar.module.css';

export type ConnectionState = 'checking' | 'connected' | 'disconnected';
export type SyncState = 'idle' | 'busy' | 'success' | 'error';

export type TopBarProps = {
  menuOpen: boolean;
  connectionState: ConnectionState;
  syncState: SyncState;
  answersHidden: boolean;
  onMenuToggle: () => void;
  onSearch: (query: string) => void | Promise<void>;
  onToggleAnswers: () => void;
  onSync: () => void | Promise<void>;
  connectionMessage?: string;
};

const connectionMessages: Record<ConnectionState, string> = {
  checking: '正在检查本地 Anki',
  connected: '已连接本地 Anki',
  disconnected: '未连接本地 Anki'
};

const shortConnectionMessages: Record<ConnectionState, string> = {
  checking: '连接中',
  connected: '已连接',
  disconnected: '未连接'
};

const syncStateClasses: Record<SyncState, string> = {
  idle: '',
  busy: 'sync-busy status-busy is-busy',
  success: 'sync-success status-success is-success',
  error: 'sync-error status-error is-error'
};

const syncStateStyles: Record<SyncState, string> = {
  idle: '',
  busy: styles.busy,
  success: styles.success,
  error: styles.error
};

export function TopBar({ menuOpen, connectionState, syncState, answersHidden, onMenuToggle, onSearch, onToggleAnswers, onSync, connectionMessage }: TopBarProps) {
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const message = connectionMessage || connectionMessages[connectionState];

  const applySearch = useCallback((value: string) => {
    void onSearch(value.trim());
  }, [onSearch]);

  const onSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => applySearch(value), 500);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (searchTimer.current) clearTimeout(searchTimer.current);
      applySearch(search);
    } else if (event.key === 'Escape') {
      setSearchExpanded(false);
      searchInputRef.current?.blur();
    }
  };

  const closeUtilities = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest('details')?.removeAttribute('open');
  };

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  useEffect(() => {
    if (searchExpanded) searchInputRef.current?.focus();
  }, [searchExpanded]);

  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchExpanded(true);
      }
    };
    document.addEventListener('keydown', onShortcut);
    return () => document.removeEventListener('keydown', onShortcut);
  }, []);

  return (
    <header className={`top-bar ${styles.bar} ${searchExpanded ? styles.searching : ''}`}>
      <button className={`menu-btn ${styles.iconButton} ${styles.menuButton}`} id="menuBtn" type="button" aria-label={menuOpen ? '关闭侧栏' : '打开侧栏'} aria-controls="sidebar" aria-expanded={menuOpen} onClick={onMenuToggle}>
        <svg viewBox="0 0 18 14" width="18" height="14" aria-hidden="true" focusable="false"><path d="M1 1h16M1 7h16M1 13h16" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>
      </button>

      <span className={styles.brand} aria-hidden="true">ankimo</span>

      <div className={`search-box ${styles.searchBox} ${searchExpanded ? `expanded ${styles.searchBoxExpanded}` : ''}`} id="searchBox">
        <span className={styles.searchIcon} aria-hidden="true" />
        <input ref={searchInputRef} type="text" id="searchInput" placeholder="搜索笔记… 支持 Anki 搜索语法" aria-label="搜索笔记" value={search} onChange={onSearchChange} onKeyDown={onSearchKeyDown} />
        <button className={`search-close ${styles.iconButton} ${styles.searchClose}`} id="searchClose" type="button" aria-label="关闭搜索" onClick={() => setSearchExpanded(false)}>
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false"><path d="M2 2l10 10M12 2L2 12" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>
        </button>
      </div>

      <div className={`connection-status ${connectionState} status-${connectionState} is-${connectionState} ${styles.connection} ${styles[connectionState]}`} id="connectionStatus" data-state={connectionState} role="status" aria-live="polite" aria-label={`AnkiConnect 连接状态：${message}`}>
        <span className={styles.connectionLong} id="connectionStatusText">{message}</span>
        <span className={styles.connectionShort} aria-hidden="true">{shortConnectionMessages[connectionState]}</span>
      </div>

      <button className={`search-toggle ${styles.iconButton} ${styles.searchToggle}`} id="searchToggle" type="button" aria-label="打开搜索" aria-controls="searchBox" aria-expanded={searchExpanded} onClick={() => setSearchExpanded(true)}>
        <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m12.2 12.2 4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>
      </button>

      <div className={styles.desktopActions}>
        <button className={`blur-toggle-btn ${styles.actionButton} ${answersHidden ? `active ${styles.active}` : ''}`} id="blurToggleBtn" type="button" title="切换答案显示" aria-pressed={!answersHidden} onClick={onToggleAnswers}>{answersHidden ? '隐藏答案' : '显示答案'}</button>
        <button className={`sync-btn ${syncStateClasses[syncState]} ${styles.actionButton} ${syncStateStyles[syncState]}`.trim()} id="syncBtn" type="button" title="同步 Anki" aria-busy={syncState === 'busy'} disabled={syncState === 'busy'} onClick={() => { void onSync(); }}>同步</button>
      </div>

      <details className={styles.utilityMenu}>
        <summary className={`${styles.iconButton} ${styles.utilityTrigger}`} aria-label="更多操作">
          <svg viewBox="0 0 20 4" width="20" height="4" aria-hidden="true" focusable="false"><circle cx="2" cy="2" r="1.5" fill="currentColor" /><circle cx="10" cy="2" r="1.5" fill="currentColor" /><circle cx="18" cy="2" r="1.5" fill="currentColor" /></svg>
        </summary>
        <div className={styles.utilityPanel}>
          <button type="button" aria-pressed={!answersHidden} onClick={event => { closeUtilities(event); onToggleAnswers(); }}>{answersHidden ? '显示全部答案' : '隐藏全部答案'}</button>
          <button type="button" aria-busy={syncState === 'busy'} disabled={syncState === 'busy'} onClick={event => { closeUtilities(event); void onSync(); }}>{syncState === 'busy' ? '同步中…' : '同步 Anki'}</button>
        </div>
      </details>
    </header>
  );
}
