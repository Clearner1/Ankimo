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
  lastCreatedNoteId: null
};

// ===== DOM Refs =====
const $ = id => document.getElementById(id);
const el = {
  tagTree: $('tagTree'), pinnedTags: $('pinnedTags'), deckList: $('deckList'),
  notesList: $('notesList'), tagSearchInput: $('tagSearchInput'),
  moreTagsToggle: $('moreTagsToggle'), moreTagsCount: $('moreTagsCount'),
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
  flagHeader: $('flagHeader'), flagList: $('flagList'),
  noteModeMemo: $('noteModeMemo'), noteModeQa: $('noteModeQa'),
  noteMode: $('noteMode'), advancedSettings: $('advancedSettings')
};

// ===== Initialize =====
async function init() {
  try {
    await loadPinnedTags();
    await Promise.all([loadTags(), loadDecks(), loadModels(), loadStats(), loadHeatmap()]);
    applyNoteModeUI();
    await loadNotes('*');
    setupEvents();
  } catch (e) {
    console.error('Init error:', e);
    showToast('无法连接 AnkiConnect，请确保 Anki 已打开', 'error');
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
    el.tagTree.classList.remove('collapsed');
    el.moreTagsToggle.querySelector('span').textContent = '▾ 更多标签';
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
      <span class="tag-toggle">${hasChildren ? '▸' : ''}</span>
      <span class="tag-icon">#</span>
      <span class="tag-name">${name}</span>
      <span class="tag-pin ${isPinned ? 'pinned' : ''}" data-tag="${escHtml(fullTag)}">${isPinned ? '★' : '☆'}</span>
    `;
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.tag-pin')) {
        togglePinTag(fullTag);
        return;
      }
      if (hasChildren && e.target.closest('.tag-toggle')) {
        const childEl = node.querySelector('.tag-children');
        if (childEl) {
          childEl.classList.toggle('collapsed');
          row.querySelector('.tag-toggle').textContent = childEl.classList.contains('collapsed') ? '▸' : '▾';
        }
        return;
      }
      setFilter(`tag:${fullTag}`, `标签: ${fullTag}`);
      setActiveItem(row, '.tag-row');
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
      item.innerHTML = `<span class="deck-icon">•</span><span>${escHtml(d)}</span>`;
      item.addEventListener('click', () => {
        setFilter(`deck:"${d}"`, `牌组: ${d}`);
        setActiveItem(item, '.deck-item');
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

  [el.noteModeMemo, el.noteModeQa].forEach(button => {
    if (!button) return;
    const active = (button === el.noteModeMemo && isMemo) || (button === el.noteModeQa && !isMemo);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  if (el.noteMode && 'value' in el.noteMode) el.noteMode.value = state.noteMode;
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
    if (state.noteIds.length === 0) {
      el.emptyState.style.display = 'block';
    } else {
      await loadMoreNotes();
    }
  } catch (e) {
    console.error('Load notes error:', e);
    showToast('加载笔记失败: ' + e.message, 'error');
  }
  el.loading.style.display = 'none';
  state.loading = false;
}

async function loadMoreNotes() {
  const start = state.notesLoaded;
  const end = Math.min(start + state.batchSize, state.noteIds.length);
  if (start >= state.noteIds.length) return;
  const batch = state.noteIds.slice(start, end);
  const notes = await anki.notesInfo(batch);
  notes.forEach(note => renderNoteCard(note));
  state.notesLoaded = end;
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
  const card = document.createElement('div');
  card.className = 'note-card';
  card.dataset.noteId = note.noteId;
  const fields = Object.entries(note.fields || {}).slice(0, 2);
  const frontField = fields[0] || ['', ''];
  const backField = fields[1] || ['', ''];
  const hasAnswer = !isBlankHtml(backField[1]);
  const fieldItems = hasAnswer
    ? [{ label: '问题', value: frontField[1], answer: false },
      { label: '答案', value: backField[1], answer: true }]
    : [{ label: '笔记', value: frontField[1], answer: false }];
  const fieldsHtml = fieldItems.map(item => `
    <div class="note-field${item.answer ? ' answer-field' : ''}">
      <div class="note-field-label">${item.label}</div>
      <div class="note-field-content${item.answer ? ' blurred' : ''}">${sanitizeHtml(noteFieldValue(item.value))}</div>
    </div>
  `).join('');
  const tagsHtml = (note.tags || []).map(t =>
    `<span class="note-tag" data-tag="${escHtml(t)}">${escHtml(t)}</span>`
  ).join('');
  const modDate = note.mod ? new Date(note.mod * 1000) : null;
  const timeStr = modDate ? formatDate(modDate) : '';
  card.innerHTML = `
    <div class="note-actions">
      <button class="edit-btn" data-id="${note.noteId}">编辑</button>
      <button class="delete-btn" data-id="${note.noteId}">删除</button>
    </div>
    ${fieldsHtml}
    <div class="note-meta">
      ${tagsHtml}
      <span class="note-deck">${escHtml(note.modelName || '')}</span>
      <span class="note-time">${timeStr}</span>
    </div>
  `;

  // Only answers are blurred. Memo cards have no answer section at all.
  card.querySelector('.answer-field .note-field-content')?.addEventListener('click', (event) => {
    const field = event.currentTarget;
    if (field.classList.contains('blurred')) {
      field.classList.remove('blurred');
      field.classList.add('revealed');
    } else {
      field.classList.remove('revealed');
      field.classList.add('blurred');
    }
  });
  card.querySelectorAll('.note-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      setFilter(`tag:${tag.dataset.tag}`, `标签: ${tag.dataset.tag}`);
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
  el.saveBtn.addEventListener('click', createNote);
  el.clearFilter.addEventListener('click', clearFilter);
  el.syncBtn.addEventListener('click', async () => {
    el.syncBtn.classList.add('syncing');
    try { await anki.sync(); showToast('同步完成 ✓'); init(); }
    catch (e) { showToast('同步失败: ' + e.message, 'error'); }
    el.syncBtn.classList.remove('syncing');
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
  // Note mode controls are optional while the new input DOM is being merged.
  el.noteModeMemo?.addEventListener('click', noteModeMemo);
  el.noteModeQa?.addEventListener('click', noteModeQa);
  el.noteMode?.addEventListener('change', (e) => {
    e.target.value === 'qa' ? noteModeQa() : noteModeMemo();
  });
  applyNoteModeUI();
  // Sidebar toggle for mobile
  el.menuBtn.addEventListener('click', () => {
    el.sidebar.classList.toggle('open');
    el.overlay.classList.toggle('active');
  });
  el.overlay.addEventListener('click', () => {
    el.sidebar.classList.remove('open');
    el.overlay.classList.remove('active');
  });
  // Mobile search expand/collapse
  el.searchToggle.addEventListener('click', () => {
    el.searchBox.classList.add('expanded');
    el.searchInput.focus();
  });
  el.searchClose.addEventListener('click', () => {
    el.searchBox.classList.remove('expanded');
  });
  el.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      el.searchBox.classList.remove('expanded');
      el.searchInput.blur();
    }
  });
  // Tag section collapse
  $('tagHeader').addEventListener('click', () => {
    $('tagHeader').classList.toggle('collapsed');
    $('tagContent').style.display = $('tagHeader').classList.contains('collapsed') ? 'none' : '';
  });
  // Tag search
  el.tagSearchInput.addEventListener('input', () => {
    renderAllTags(el.tagSearchInput.value.trim());
  });
  // More tags toggle
  el.moreTagsToggle.addEventListener('click', () => {
    const isCollapsed = el.tagTree.classList.toggle('collapsed');
    el.moreTagsToggle.querySelector('span').textContent = isCollapsed ? '▸ 更多标签' : '▾ 更多标签';
  });
  // Section collapse
  $('deckHeader').addEventListener('click', () => {
    $('deckHeader').classList.toggle('collapsed');
    el.deckList.style.display = $('deckHeader').classList.contains('collapsed') ? 'none' : '';
  });
  // Flag section collapse. Only Anki flags 1/2/3 are part of Ankimo's flow.
  const supportedFlags = new Set(['1', '2', '3']);
  document.querySelectorAll('.flag-item').forEach(item => {
    if (!supportedFlags.has(item.dataset.flag)) item.remove();
  });
  if (el.flagHeader && el.flagList) {
    el.flagHeader.classList.toggle('collapsed', !state.flagListExpanded);
    el.flagList.style.display = state.flagListExpanded ? '' : 'none';
    el.flagHeader.addEventListener('click', () => {
      state.flagListExpanded = !state.flagListExpanded;
      localStorage.setItem('ankimo_flags_expanded', String(state.flagListExpanded));
      el.flagHeader.classList.toggle('collapsed', !state.flagListExpanded);
      el.flagList.style.display = state.flagListExpanded ? '' : 'none';
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
    showToast('笔记已更新 ✓');
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
