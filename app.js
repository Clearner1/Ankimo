// ===== AnkiConnect API Wrapper (Ankimo) =====
class AnkiConnect {
  constructor() {
    // 本地访问直连 AnkiConnect，远程访问走 Nginx 代理
    const isLocal = ['127.0.0.1', 'localhost'].includes(location.hostname);
    this.url = isLocal ? 'http://127.0.0.1:8765' : '/anki';
  }
  async invoke(action, params = {}) {
    const res = await fetch(this.url, {
      method: 'POST',
      body: JSON.stringify({ action, version: 6, params })
    });
    if (!res.ok) throw new Error(`AnkiConnect 请求失败 (${res.status})`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
  }
  getTags() { return this.invoke('getTags'); }
  findNotes(query) { return this.invoke('findNotes', { query }); }
  findCards(query) { return this.invoke('findCards', { query }); }
  cardsToNotes(cards) { return this.invoke('cardsToNotes', { cards }); }
  cardsInfo(cards) { return this.invoke('cardsInfo', { cards }); }
  cardReviews(deck, startID) { return this.invoke('cardReviews', { deck, startID }); }
  notesInfo(notes) { return this.invoke('notesInfo', { notes }); }
  addNote(deckName, modelName, fields, tags = []) {
    return this.invoke('addNote', { note: { deckName, modelName, fields, tags, options: { allowDuplicate: true } } });
  }
  createDeck(deckName) { return this.invoke('createDeck', { deck: deckName }); }
  suspend(cards) { return this.invoke('suspend', { cards }); }
  areSuspended(cards) { return this.invoke('areSuspended', { cards }); }
  deleteNotes(notes) { return this.invoke('deleteNotes', { notes }); }
  updateNote(id, fields, tags) {
    return this.invoke('updateNote', { note: { id, fields, tags } });
  }
  deckNames() { return this.invoke('deckNames'); }
  modelNames() { return this.invoke('modelNames'); }
  modelFieldNames(modelName) { return this.invoke('modelFieldNames', { modelName }); }
  getNumCardsReviewedToday() { return this.invoke('getNumCardsReviewedToday'); }
  getNumCardsReviewedByDay() { return this.invoke('getNumCardsReviewedByDay'); }
  sync() { return this.invoke('sync'); }
  storeMediaFile(filename, data) {
    return this.invoke('storeMediaFile', { filename, data: btoa(unescape(encodeURIComponent(data))) });
  }
  async retrieveMediaFile(filename) {
    const result = await this.invoke('retrieveMediaFile', { filename });
    if (!result) return null;
    return decodeURIComponent(escape(atob(result)));
  }
}

// ===== App State =====
const anki = new AnkiConnect();
const state = {
  currentFilter: '',
  currentQuery: '*',
  allTags: [],
  pinnedTags: [],
  noteIds: [],
  notesLoaded: 0,
  batchSize: 30,
  loading: false,
  fieldCache: {},
  blurEnabled: localStorage.getItem('ankimo_blur_enabled') !== 'false', // default true
  noteMode: 'memo',
  flagListExpanded: localStorage.getItem('ankimo_flags_expanded') === 'true',
  lastCreatedNoteId: null,
  connectionState: 'checking',
  syncState: 'idle',
  eventsBound: false
};

// ===== DOM Refs =====
const $ = id => document.getElementById(id);
const el = {
  tagTree: $('tagTree'), pinnedTags: $('pinnedTags'), deckList: $('deckList'),
  notesList: $('notesList'), tagSearchInput: $('tagSearchInput'),
  moreTagsToggle: $('moreTagsToggle'), moreTagsCount: $('moreTagsCount'),
  moreTagsLabel: $('moreTagsToggle')?.querySelector('span:not(.more-tags-count)'),
  searchInput: $('searchInput'), deckSelect: $('deckSelect'), modelSelect: $('modelSelect'),
  tagInput: $('tagInput'), frontInput: $('frontInput'), backInput: $('backInput'),
  inputCard: $('inputCard'),
  saveBtn: $('saveBtn'), syncBtn: $('syncBtn'), loading: $('loading'),
  emptyState: $('emptyState'), filterInfo: $('filterInfo'),
  filterText: $('filterText'), clearFilter: $('clearFilter'),
  statNotes: $('statNotes'), statTags: $('statTags'), statReviewed: $('statReviewed'),
  heatmap: $('heatmap'), contentArea: $('contentArea'),
  sidebar: $('sidebar'), menuBtn: $('menuBtn'), overlay: $('overlay'),
  navAll: $('navAll'), navDaily: $('navDaily'),
  blurToggleBtn: $('blurToggleBtn'),
  searchBox: $('searchBox'), searchToggle: $('searchToggle'), searchClose: $('searchClose'),
  connectionStatus: $('connectionStatus'), connectionStatusText: $('connectionStatusText'),
  modeDescription: $('modeDescription'), streamCount: $('streamCount'),
  tagHeader: $('tagHeader'), tagContent: $('tagContent'),
  deckHeader: $('deckHeader'), flagHeader: $('flagHeader'), flagList: $('flagList'),
  noteModeMemo: $('noteModeMemo'), noteModeQa: $('noteModeQa'),
  advancedToggle: $('advancedToggle'), advancedControls: $('advancedControls')
};

const modeDescriptions = {
  memo: '短笔记会保存到 Ankimo 牌组，保存后暂停，不进入日常复习。',
  qa: '问答卡会保留所选牌组，正常参与 Anki 日常复习。'
};

const connectionStateClasses = [
  'checking', 'connected', 'disconnected',
  'status-checking', 'status-connected', 'status-disconnected',
  'is-checking', 'is-connected', 'is-disconnected'
];

function setConnectionStatus(status, message) {
  if (!el.connectionStatus) return;
  const messages = {
    checking: '正在检查本地 Anki',
    connected: '已连接本地 Anki',
    disconnected: '无法连接本地 AnkiConnect。请打开 Anki 并检查 AnkiConnect 后重试。'
  };
  const nextStatus = messages[status] ? status : 'disconnected';
  const nextMessage = message || messages[nextStatus];
  el.connectionStatus.classList.remove(...connectionStateClasses);
  el.connectionStatus.classList.add(nextStatus, `status-${nextStatus}`, `is-${nextStatus}`);
  el.connectionStatus.dataset.state = nextStatus;
  el.connectionStatus.setAttribute('aria-label', `AnkiConnect 连接状态：${nextMessage}`);
  if (el.connectionStatusText) el.connectionStatusText.textContent = nextMessage;
  state.connectionState = nextStatus;
}

const syncStateClasses = [
  'sync-busy', 'sync-success', 'sync-error',
  'status-busy', 'status-success', 'status-error',
  'is-busy', 'is-success', 'is-error'
];

function setSyncStatus(status) {
  if (!el.syncBtn) return;
  const nextStatus = ['busy', 'success', 'error'].includes(status) ? status : 'idle';
  el.syncBtn.classList.remove(...syncStateClasses);
  if (nextStatus !== 'idle') {
    el.syncBtn.classList.add(`sync-${nextStatus}`, `status-${nextStatus}`, `is-${nextStatus}`);
  }
  el.syncBtn.dataset.state = nextStatus;
  el.syncBtn.setAttribute('aria-busy', String(nextStatus === 'busy'));
  state.syncState = nextStatus;
}

function updateStreamCount() {
  if (!el.streamCount) return;
  const count = state.noteIds.length;
  el.streamCount.textContent = count === 0 ? '没有符合条件的笔记' : `共 ${count} 条笔记`;
}

function setSectionExpanded(header, content, expanded) {
  if (!header) return;
  const isExpanded = Boolean(expanded);
  header.classList.toggle('collapsed', !isExpanded);
  header.setAttribute('aria-expanded', String(isExpanded));
  if (content) {
    content.hidden = !isExpanded;
    content.style.display = isExpanded ? '' : 'none';
  }
}

function setMoreTagsExpanded(expanded) {
  const isExpanded = Boolean(expanded);
  if (el.tagTree) el.tagTree.classList.toggle('collapsed', !isExpanded);
  if (el.moreTagsToggle) el.moreTagsToggle.setAttribute('aria-expanded', String(isExpanded));
  if (el.moreTagsLabel) el.moreTagsLabel.textContent = isExpanded ? '收起标签' : '更多标签';
}

// ===== Initialize =====
async function init() {
  setConnectionStatus('checking');
  try {
    setupEvents();
    await loadPinnedTags();
    await Promise.all([loadTags(), loadDecks(), loadModels(), loadStats(), loadHeatmap()]);
    applyNoteModeUI();
    const notesLoaded = await loadNotes('*');
    if (!notesLoaded) throw new Error('无法加载笔记');
    setConnectionStatus('connected');
  } catch (e) {
    console.error('Init error:', e);
    setConnectionStatus('disconnected');
    showToast('无法连接 AnkiConnect，请打开 Anki 并检查 AnkiConnect 后重试', 'error');
  }
}

// ===== Tags =====
async function loadTags() {
  state.allTags = await anki.getTags();
  el.statTags.textContent = state.allTags.length;
  renderAllTags();
}

const CONFIG_FILE = '_ankimo_config.json';

async function loadPinnedTags() {
  try {
    const data = await anki.retrieveMediaFile(CONFIG_FILE);
    if (data) {
      const config = JSON.parse(data);
      state.pinnedTags = config.pinnedTags || [];
    }
  } catch (e) {
    console.warn('Load pinned tags from Anki failed, using localStorage fallback', e);
    state.pinnedTags = JSON.parse(localStorage.getItem('ankimo_pinned_tags') || '[]');
  }
}

async function savePinnedTags() {
  const config = JSON.stringify({ pinnedTags: state.pinnedTags });
  // Save to both Anki and localStorage (fallback)
  localStorage.setItem('ankimo_pinned_tags', JSON.stringify(state.pinnedTags));
  try {
    await anki.storeMediaFile(CONFIG_FILE, config);
  } catch (e) {
    console.warn('Save pinned tags to Anki failed', e);
  }
}

function togglePinTag(fullTag) {
  const idx = state.pinnedTags.indexOf(fullTag);
  if (idx >= 0) state.pinnedTags.splice(idx, 1);
  else state.pinnedTags.push(fullTag);
  savePinnedTags();
  renderAllTags();
}

function renderAllTags(filter = '') {
  const filterLower = filter.toLowerCase();
  const pinned = state.pinnedTags.filter(t => state.allTags.includes(t));

  // === Render pinned section: each pinned tag as a subtree with all descendants ===
  el.pinnedTags.innerHTML = '';
  pinned.forEach(pinnedTag => {
    // Collect this tag + all descendants
    const childPrefix = pinnedTag + '::';
    const descendants = state.allTags.filter(t => t === pinnedTag || t.startsWith(childPrefix));
    // Apply search filter
    const filtered = filterLower
      ? descendants.filter(t => t.toLowerCase().includes(filterLower))
      : descendants;
    if (filtered.length === 0) return;
    // Build tree using full tag paths, then render starting from the correct parent prefix
    const tree = buildTagTree(filtered);
    // Navigate the tree to find the pinned tag's node
    const parts = pinnedTag.split('::');
    let subtree = tree;
    let parentPath = '';
    for (let i = 0; i < parts.length - 1; i++) {
      if (subtree[parts[i]] && subtree[parts[i]]._children) {
        subtree = subtree[parts[i]]._children;
      }
      parentPath += (parentPath ? '::' : '') + parts[i];
    }
    // Now render starting from the last part of the pinned tag
    const lastPart = parts[parts.length - 1];
    if (subtree[lastPart]) {
      const pinnedSubtree = { [lastPart]: subtree[lastPart] };
      renderTagNodes(pinnedSubtree, el.pinnedTags, parentPath, true);
    }
  });

  // === Render full tree in "more tags" ===
  const filteredAll = filterLower
    ? state.allTags.filter(t => t.toLowerCase().includes(filterLower))
    : state.allTags;
  el.tagTree.innerHTML = '';
  const tree = buildTagTree(filteredAll);
  renderTagNodes(tree, el.tagTree, '', false);

  // Update count
  el.moreTagsCount.textContent = `(${state.allTags.length})`;
  // If searching, auto-expand
  if (filterLower) {
    setMoreTagsExpanded(true);
  }
}

function buildTagTree(tags) {
  const root = {};
  tags.forEach(tag => {
    const parts = tag.split('::');
    let current = root;
    for (const part of parts) {
      if (!current._children) current._children = {};
      if (!current._children[part]) current._children[part] = {};
      current = current._children[part];
    }
  });
  return root._children || {};
}

function renderTagNodes(nodes, container, prefix, isPinnedSection) {
  Object.keys(nodes).sort().forEach(name => {
    const fullTag = prefix ? `${prefix}::${name}` : name;
    const children = nodes[name]._children;
    const hasChildren = children && Object.keys(children).length > 0;
    const isPinned = state.pinnedTags.includes(fullTag);
    const node = document.createElement('div');
    node.className = 'tag-node';
    const row = document.createElement('div');
    row.className = 'tag-row';
    row.style.paddingLeft = `${12 + (prefix ? prefix.split('::').length * 16 : 0)}px`;
    row.innerHTML = `
      <button class="tag-filter-button" type="button" aria-label="按标签筛选 ${escHtml(fullTag)}"${hasChildren ? ' aria-expanded="true"' : ''}>
        <span class="tag-toggle${hasChildren ? '' : ' is-empty'}" aria-hidden="true">${tagToggleIcon(true, hasChildren)}</span>
        <span class="tag-icon" aria-hidden="true"></span>
        <span class="tag-name">${escHtml(name)}</span>
      </button>
      <button class="tag-pin ${isPinned ? 'pinned' : ''}" data-tag="${escHtml(fullTag)}" type="button" aria-label="${isPinned ? '取消固定' : '固定'}标签 ${escHtml(fullTag)}" aria-pressed="${isPinned}"></button>
    `;
    const filterButton = row.querySelector('.tag-filter-button');
    filterButton.addEventListener('click', (e) => {
      if (hasChildren && e.target.closest('.tag-toggle')) {
        const childEl = node.querySelector('.tag-children');
        if (childEl) {
          setTagNodeExpanded(filterButton, childEl, childEl.classList.contains('collapsed'));
        }
        return;
      }
      setFilter(`tag:${fullTag}`, `标签: ${fullTag}`);
      setActiveItem(row, '.tag-row');
    });
    row.querySelector('.tag-pin').addEventListener('click', (e) => {
      e.stopPropagation();
      togglePinTag(fullTag);
    });
    node.appendChild(row);
    if (hasChildren) {
      const childContainer = document.createElement('div');
      childContainer.className = 'tag-children';
      renderTagNodes(children, childContainer, fullTag, isPinnedSection);
      node.appendChild(childContainer);
    }
    container.appendChild(node);
  });
}

function tagToggleIcon(expanded, hasChildren) {
  if (!hasChildren) return '';
  const path = expanded ? 'M1 1l5 5 5-5' : 'M1 1l5 5 5 5';
  return `<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="${path}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.25" /></svg>`;
}

function setTagNodeExpanded(row, childEl, expanded) {
  const isExpanded = Boolean(expanded);
  childEl.classList.toggle('collapsed', !isExpanded);
  row.setAttribute('aria-expanded', String(isExpanded));
  const toggle = row.querySelector('.tag-toggle');
  if (toggle) toggle.innerHTML = tagToggleIcon(isExpanded, true);
}

// ===== Decks =====
const MEMO_DECK = 'Ankimo';

function addDeckOption(deckName) {
  if (!el.deckSelect || !deckName) return;
  const exists = Array.from(el.deckSelect.options || []).some(option => option.value === deckName);
  if (!exists) {
    const opt = document.createElement('option');
    opt.value = deckName;
    opt.textContent = deckName;
    el.deckSelect.appendChild(opt);
  }
}

async function ensureDeck(deckName) {
  if (!deckName) throw new Error('未指定牌组');
  const decks = await anki.deckNames();
  if (!decks.includes(deckName)) await anki.createDeck(deckName);
  addDeckOption(deckName);
  if (el.deckSelect) el.deckSelect.value = deckName;
  return deckName;
}

async function loadDecks() {
  const decks = await anki.deckNames();
  if (el.deckList) el.deckList.innerHTML = '';
  if (el.deckSelect) el.deckSelect.innerHTML = '';
  decks.forEach(d => {
    // Sidebar
    if (el.deckList) {
      const item = document.createElement('div');
      item.className = 'deck-item';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', `按牌组筛选 ${d}`);
      item.innerHTML = `<span class="deck-icon" aria-hidden="true"></span><span>${escHtml(d)}</span>`;
      const filterDeck = () => {
        setFilter(`deck:"${d}"`, `牌组: ${d}`);
        setActiveItem(item, '.deck-item');
      };
      item.addEventListener('click', filterDeck);
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          filterDeck();
        }
      });
      el.deckList.appendChild(item);
    }
    // Select
    addDeckOption(d);
  });
  // The memo flow always uses Ankimo. If it already exists, make it the
  // default; creation is deferred until the first memo is saved.
  if (el.deckSelect) {
    const defaultDeck = decks.includes(MEMO_DECK) ? MEMO_DECK : decks[0];
    if (defaultDeck) el.deckSelect.value = defaultDeck;
  }
}

// ===== Models =====
async function loadModels() {
  const models = await anki.modelNames();
  if (!el.modelSelect) return;
  el.modelSelect.innerHTML = '';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    el.modelSelect.appendChild(opt);
  });
}

// ===== Note Modes =====
function setAnswerVisibility(hidden) {
  if (el.backInput) {
    el.backInput.disabled = hidden;
    el.backInput.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    el.backInput.style.display = hidden ? 'none' : '';
    if (hidden) el.backInput.value = '';
  }
  // These wrappers are used by the newer input DOM when present. Keep this
  // optional because the logic can be loaded before that DOM is merged.
  el.inputCard?.querySelectorAll('[data-note-answer], .answer-field, .back-field').forEach(node => {
    if (node !== el.backInput) node.style.display = hidden ? 'none' : '';
  });
}

function applyNoteModeUI() {
  const isMemo = state.noteMode === 'memo';
  if (el.modeDescription) el.modeDescription.textContent = modeDescriptions[state.noteMode];
  if (el.frontInput) {
    el.frontInput.placeholder = isMemo ? '现在的想法是…' : '正面 / 问题...';
    el.frontInput.setAttribute('aria-label', isMemo ? '笔记内容' : '问题');
  }
  if (el.backInput) {
    el.backInput.placeholder = isMemo ? '' : '背面 / 答案...';
    el.backInput.setAttribute('aria-label', isMemo ? '笔记模式不使用答案' : '答案');
  }
  setAnswerVisibility(isMemo);

  // A memo has a fixed storage deck. QA keeps the selected deck as its
  // advanced override.
  if (el.deckSelect) {
    if (isMemo) {
      if (Array.from(el.deckSelect.options || []).some(option => option.value === MEMO_DECK)) {
        el.deckSelect.value = MEMO_DECK;
      }
      el.deckSelect.disabled = true;
    } else {
      el.deckSelect.disabled = false;
    }
  }

  [el.noteModeMemo, el.noteModeQa].forEach(input => {
    if (!input) return;
    const active = (input === el.noteModeMemo && isMemo) || (input === el.noteModeQa && !isMemo);
    input.checked = active;
    input.setAttribute('aria-checked', String(active));
    input.removeAttribute('aria-pressed');
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) {
      label.classList.toggle('active', active);
      label.dataset.checked = String(active);
    }
  });
  el.inputCard?.classList.toggle('memo-mode', isMemo);
  el.inputCard?.classList.toggle('qa-mode', !isMemo);
}

function noteModeMemo() {
  state.noteMode = 'memo';
  applyNoteModeUI();
}

function noteModeQa() {
  state.noteMode = 'qa';
  applyNoteModeUI();
}

// ===== Stats =====
async function loadStats() {
  const reviewed = await anki.getNumCardsReviewedToday();
  el.statReviewed.textContent = reviewed;
}

// ===== Heatmap =====
async function loadHeatmap() {
  try {
    const data = await anki.getNumCardsReviewedByDay();
    renderHeatmap(data);
  } catch { el.heatmap.innerHTML = ''; }
}

function renderHeatmap(data) {
  const weeks = 12, cellSize = 13, gap = 2, total = cellSize + gap;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build day map
  const dayMap = {};
  let maxCount = 1;
  data.forEach(([dateStr, count]) => {
    dayMap[dateStr] = count;
    if (count > maxCount) maxCount = count;
  });

  // Warm color palette (transparent → yellow → orange → red → dark red)
  const colors = [
    'rgba(255,255,255,.06)',
    '#4d3800',
    '#804d00',
    '#cc6600',
    '#e68a00',
    '#ffaa00'
  ];

  const cols = weeks;
  const rows = 7;
  const w = cols * total + 2;
  const h = rows * total + 2;

  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;

  for (let wi = 0; wi < cols; wi++) {
    for (let di = 0; di < 7; di++) {
      // Calculate date for this cell
      const todayDay = today.getDay() === 0 ? 6 : today.getDay() - 1; // Mon=0
      const daysAgo = (cols - 1 - wi) * 7 + (todayDay - di);
      const d = new Date(today);
      d.setDate(d.getDate() - daysAgo);
      const key = d.toISOString().split('T')[0];
      const count = dayMap[key] || 0;
      const intensity = count === 0 ? 0 : Math.min(5, Math.ceil((count / maxCount) * 5));
      const x = wi * total + 1;
      const y = di * total + 1;
      svg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${colors[intensity]}" data-date="${key}" data-count="${count}"></rect>`;
    }
  }
  svg += '</svg>';
  el.heatmap.innerHTML = svg;

  // Add tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'heatmap-tooltip';
  el.heatmap.appendChild(tooltip);

  el.heatmap.querySelectorAll('rect').forEach(rect => {
    rect.addEventListener('mouseenter', (e) => {
      const date = rect.dataset.date;
      const count = rect.dataset.count;
      tooltip.textContent = `${date}：${count} 张卡片`;
      tooltip.classList.add('visible');
      const r = rect.getBoundingClientRect();
      const c = el.heatmap.getBoundingClientRect();
      tooltip.style.left = `${r.left - c.left + r.width / 2 - tooltip.offsetWidth / 2}px`;
      tooltip.style.top = `${r.top - c.top - tooltip.offsetHeight - 4}px`;
    });
    rect.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });
    // Click to filter by review date
    rect.style.cursor = 'pointer';
    rect.addEventListener('click', () => {
      const date = rect.dataset.date;
      const count = parseInt(rect.dataset.count);
      if (count === 0) return;
      // Convert date to Unix ms timestamp range (start of day to end of day)
      const dayStart = new Date(date + 'T00:00:00');
      const dayEnd = new Date(date + 'T23:59:59');
      const startMs = dayStart.getTime();
      const endMs = dayEnd.getTime();
      const query = `rid:${startMs}:${endMs}`;
      setFilter(query, `${date} 复习的卡片 (${count}张)`);
      // Highlight the clicked cell
      el.heatmap.querySelectorAll('rect').forEach(r => r.removeAttribute('stroke'));
      rect.setAttribute('stroke', '#ffaa00');
      rect.setAttribute('stroke-width', '2');
      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        el.sidebar.classList.remove('open');
        el.overlay.classList.remove('active');
      }
    });
  });

  // === Compute review stats ===
  computeReviewStats(data, dayMap);
}

function computeReviewStats(data, dayMap) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Determine date range from data
  const allDates = data.map(([d]) => d).sort();
  if (allDates.length === 0) {
    $('statDailyAvg').textContent = '0';
    $('statDaysLearned').textContent = '0%';
    $('statCurrentStreak').textContent = '0天';
    $('statLongestStreak').textContent = '0天';
    return;
  }

  // Daily average: total reviews / total days in range
  const totalReviews = data.reduce((sum, [, c]) => sum + c, 0);
  const firstDate = new Date(allDates[0]);
  const lastDate = new Date(allDates[allDates.length - 1]);
  const totalDaysInRange = Math.max(1, Math.round((lastDate - firstDate) / 86400000) + 1);
  const dailyAvg = Math.round(totalReviews / totalDaysInRange);

  // Days learned: days with reviews / total days in range
  const daysWithReviews = data.filter(([, c]) => c > 0).length;
  const daysLearnedPct = Math.round((daysWithReviews / totalDaysInRange) * 100);

  // Current streak: consecutive days ending today (or yesterday)
  let currentStreak = 0;
  let checkDate = new Date(today);
  // If no reviews today, start checking from yesterday
  const todayKey = checkDate.toISOString().split('T')[0];
  if (!dayMap[todayKey] || dayMap[todayKey] === 0) {
    checkDate.setDate(checkDate.getDate() - 1);
  }
  while (true) {
    const key = checkDate.toISOString().split('T')[0];
    if (dayMap[key] && dayMap[key] > 0) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  // Longest streak
  let longestStreak = 0;
  let tempStreak = 0;
  const sortedDates = data.filter(([, c]) => c > 0).map(([d]) => d).sort();
  for (let i = 0; i < sortedDates.length; i++) {
    if (i === 0) {
      tempStreak = 1;
    } else {
      const prev = new Date(sortedDates[i - 1]);
      const curr = new Date(sortedDates[i]);
      const diff = Math.round((curr - prev) / 86400000);
      if (diff === 1) {
        tempStreak++;
      } else {
        tempStreak = 1;
      }
    }
    if (tempStreak > longestStreak) longestStreak = tempStreak;
  }

  // Update DOM
  $('statDailyAvg').textContent = dailyAvg;
  $('statDaysLearned').textContent = `${daysLearnedPct}%`;
  $('statCurrentStreak').textContent = `${currentStreak}天`;
  $('statLongestStreak').textContent = `${longestStreak}天`;
}

// ===== Notes =====
async function loadNotes(query) {
  if (state.loading) return;
  state.loading = true;
  state.currentQuery = query;
  state.notesLoaded = 0;
  el.notesList.innerHTML = '';
  el.loading.style.display = 'flex';
  el.emptyState.style.display = 'none';
  if (el.streamCount) el.streamCount.textContent = '正在加载笔记';
  let loaded = false;
  try {
    // Card-level queries (rid:, flag:) need findCards → cardsToNotes
    const isFlagQuery = /^flag:\d+$/.test(query);
    if (isFlagQuery && !/^flag:[123]$/.test(query)) {
      throw new Error('仅支持红旗、橙旗、绿旗筛选');
    }
    const isCardQuery = /^flag:[123]$/.test(query);
    if (query.startsWith('rid:')) {
      const match = query.match(/^rid:(\d+):(\d+)$/);
      if (match) {
        const startMs = parseInt(match[1]);
        const endMs = parseInt(match[2]);
        // Get all decks and fetch reviews from each
        const decks = await anki.deckNames();
        const allCardIds = new Set();
        for (const deck of decks) {
          const reviews = await anki.cardReviews(deck, startMs);
          // Each review is [reviewTime, cardID, ...]
          reviews.forEach(r => {
            if (r[0] >= startMs && r[0] <= endMs) {
              allCardIds.add(r[1]);
            }
          });
        }
        if (allCardIds.size > 0) {
          const noteIds = await anki.cardsToNotes([...allCardIds]);
          state.noteIds = [...new Set(noteIds)];
        } else {
          state.noteIds = [];
        }
      } else {
        state.noteIds = [];
      }
    } else if (isCardQuery) {
      // flag: is a card-level property, use findCards → cardsToNotes
      const cardIds = await anki.findCards(query);
      if (cardIds.length > 0) {
        const noteIds = await anki.cardsToNotes(cardIds);
        state.noteIds = [...new Set(noteIds)];
      } else {
        state.noteIds = [];
      }
    } else {
      state.noteIds = await anki.findNotes(query);
    }
    state.noteIds.reverse(); // newest first
    el.statNotes.textContent = state.noteIds.length;
    updateStreamCount();
    if (state.noteIds.length === 0) {
      el.emptyState.style.display = 'block';
    } else {
      await loadMoreNotes();
    }
    loaded = true;
  } catch (e) {
    console.error('Load notes error:', e);
    setConnectionStatus('disconnected');
    if (el.streamCount) el.streamCount.textContent = '笔记加载失败，请检查本地 Anki 连接后重试';
    showToast('加载笔记失败: ' + e.message, 'error');
  }
  el.loading.style.display = 'none';
  state.loading = false;
  return loaded;
}

async function loadMoreNotes() {
  const start = state.notesLoaded;
  const end = Math.min(start + state.batchSize, state.noteIds.length);
  if (start >= state.noteIds.length) return;
  const batch = state.noteIds.slice(start, end);
  const notes = await anki.notesInfo(batch);
  notes.forEach(note => renderNoteCard(note));
  state.notesLoaded = end;
  updateStreamCount();
}

function noteFieldValue(field) {
  if (field && typeof field === 'object') return String(field.value || '');
  return String(field || '');
}

function isBlankHtml(value) {
  const div = document.createElement('div');
  div.innerHTML = noteFieldValue(value);
  return (div.textContent || '').replace(/\u00a0/g, ' ').trim() === '';
}

function createNoteCard(note) {
  const card = document.createElement('article');
  card.className = 'note-card';
  card.dataset.noteId = note.noteId;
  const fields = Object.entries(note.fields || {}).slice(0, 2);
  const frontField = fields[0] || ['', ''];
  const backField = fields[1] || ['', ''];
  const hasAnswer = !isBlankHtml(backField[1]);
  const noteTypeLabel = hasAnswer ? '问答卡' : '不复习';
  const noteTypeClass = hasAnswer ? 'note-type-qa' : 'note-type-memo';
  const fieldItems = hasAnswer
    ? [{ label: '问题', value: frontField[1], answer: false },
      { label: '答案', value: backField[1], answer: true }]
    : [{ label: '笔记', value: frontField[1], answer: false }];
  const fieldsHtml = fieldItems.map(item => `
    <div class="note-field${item.answer ? ' answer-field' : ''}">
      <div class="note-field-label">${item.label}</div>
      <div class="note-field-content${item.answer ? ' blurred' : ''}"${item.answer ? ` data-answer-reveal role="button" tabindex="0" aria-expanded="${!state.blurEnabled}" aria-label="${state.blurEnabled ? '显示答案' : '答案已显示'}"` : ''}>${sanitizeHtml(noteFieldValue(item.value))}</div>
    </div>
  `).join('');
  const tagsHtml = (note.tags || []).map(t =>
    `<span class="note-tag" data-tag="${escHtml(t)}">${escHtml(t)}</span>`
  ).join('');
  const modDate = note.mod ? new Date(note.mod * 1000) : null;
  const timeStr = modDate ? formatDate(modDate) : '';
  const timeHtml = modDate && !Number.isNaN(modDate.getTime())
    ? `<time class="note-time" datetime="${modDate.toISOString()}">${timeStr}</time>`
    : '<span class="note-time"></span>';
  const modelHtml = note.modelName
    ? `<span class="note-model">模板：${escHtml(note.modelName)}</span>`
    : '';
  card.innerHTML = `
    <div class="note-actions">
      <button class="edit-btn" data-id="${note.noteId}" type="button" aria-label="编辑笔记 ${note.noteId}">编辑</button>
      <button class="delete-btn" data-id="${note.noteId}" type="button" aria-label="删除笔记 ${note.noteId}">删除</button>
    </div>
    ${fieldsHtml}
    <div class="note-meta">
      ${tagsHtml}
      <span class="note-type ${noteTypeClass}">${noteTypeLabel}</span>
      ${modelHtml}
      ${timeHtml}
    </div>
  `;

  // Only answers are blurred. Memo cards have no answer section at all.
  const answerField = card.querySelector('[data-answer-reveal]');
  const toggleAnswer = (event) => {
    if (el.notesList?.classList.contains('show-answers')) return;
    const field = event.currentTarget;
    if (field.classList.contains('blurred')) {
      field.classList.remove('blurred');
      field.classList.add('revealed');
      field.setAttribute('aria-expanded', 'true');
      field.setAttribute('aria-label', '隐藏答案');
    } else {
      field.classList.remove('revealed');
      field.classList.add('blurred');
      field.setAttribute('aria-expanded', 'false');
      field.setAttribute('aria-label', '显示答案');
    }
  };
  answerField?.addEventListener('click', toggleAnswer);
  answerField?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleAnswer(event);
    }
  });
  card.querySelectorAll('.note-tag').forEach(tag => {
    const filterTag = () => {
      setFilter(`tag:${tag.dataset.tag}`, `标签: ${tag.dataset.tag}`);
    };
    tag.setAttribute('role', 'button');
    tag.setAttribute('tabindex', '0');
    tag.setAttribute('aria-label', `按标签筛选 ${tag.dataset.tag}`);
    tag.addEventListener('click', filterTag);
    tag.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        filterTag();
      }
    });
  });
  card.querySelector('.edit-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    openEditModal(parseInt(event.currentTarget.dataset.id, 10));
  });
  card.querySelector('.delete-btn')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (!confirm('确定删除这条笔记吗？')) return;
    try {
      await anki.deleteNotes([parseInt(event.currentTarget.dataset.id, 10)]);
      card.style.animation = 'fadeOut .3s ease';
      setTimeout(() => card.remove(), 300);
      state.noteIds = state.noteIds.filter(id => String(id) !== String(note.noteId));
      el.statNotes.textContent = state.noteIds.length;
      updateStreamCount();
      showToast('已删除');
    } catch (err) { showToast('删除失败: ' + err.message, 'error'); }
  });
  return card;
}

function renderNoteCard(note) {
  const card = createNoteCard(note);
  el.notesList?.appendChild(card);
}

// ===== Filter & Search =====
function setFilter(query, label) {
  state.currentFilter = query;
  el.filterInfo.style.display = 'flex';
  el.filterText.textContent = label;
  clearNavActive();
  loadNotes(query);
}

function clearFilter() {
  state.currentFilter = '';
  el.filterInfo.style.display = 'none';
  document.querySelectorAll('.tag-row.active, .deck-item.active, .flag-item.active').forEach(el => el.classList.remove('active'));
  el.navAll.classList.add('active');
  loadNotes('*');
}

function setActiveItem(item, selector) {
  document.querySelectorAll(`${selector}.active`).forEach(el => el.classList.remove('active'));
  item.classList.add('active');
  clearNavActive();
}

function clearNavActive() {
  el.navAll.classList.remove('active');
  el.navDaily.classList.remove('active');
}

// ===== Create Note =====
async function findMemoCards(noteId) {
  // addNote normally creates cards synchronously, but a short retry protects
  // against AnkiConnect returning before card generation is visible.
  for (let attempt = 0; attempt < 3; attempt++) {
    const cards = await anki.findCards(`nid:${noteId}`);
    if (cards && cards.length > 0) return cards;
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 120));
  }
  return [];
}

async function suspendMemoNote(noteId) {
  const cards = await findMemoCards(noteId);
  if (cards.length === 0) {
    throw new Error(`已创建 note ${noteId}，但没有找到对应卡片，无法确认暂停状态`);
  }
  await anki.suspend(cards);
  const suspended = await anki.areSuspended(cards);
  if (!Array.isArray(suspended) || suspended.length !== cards.length || !suspended.every(Boolean)) {
    throw new Error(`已创建 note ${noteId}，但回读确认并非所有卡片都已暂停`);
  }
  return cards;
}

async function createNote() {
  const isMemo = state.noteMode === 'memo';
  const front = el.frontInput?.value?.trim() || '';
  const back = el.backInput?.value?.trim() || '';
  if (!front) {
    showToast(isMemo ? '请输入笔记内容' : '请输入问题', 'error');
    return;
  }
  if (!isMemo && !back) {
    showToast('请输入答案', 'error');
    return;
  }
  const selectedDeck = el.deckSelect?.value || '';
  const model = el.modelSelect?.value || '';
  const tags = (el.tagInput?.value || '').trim().split(/\s+/).filter(Boolean);
  if (!model) {
    showToast('请先选择笔记模板', 'error');
    return;
  }
  if (el.saveBtn) el.saveBtn.disabled = true;
  let noteId = null;
  try {
    const deck = isMemo ? await ensureDeck(MEMO_DECK) : selectedDeck;
    if (!deck) throw new Error('请先选择牌组');

    // Get field names for the model
    let fieldNames = state.fieldCache[model];
    if (!fieldNames) {
      fieldNames = await anki.modelFieldNames(model);
      state.fieldCache[model] = fieldNames;
    }
    if (!fieldNames || fieldNames.length === 0) throw new Error('当前模板没有可用字段');
    if (!isMemo && fieldNames.length < 2) throw new Error('问答模式需要至少两个字段');

    const fields = {};
    if (fieldNames[0]) fields[fieldNames[0]] = front;
    // Memo cards are records only: the first model field holds the text and
    // every remaining field is deliberately empty.
    fieldNames.slice(1).forEach(name => { fields[name] = isMemo ? '' : (name === fieldNames[1] ? back : ''); });

    noteId = await anki.addNote(deck, model, fields, tags);
    if (!noteId) throw new Error('AnkiConnect 没有返回 note id，无法确认创建结果');
    state.lastCreatedNoteId = noteId;

    if (isMemo) {
      try {
        await suspendMemoNote(noteId);
      } catch (suspendError) {
        const error = new Error(`短笔记已创建，但暂停失败（note id: ${noteId}）：${suspendError.message}`);
        error.noteId = noteId;
        throw error;
      }
    }

    if (el.frontInput) el.frontInput.value = '';
    if (el.backInput) el.backInput.value = '';
    if (el.tagInput) el.tagInput.value = '';
    showToast(isMemo ? '短笔记已保存，已暂停' : '问答卡片已保存');
    if (state.currentQuery === '*' || !state.currentFilter) loadNotes('*');
  } catch (e) {
    if (noteId) {
      console.error('Created note requires manual handling:', { noteId, error: e });
      showToast(e.message, 'error');
    } else {
      showToast('保存失败: ' + e.message, 'error');
    }
  } finally {
    if (el.saveBtn) el.saveBtn.disabled = false;
  }
}

// ===== Infinite Scroll =====
function setupScroll() {
  if (!el.contentArea) return;
  el.contentArea.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = el.contentArea;
    if (scrollHeight - scrollTop - clientHeight < 200 && !state.loading && state.notesLoaded < state.noteIds.length) {
      state.loading = true;
      el.loading.style.display = 'flex';
      loadMoreNotes().then(() => {
        el.loading.style.display = 'none';
        state.loading = false;
      });
    }
  });
}

// ===== Events =====
function setupEvents() {
  if (state.eventsBound) return;
  el.saveBtn.addEventListener('click', createNote);
  el.clearFilter.addEventListener('click', clearFilter);
  el.syncBtn.addEventListener('click', async () => {
    el.syncBtn.disabled = true;
    setSyncStatus('busy');
    try {
      await anki.sync();
      await Promise.all([loadTags(), loadDecks(), loadModels(), loadStats(), loadHeatmap()]);
      const notesLoaded = await loadNotes(state.currentQuery || '*');
      if (!notesLoaded) throw new Error('笔记刷新失败');
      setSyncStatus('success');
      setConnectionStatus('connected');
      showToast('同步完成');
    }
    catch (e) {
      setSyncStatus('error');
      setConnectionStatus('disconnected');
      showToast('同步失败: ' + e.message, 'error');
    }
    finally {
      el.syncBtn.disabled = false;
    }
  });
  el.navAll.addEventListener('click', () => {
    clearFilter();
    el.navAll.classList.add('active');
  });
  el.navDaily.addEventListener('click', () => {
    setFilter('is:due', '每日回顾 (今日到期)');
    el.navDaily.classList.add('active');
  });
  // Search with debounce
  let searchTimer;
  el.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = el.searchInput.value.trim();
      if (q) { setFilter(q, `搜索: ${q}`); }
      else { clearFilter(); }
    }, 500);
  });
  el.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(searchTimer);
      const q = el.searchInput.value.trim();
      if (q) setFilter(q, `搜索: ${q}`);
      else clearFilter();
    }
  });
  [el.noteModeMemo, el.noteModeQa].forEach(input => input?.addEventListener('change', (e) => {
    if (!e.target.checked) return;
    e.target.value === 'qa' ? noteModeQa() : noteModeMemo();
  }));
  applyNoteModeUI();
  // Sidebar toggle for mobile
  el.menuBtn.addEventListener('click', () => {
    const isOpen = el.sidebar.classList.toggle('open');
    el.overlay.classList.toggle('active', isOpen);
    el.menuBtn.setAttribute('aria-expanded', String(isOpen));
    el.menuBtn.setAttribute('aria-label', isOpen ? '关闭侧栏' : '打开侧栏');
  });
  el.overlay.addEventListener('click', () => {
    el.sidebar.classList.remove('open');
    el.overlay.classList.remove('active');
    el.menuBtn.setAttribute('aria-expanded', 'false');
    el.menuBtn.setAttribute('aria-label', '打开侧栏');
  });
  // Mobile search expand/collapse
  el.searchToggle.addEventListener('click', () => {
    el.searchBox.classList.add('expanded');
    el.searchToggle.setAttribute('aria-expanded', 'true');
    el.searchInput.focus();
  });
  el.searchClose.addEventListener('click', () => {
    el.searchBox.classList.remove('expanded');
    el.searchToggle.setAttribute('aria-expanded', 'false');
  });
  el.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      el.searchBox.classList.remove('expanded');
      el.searchToggle.setAttribute('aria-expanded', 'false');
      el.searchInput.blur();
    }
  });
  // Tag section collapse
  if (el.tagHeader) {
    setSectionExpanded(el.tagHeader, el.tagContent, el.tagHeader.getAttribute('aria-expanded') !== 'false');
    el.tagHeader.addEventListener('click', () => {
      setSectionExpanded(el.tagHeader, el.tagContent, el.tagHeader.getAttribute('aria-expanded') !== 'true');
    });
  }
  // Tag search
  el.tagSearchInput.addEventListener('input', () => {
    renderAllTags(el.tagSearchInput.value.trim());
  });
  // More tags toggle
  setMoreTagsExpanded(el.moreTagsToggle.getAttribute('aria-expanded') === 'true');
  el.moreTagsToggle.addEventListener('click', () => {
    setMoreTagsExpanded(el.moreTagsToggle.getAttribute('aria-expanded') !== 'true');
  });
  // Section collapse
  if (el.deckHeader) {
    setSectionExpanded(el.deckHeader, el.deckList, el.deckHeader.getAttribute('aria-expanded') === 'true');
    el.deckHeader.addEventListener('click', () => {
      setSectionExpanded(el.deckHeader, el.deckList, el.deckHeader.getAttribute('aria-expanded') !== 'true');
    });
  }
  // Flag section collapse. Only Anki flags 1/2/3 are part of Ankimo's flow.
  const supportedFlags = new Set(['1', '2', '3']);
  document.querySelectorAll('.flag-item').forEach(item => {
    if (!supportedFlags.has(item.dataset.flag)) item.remove();
  });
  if (el.flagHeader && el.flagList) {
    setSectionExpanded(el.flagHeader, el.flagList, state.flagListExpanded);
    el.flagHeader.addEventListener('click', () => {
      state.flagListExpanded = !state.flagListExpanded;
      localStorage.setItem('ankimo_flags_expanded', String(state.flagListExpanded));
      setSectionExpanded(el.flagHeader, el.flagList, state.flagListExpanded);
    });
  }
  // Flag click to filter
  document.querySelectorAll('.flag-item').forEach(item => {
    item.addEventListener('click', () => {
      const flagNum = item.dataset.flag;
      const flagNames = { '1': '红旗', '2': '橙旗', '3': '绿旗' };
      if (!supportedFlags.has(flagNum)) return;
      setFilter(`flag:${flagNum}`, flagNames[flagNum]);
      // Highlight active flag
      document.querySelectorAll('.flag-item.active').forEach(f => f.classList.remove('active'));
      item.classList.add('active');
      clearNavActive();
    });
  });
  // Ctrl+K search focus
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      el.searchInput.focus();
    }
  });
  // Blur toggle (global)
  el.blurToggleBtn.addEventListener('click', toggleGlobalBlur);
  // Apply persisted state
  if (!state.blurEnabled) {
    el.notesList.classList.add('show-answers');
  }
  syncBlurBtnUI();
  setupScroll();
  setSyncStatus('idle');
  state.eventsBound = true;
}

// ===== Utilities =====
function escHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
function sanitizeHtml(html) {
  // Allow basic HTML from Anki but strip scripts
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '');
}
function formatDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2000);
  setTimeout(() => t.remove(), 2500);
}

// Add fadeOut animation
const style = document.createElement('style');
style.textContent = '@keyframes fadeOut { to { opacity: 0; transform: translateY(-8px); } }';
document.head.appendChild(style);

// ===== Edit Note Modal =====
const editState = { noteId: null, fields: {}, saving: false };

async function openEditModal(noteId) {
  const overlay = document.getElementById('editModalOverlay');
  const body = document.getElementById('editModalBody');
  const metaEl = document.getElementById('editModalMeta');
  const tagsInput = document.getElementById('editTagsInput');
  const saveBtn = document.getElementById('editModalSave');

  // Show modal with loading state
  overlay.style.display = 'flex';
  body.innerHTML = '<div class="edit-loading">加载中...</div>';
  metaEl.textContent = '';
  tagsInput.value = '';
  saveBtn.disabled = false;

  try {
    const notes = await anki.notesInfo([noteId]);
    if (!notes || notes.length === 0) throw new Error('未找到笔记');
    const note = notes[0];
    editState.noteId = noteId;
    editState.fields = note.fields;

    // Meta info
    metaEl.innerHTML = `
      <span class="edit-meta-chip">模板：${escHtml(note.modelName)}</span>
      <span class="edit-meta-chip">note：${noteId}</span>
    `;

    // Build field editors
    body.innerHTML = '';
    Object.entries(note.fields).forEach(([name, field]) => {
      const group = document.createElement('div');
      group.className = 'edit-field-group';
      group.innerHTML = `
        <label class="edit-field-label">${escHtml(name)}</label>
        <textarea class="edit-field-textarea" data-field="${escHtml(name)}" rows="3">${escHtml(field.value)}</textarea>
      `;
      // Auto-expand textarea
      const ta = group.querySelector('textarea');
      ta.addEventListener('input', () => autoResizeTextarea(ta));
      body.appendChild(group);
      // Initial resize
      requestAnimationFrame(() => autoResizeTextarea(ta));
    });

    // Tags
    tagsInput.value = (note.tags || []).join(' ');

    // Focus first field
    const firstTa = body.querySelector('textarea');
    if (firstTa) firstTa.focus();

  } catch (e) {
    body.innerHTML = `<div class="edit-loading" style="color:var(--danger)">加载失败: ${escHtml(e.message)}</div>`;
  }
}

function autoResizeTextarea(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(60, ta.scrollHeight) + 'px';
}

async function saveEdit() {
  if (editState.saving || !editState.noteId) return;
  editState.saving = true;
  const saveBtn = document.getElementById('editModalSave');
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';

  try {
    const body = document.getElementById('editModalBody');
    const tagsInput = document.getElementById('editTagsInput');

    // Collect fields
    const fields = {};
    body.querySelectorAll('.edit-field-textarea').forEach(ta => {
      fields[ta.dataset.field] = ta.value;
    });

    // Collect tags
    const tags = tagsInput.value.trim().split(/\s+/).filter(Boolean);

    // Call API
    await anki.updateNote(editState.noteId, fields, tags);

    // Update the card in DOM without full reload
    await refreshNoteCard(editState.noteId);

    closeEditModal();
    showToast('笔记已更新');
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
  editState.saving = false;
  saveBtn.disabled = false;
  saveBtn.textContent = '保存';
}

async function refreshNoteCard(noteId) {
  const card = document.querySelector(`.note-card[data-note-id="${noteId}"]`);
  if (!card) return;
  try {
    const notes = await anki.notesInfo([noteId]);
    if (!notes || notes.length === 0) return;
    const note = notes[0];
    const newCard = createNoteCard(note);
    // Animate update
    newCard.style.animation = 'editPulse .5s ease';
    card.replaceWith(newCard);
  } catch (e) {
    console.error('Refresh card failed:', e);
  }
}

function closeEditModal() {
  document.getElementById('editModalOverlay').style.display = 'none';
  editState.noteId = null;
  editState.saving = false;
}

// Wire edit modal buttons
document.getElementById('editModalCancel').addEventListener('click', closeEditModal);
document.getElementById('editModalSave').addEventListener('click', saveEdit);
document.getElementById('editModalOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeEditModal();
});
// Keyboard shortcuts in modal
document.addEventListener('keydown', (e) => {
  if (document.getElementById('editModalOverlay').style.display === 'flex') {
    if (e.key === 'Escape') closeEditModal();
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveEdit();
    }
  }
});

// ===== Blur Toggle =====
function toggleGlobalBlur() {
  state.blurEnabled = !state.blurEnabled;
  localStorage.setItem('ankimo_blur_enabled', state.blurEnabled);

  if (state.blurEnabled) {
    // Re-blur: remove .show-answers from parent, restore all individually revealed cards
    el.notesList.classList.remove('show-answers');
    document.querySelectorAll('.note-field-content.revealed').forEach(f => {
      f.classList.remove('revealed');
      f.classList.add('blurred');
    });
  } else {
    // Show all: add .show-answers to parent (CSS cascade overrides .blurred)
    el.notesList.classList.add('show-answers');
  }
  syncBlurBtnUI();
}

function syncBlurBtnUI() {
  if (!el.blurToggleBtn) return;
  el.blurToggleBtn.textContent = state.blurEnabled ? '隐藏答案' : '显示答案';
  el.blurToggleBtn.classList.toggle('active', state.blurEnabled);
}

// ===== Start =====
init();
