import { useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { TagTree } from './TagTree';

export type NavigationFilter = { query: string; label: string };

export type SidebarProps = {
  open?: boolean;
  allTags: readonly string[];
  pinnedTags: readonly string[];
  decks: readonly string[];
  activeFilter?: string | null;
  onFilter: (filter: NavigationFilter | null) => void;
  onTogglePin: (tag: string) => void;
  onMobileClose?: () => void;
  children?: ReactNode;
};

const flags = [
  ['1', '红旗', 'flag-red'],
  ['2', '橙旗', 'flag-orange'],
  ['3', '绿旗', 'flag-green']
] as const;

function sectionToggle() {
  return <span className="section-toggle" aria-hidden="true"><svg viewBox="0 0 12 7" width="12" height="7" focusable="false"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" /></svg></span>;
}

function initialFlagsExpanded() {
  try {
    return localStorage.getItem('ankimo_flags_expanded') === 'true';
  } catch {
    return false;
  }
}

export function Sidebar({ open = false, allTags, pinnedTags, decks, activeFilter = null, onFilter, onTogglePin, onMobileClose, children }: SidebarProps) {
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [flagsExpanded, setFlagsExpanded] = useState(initialFlagsExpanded);
  const [decksExpanded, setDecksExpanded] = useState(false);
  const allActive = activeFilter === null || activeFilter === undefined || activeFilter === '' || activeFilter === '*' || activeFilter === 'all';

  const selectFilter = (filter: NavigationFilter | null) => {
    onFilter(filter);
    onMobileClose?.();
  };

  const toggleFlags = () => {
    setFlagsExpanded((expanded) => {
      const next = !expanded;
      try {
        localStorage.setItem('ankimo_flags_expanded', String(next));
      } catch {
        // localStorage is only a convenience for this UI state.
      }
      return next;
    });
  };

  const activateDeck = (deck: string) => selectFilter({ query: `deck:"${deck}"`, label: `牌组: ${deck}` });
  const onDeckKeyDown = (event: KeyboardEvent<HTMLDivElement>, deck: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activateDeck(deck);
    }
  };

  return (
    <aside className={`sidebar${open ? ' open' : ''}`} id="sidebar">
      <div className="sidebar-header">
        <h1 className="logo"><span className="logo-mark" aria-hidden="true">A</span><span>Ankimo</span></h1>
      </div>

      <nav className="sidebar-nav" aria-label="主导航">
        <button className={`nav-item${allActive ? ' active' : ''}`} id="navAll" data-filter="all" type="button" onClick={() => selectFilter(null)}>
          <span className="nav-icon nav-icon-notes" aria-hidden="true" /><span>全部笔记</span>
        </button>
        <button className={`nav-item${activeFilter === 'is:due' ? ' active' : ''}`} id="navDaily" data-filter="is:due" type="button" onClick={() => selectFilter({ query: 'is:due', label: '每日回顾 (今日到期)' })}>
          <span className="nav-icon nav-icon-review" aria-hidden="true" /><span>每日回顾</span>
        </button>
      </nav>

      <div className="sidebar-section tags-section">
        <button className={`section-header${tagsExpanded ? '' : ' collapsed'}`} id="tagHeader" type="button" aria-controls="tagContent" aria-expanded={tagsExpanded} onClick={() => setTagsExpanded((expanded) => !expanded)}>
          <span className="section-title">标签</span>
          {sectionToggle()}
        </button>
        <div id="tagContent" style={tagsExpanded ? undefined : { display: 'none' }}>
          <TagTree
            allTags={allTags}
            pinnedTags={pinnedTags}
            activeFilter={activeFilter}
            onTagSelect={(tag) => selectFilter({ query: `tag:${tag}`, label: `标签: ${tag}` })}
            onTogglePin={onTogglePin}
          />
        </div>
      </div>

      <div className="sidebar-section flags-section">
        <button className={`section-header${flagsExpanded ? '' : ' collapsed'}`} id="flagHeader" type="button" aria-controls="flagList" aria-expanded={flagsExpanded} onClick={toggleFlags}>
          <span className="section-title"><span className="section-mark flag-mark" aria-hidden="true" /> 旗标</span>
          {sectionToggle()}
        </button>
        <div className="flag-list" id="flagList" style={flagsExpanded ? undefined : { display: 'none' }}>
          {flags.map(([value, label, color]) => (
            <button className={`flag-item${activeFilter === `flag:${value}` ? ' active' : ''}`} data-flag={value} type="button" key={value} onClick={() => selectFilter({ query: `flag:${value}`, label })}>
              <span className={`flag-dot ${color}`} aria-hidden="true" /><span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-section deck-section">
        <button className={`section-header${decksExpanded ? '' : ' collapsed'}`} id="deckHeader" type="button" aria-controls="deckList" aria-expanded={decksExpanded} onClick={() => setDecksExpanded((expanded) => !expanded)}>
          <span className="section-title"><span className="section-mark deck-mark" aria-hidden="true" /> 牌组</span>
          {sectionToggle()}
        </button>
        <div className="deck-list" id="deckList" style={decksExpanded ? undefined : { display: 'none' }}>
          {decks.map((deck) => (
            <div className={`deck-item${activeFilter === `deck:"${deck}"` ? ' active' : ''}`} role="button" tabIndex={0} aria-label={`按牌组筛选 ${deck}`} key={deck} onClick={() => activateDeck(deck)} onKeyDown={(event) => onDeckKeyDown(event, deck)}>
              <span className="deck-icon" aria-hidden="true" /><span>{deck}</span>
            </div>
          ))}
        </div>
      </div>

      {children}
    </aside>
  );
}
