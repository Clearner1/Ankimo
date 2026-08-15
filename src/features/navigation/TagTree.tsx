import { useState } from 'react';
import type { ChangeEvent, MouseEvent, ReactNode } from 'react';
import { buildTagTree, filterTagPaths } from '../../domain/tags';
import type { TagTree as TagTreeData, TagTreeNode } from '../../domain/tags';

export type TagTreeProps = {
  allTags: readonly string[];
  pinnedTags: readonly string[];
  activeFilter?: string | null;
  onTagSelect: (tag: string) => void;
  onTogglePin: (tag: string) => void;
};

function tagToggleIcon(expanded: boolean, hasChildren: boolean) {
  if (!hasChildren) return null;
  const path = expanded ? 'M1 1l5 5 5-5' : 'M1 1l5 5 5 5';
  return <svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d={path} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" /></svg>;
}

function pinnedSubtree(tags: readonly string[], pinnedTag: string) {
  const tree = buildTagTree(tags);
  const parts = pinnedTag.split('::');
  let subtree: Record<string, TagTreeNode> = tree;
  let parentPath = '';

  for (let index = 0; index < parts.length - 1; index += 1) {
    const node = subtree[parts[index]];
    if (node?._children) subtree = node._children;
    parentPath += `${parentPath ? '::' : ''}${parts[index]}`;
  }

  const lastPart = parts[parts.length - 1];
  return subtree[lastPart] ? { nodes: { [lastPart]: subtree[lastPart] }, prefix: parentPath } : null;
}

export function TagTree({ allTags, pinnedTags, activeFilter, onTagSelect, onTogglePin }: TagTreeProps) {
  const [search, setSearch] = useState('');
  const [moreTagsExpanded, setMoreTagsExpanded] = useState(true);
  const [expandedTags, setExpandedTags] = useState<Record<string, boolean>>({});
  const filteredTags = filterTagPaths(allTags, search);
  const visiblePinnedTags = pinnedTags.filter((tag) => allTags.includes(tag));

  const onSearch = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSearch(value);
    if (value.trim()) setMoreTagsExpanded(true);
  };

  const toggleExpanded = (tag: string, expanded: boolean) => {
    setExpandedTags((current) => ({ ...current, [tag]: !expanded }));
  };

  const renderNodes = (nodes: TagTreeData, prefix: string, scope: string): ReactNode[] => Object.keys(nodes).sort().map((name) => {
    const fullTag = prefix ? `${prefix}::${name}` : name;
    const children = nodes[name]._children;
    const hasChildren = Boolean(children && Object.keys(children).length);
    const expansionKey = `${scope}:${fullTag}`;
    const expanded = expandedTags[expansionKey] !== false;
    const isPinned = pinnedTags.includes(fullTag);
    const active = activeFilter === `tag:${fullTag}`;

    const onFilterClick = (event: MouseEvent<HTMLButtonElement>) => {
      if (hasChildren && (event.target as HTMLElement).closest('.tag-toggle')) {
        event.preventDefault();
        toggleExpanded(expansionKey, expanded);
        return;
      }
      onTagSelect(fullTag);
    };

    return (
      <div className="tag-node" key={fullTag}>
        <div className={`tag-row${active ? ' active' : ''}`}>
          <button className="tag-filter-button" type="button" title={fullTag} aria-label={`按标签筛选 ${fullTag}`} aria-expanded={hasChildren ? expanded : undefined} onClick={onFilterClick}>
            <span className={`tag-toggle${hasChildren ? '' : ' is-empty'}`} aria-hidden="true">{tagToggleIcon(expanded, hasChildren)}</span>
            <span className="tag-name">{name}</span>
          </button>
          <button className={`tag-pin${isPinned ? ' pinned' : ''}`} data-tag={fullTag} type="button" aria-label={`${isPinned ? '取消固定' : '固定'}标签 ${fullTag}`} aria-pressed={isPinned} onClick={(event) => { event.stopPropagation(); onTogglePin(fullTag); }} />
        </div>
        {hasChildren && <div className={`tag-children${expanded ? '' : ' collapsed'}`}>{renderNodes(children!, fullTag, scope)}</div>}
      </div>
    );
  });

  const pinnedContent = visiblePinnedTags.map((pinnedTag) => {
    const descendants = allTags.filter((tag) => tag === pinnedTag || tag.startsWith(`${pinnedTag}::`));
    const filteredDescendants = filterTagPaths(descendants, search);
    if (!filteredDescendants.length) return null;
    const subtree = pinnedSubtree(filteredDescendants, pinnedTag);
    return subtree ? renderNodes(subtree.nodes, subtree.prefix, `pinned:${pinnedTag}`) : null;
  });

  return (
    <>
      <div className="tag-search-box">
        <input type="text" id="tagSearchInput" placeholder="搜索标签..." aria-label="搜索标签" value={search} onChange={onSearch} />
      </div>
      <div className="pinned-tags" id="pinnedTags">{pinnedContent}</div>
      <button className="more-tags-toggle" id="moreTagsToggle" type="button" aria-controls="tagTree" aria-expanded={moreTagsExpanded} onClick={() => setMoreTagsExpanded((expanded) => !expanded)}>
        <span>{moreTagsExpanded ? '收起标签' : '更多标签'}</span>
        <span className="more-tags-count" id="moreTagsCount">({allTags.length})</span>
      </button>
      <div className={`tag-tree${moreTagsExpanded ? '' : ' collapsed'}`} id="tagTree">{renderNodes(buildTagTree(filteredTags), '', 'all')}</div>
    </>
  );
}
