// ===== AnkiConnect API Wrapper =====
class AnkiConnect {
  constructor(url = 'http://127.0.0.1:8765') { this.url = url; }
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
}

// ===== App State =====
const anki = new AnkiConnect();
const state = {
  currentFilter: '',
  currentQuery: '*',
  allTags: [],
  noteIds: [],
  notesLoaded: 0,
  batchSize: 30,
  loading: false,
  fieldCache: {}
};

// ===== DOM Refs =====
const $ = id => document.getElementById(id);
const el = {
  tagTree: $('tagTree'), deckList: $('deckList'), notesList: $('notesList'),
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
  renderTagTree();
}

function buildTagTree(tags) {
  const root = {};
  tags.forEach(tag => {
    const parts = tag.split('::');
    let node = root;
    parts.forEach(p => { if (!node[p]) node[p] = {}; node[p] = node[p]; });
    // build nested
    let current = root;
    for (const part of parts) {
      if (!current._children) current._children = {};
      if (!current._children[part]) current._children[part] = {};
      current = current._children[part];
    }
  });
  return root._children || {};
}

function renderTagTree() {
  const tree = buildTagTree(state.allTags);
  el.tagTree.innerHTML = '';
  renderTagNodes(tree, el.tagTree, '');
}

function renderTagNodes(nodes, container, prefix) {
  Object.keys(nodes).sort().forEach(name => {
    const fullTag = prefix ? `${prefix}::${name}` : name;
    const children = nodes[name]._children;
    const hasChildren = children && Object.keys(children).length > 0;
    const node = document.createElement('div');
    node.className = 'tag-node';
    const row = document.createElement('div');
    row.className = 'tag-row';
    row.style.paddingLeft = `${12 + (prefix ? prefix.split('::').length * 16 : 0)}px`;
    row.innerHTML = `
      <span class="tag-toggle">${hasChildren ? '▸' : ''}</span>
      <span class="tag-icon">#</span>
      <span class="tag-name">${name}</span>
    `;
    row.addEventListener('click', (e) => {
      e.stopPropagation();
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
      renderTagNodes(children, childContainer, fullTag);
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
  const weeks = 16, cellSize = 10, gap = 2, total = cellSize + gap;
  const today = new Date();
  const dayMap = {};
  let maxCount = 1;
  data.forEach(([dateStr, count]) => {
    dayMap[dateStr] = count;
    if (count > maxCount) maxCount = count;
  });
  const cols = weeks;
  const rows = 7;
  const w = cols * total + 2;
  const h = rows * total + 2;
  let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`;
  for (let wi = cols - 1; wi >= 0; wi--) {
    for (let di = 0; di < 7; di++) {
      const daysAgo = (cols - 1 - wi) * 7 + (6 - di) + (today.getDay());
      const d = new Date(today);
      d.setDate(d.getDate() - daysAgo + today.getDay());
      const key = d.toISOString().split('T')[0];
      const count = dayMap[key] || 0;
      const intensity = count === 0 ? 0 : Math.min(4, Math.ceil((count / maxCount) * 4));
      const colors = ['rgba(255,255,255,.06)', '#0e4429', '#006d32', '#26a641', '#39d353'];
      const x = wi * total + 1;
      const y = di * total + 1;
      svg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${colors[intensity]}" title="${key}: ${count}"><title>${key}: ${count}</title></rect>`;
    }
  }
  svg += '</svg>';
  el.heatmap.innerHTML = svg;
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
    state.noteIds = await anki.findNotes(query);
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
  const fieldsHtml = fields.slice(0, 2).map(([name, f]) => `
    <div class="note-field">
      <div class="note-field-label">${escHtml(name)}</div>
      <div class="note-field-content">${sanitizeHtml(f.value)}</div>
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
  document.querySelectorAll('.tag-row.active, .deck-item.active').forEach(el => el.classList.remove('active'));
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
  // Section collapse
  $('tagHeader').addEventListener('click', () => {
    $('tagHeader').classList.toggle('collapsed');
    el.tagTree.style.display = $('tagHeader').classList.contains('collapsed') ? 'none' : '';
  });
  $('deckHeader').addEventListener('click', () => {
    $('deckHeader').classList.toggle('collapsed');
    el.deckList.style.display = $('deckHeader').classList.contains('collapsed') ? 'none' : '';
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
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
