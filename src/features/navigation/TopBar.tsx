import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';

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
  disconnected: '无法连接本地 AnkiConnect。请打开 Anki 并检查 AnkiConnect 后重试。'
};

const syncStateClasses = ['sync-busy', 'sync-success', 'sync-error', 'status-busy', 'status-success', 'status-error', 'is-busy', 'is-success', 'is-error'];

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
    <header className="top-bar">
      <button className="menu-btn" id="menuBtn" type="button" aria-label={menuOpen ? '关闭侧栏' : '打开侧栏'} aria-controls="sidebar" aria-expanded={menuOpen} onClick={onMenuToggle}>
        <svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true" focusable="false"><path d="M1 1h14M1 6h14M1 11h14" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>
      </button>
      <button className="search-toggle" id="searchToggle" type="button" aria-label="打开搜索" aria-controls="searchBox" aria-expanded={searchExpanded} onClick={() => setSearchExpanded(true)}>搜索</button>
      <div className={`search-box${searchExpanded ? ' expanded' : ''}`} id="searchBox">
        <span className="search-icon" aria-hidden="true" />
        <input ref={searchInputRef} type="text" id="searchInput" placeholder="搜索笔记... 支持 Anki 搜索语法" aria-label="搜索笔记" value={search} onChange={onSearchChange} onKeyDown={onSearchKeyDown} />
        <button className="search-close" id="searchClose" type="button" aria-label="关闭搜索" onClick={() => setSearchExpanded(false)}>
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false"><path d="M2 2l10 10M12 2L2 12" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>
        </button>
      </div>
      <div className={`connection-status ${connectionState} status-${connectionState} is-${connectionState}`} id="connectionStatus" data-state={connectionState} role="status" aria-live="polite" aria-label={`AnkiConnect 连接状态：${message}`}>
        <span id="connectionStatusText">{message}</span>
      </div>
      <button className={`blur-toggle-btn${answersHidden ? ' active' : ''}`} id="blurToggleBtn" type="button" title="切换答案显示" aria-pressed={!answersHidden} onClick={onToggleAnswers}>{answersHidden ? '隐藏答案' : '显示答案'}</button>
      <button className={`sync-btn ${syncStateClasses.includes(`sync-${syncState}`) ? `sync-${syncState} status-${syncState} is-${syncState}` : ''}`.trim()} id="syncBtn" type="button" title="同步 Anki" aria-busy={syncState === 'busy'} disabled={syncState === 'busy'} onClick={() => { void onSync(); }}>同步</button>
    </header>
  );
}
