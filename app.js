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
  deleteNotes(notes) { return this.invoke('deleteNotes', { notes }); }
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
  fieldCache: {}
};

// ===== DOM Refs =====
const $ = id => document.getElementById(id);
const el = {
  tagTree: $('tagTree'), pinnedTags: $('pinnedTags'), deckList: $('deckList'),
  notesList: $('notesList'), tagSearchInput: $('tagSearchInput'),
  moreTagsToggle: $('moreTagsToggle'), moreTagsCount: $('moreTagsCount'),
  searchInput: $('searchInput'), deckSelect: $('deckSelect'), modelSelect: $('modelSelect'),
  tagInput: $('tagInput'), frontInput: $('frontInput'), backInput: $('backInput'),
  saveBtn: $('saveBtn'), syncBtn: $('syncBtn'), loading: $('loading'),
  emptyState: $('emptyState'), filterInfo: $('filterInfo'),
  filterText: $('filterText'), clearFilter: $('clearFilter'),
  statNotes: $('statNotes'), statTags: $('statTags'), statReviewed: $('statReviewed'),
  heatmap: $('heatmap'), contentArea: $('contentArea'),
  sidebar: $('sidebar'), menuBtn: $('menuBtn'), overlay: $('overlay'),
  navAll: $('navAll'), navDaily: $('navDaily')
};

// ===== Initialize =====
async function init() {
  try {
    await loadPinnedTags();
    await Promise.all([loadTags(), loadDecks(), loadModels(), loadStats(), loadHeatmap()]);
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
      <span class="tag-pin ${isPinned ? 'pinned' : ''}" data-tag="${escHtml(fullTag)}">${isPinned ? '⭐' : '☆'}</span>
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
async function loadDecks() {
  const decks = await anki.deckNames();
  el.deckList.innerHTML = '';
  el.deckSelect.innerHTML = '';
  decks.forEach(d => {
    // Sidebar
    const item = document.createElement('div');
    item.className = 'deck-item';
    item.innerHTML = `<span class="deck-icon">📁</span><span>${d}</span>`;
    item.addEventListener('click', () => {
      setFilter(`deck:"${d}"`, `牌组: ${d}`);
      setActiveItem(item, '.deck-item');
    });
    el.deckList.appendChild(item);
    // Select
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    el.deckSelect.appendChild(opt);
  });
}

// ===== Models =====
async function loadModels() {
  const models = await anki.modelNames();
  el.modelSelect.innerHTML = '';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    el.modelSelect.appendChild(opt);
  });
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
      setFilter(query, `📅 ${date} 复习的卡片 (${count}张)`);
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
    const isCardQuery = query.startsWith('flag:');
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

function renderNoteCard(note) {
  const card = document.createElement('div');
  card.className = 'note-card';
  card.dataset.noteId = note.noteId;
  const fields = Object.entries(note.fields);
  const fieldsHtml = fields.slice(0, 2).map(([name, f], idx) => `
    <div class="note-field">
      <div class="note-field-label">${escHtml(name)}</div>
      <div class="note-field-content${idx === 1 ? ' blurred' : ''}">${sanitizeHtml(f.value)}</div>
    </div>
  `).join('');
  const tagsHtml = (note.tags || []).map(t =>
    `<span class="note-tag" data-tag="${escHtml(t)}">${escHtml(t)}</span>`
  ).join('');
  const modDate = note.mod ? new Date(note.mod * 1000) : null;
  const timeStr = modDate ? formatDate(modDate) : '';
  card.innerHTML = `
    <div class="note-actions">
      <button class="delete-btn" title="删除" data-id="${note.noteId}">🗑️</button>
    </div>
    ${fieldsHtml}
    <div class="note-meta">
      ${tagsHtml}
      <span class="note-deck">${escHtml(note.modelName || '')}</span>
      <span class="note-time">${timeStr}</span>
    </div>
  `;
  // Blurred answer toggle (frosted glass)
  card.querySelectorAll('.note-field-content.blurred').forEach(field => {
    field.addEventListener('click', () => {
      if (field.classList.contains('blurred')) {
        field.classList.remove('blurred');
        field.classList.add('revealed');
      } else {
        field.classList.remove('revealed');
        field.classList.add('blurred');
      }
    });
  });
  // Tag click
  card.querySelectorAll('.note-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      setFilter(`tag:${tag.dataset.tag}`, `标签: ${tag.dataset.tag}`);
    });
  });
  // Delete
  card.querySelector('.delete-btn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('确定删除这条笔记吗？')) return;
    try {
      await anki.deleteNotes([parseInt(e.target.dataset.id)]);
      card.style.animation = 'fadeOut .3s ease';
      setTimeout(() => card.remove(), 300);
      showToast('已删除');
    } catch (err) { showToast('删除失败: ' + err.message, 'error'); }
  });
  el.notesList.appendChild(card);
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
async function createNote() {
  const front = el.frontInput.value.trim();
  const back = el.backInput.value.trim();
  if (!front) { showToast('请输入正面内容', 'error'); return; }
  const deck = el.deckSelect.value;
  const model = el.modelSelect.value;
  const tags = el.tagInput.value.trim().split(/\s+/).filter(Boolean);
  el.saveBtn.disabled = true;
  try {
    // Get field names for the model
    let fieldNames = state.fieldCache[model];
    if (!fieldNames) {
      fieldNames = await anki.modelFieldNames(model);
      state.fieldCache[model] = fieldNames;
    }
    const fields = {};
    if (fieldNames[0]) fields[fieldNames[0]] = front;
    if (fieldNames[1]) fields[fieldNames[1]] = back;
    await anki.addNote(deck, model, fields, tags);
    el.frontInput.value = '';
    el.backInput.value = '';
    el.tagInput.value = '';
    showToast('笔记已保存 ✓');
    if (state.currentQuery === '*' || !state.currentFilter) loadNotes('*');
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
  el.saveBtn.disabled = false;
}

// ===== Infinite Scroll =====
function setupScroll() {
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
  // Sidebar toggle for mobile
  el.menuBtn.addEventListener('click', () => {
    el.sidebar.classList.toggle('open');
    el.overlay.classList.toggle('active');
  });
  el.overlay.addEventListener('click', () => {
    el.sidebar.classList.remove('open');
    el.overlay.classList.remove('active');
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
  // Flag section collapse
  $('flagHeader').addEventListener('click', () => {
    $('flagHeader').classList.toggle('collapsed');
    $('flagList').style.display = $('flagHeader').classList.contains('collapsed') ? 'none' : '';
  });
  // Flag click to filter
  document.querySelectorAll('.flag-item').forEach(item => {
    item.addEventListener('click', () => {
      const flagNum = item.dataset.flag;
      const flagNames = { '1': '红旗', '2': '橙旗', '3': '绿旗', '4': '蓝旗', '5': '粉旗', '6': '青旗', '7': '紫旗' };
      setFilter(`flag:${flagNum}`, `🚩 ${flagNames[flagNum]}`);
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

// ===== Start =====
init();
