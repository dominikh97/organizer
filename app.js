'use strict';

const STORAGE_KEY = 'organizer.v1';
const THEME_KEY = 'organizer.theme';
const FULLSCREEN_KEY = 'organizer.editorFullscreen';
const LAYOUT_KEY = 'organizer.layout';
const TRASH_DAYS = 7;
const COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'];

const $ = (sel) => document.querySelector(sel);
const isPhone = () => window.matchMedia('(max-width: 700px)').matches;
// Touch screens without a mouse: no hover, no drag and drop.
const isTouch = () => window.matchMedia('(hover: none)').matches;

function storageGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
}

// ---------- State & persistence ----------

let state = load();
let view = 'notes';        // 'notes' | 'archive' | 'trash' | 'label:<name>'
let query = '';
let editingId = null;

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.notes)) {
      return { notes: data.notes, labels: Array.isArray(data.labels) ? data.labels : [] };
    }
  } catch (e) { /* fall through to defaults */ }
  return {
    labels: ['Personal', 'Work'],
    notes: [
      newNote({ title: 'Welcome to Organizer 👋', body: 'Click a note to edit it.\nPin, color, label, archive or delete notes with the buttons below each card.\nLinks like https://example.com are clickable.\nEverything is saved in your browser.', color: 'yellow', pinned: true }),
      newNote({ title: 'Groceries', items: [{ text: 'Milk', done: true }, { text: 'Bread', done: false }, { text: 'Coffee', done: false }], labels: ['Personal'], color: 'green' }),
    ],
  };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Could not save — storage may be full or disabled.');
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function newNote(fields = {}) {
  const now = Date.now();
  return {
    id: uid(),
    title: '',
    body: '',
    items: null,            // array of {text, done} when the note is a checklist
    color: 'default',
    pinned: false,
    archived: false,
    trashedAt: null,
    labels: [],
    created: now,
    updated: now,
    order: now,
    ...fields,
  };
}

function findNote(id) {
  return state.notes.find((n) => n.id === id);
}

function isEmpty(note) {
  const hasItems = note.items && note.items.some((i) => i.text.trim());
  return !note.title.trim() && !note.body.trim() && !hasItems;
}

function purgeOldTrash() {
  const cutoff = Date.now() - TRASH_DAYS * 86400000;
  const before = state.notes.length;
  state.notes = state.notes.filter((n) => !n.trashedAt || n.trashedAt > cutoff);
  if (state.notes.length !== before) save();
}

// ---------- Filtering ----------

function visibleNotes() {
  const q = query.trim().toLowerCase();
  return state.notes
    .filter((n) => {
      if (view === 'trash') return n.trashedAt;
      if (n.trashedAt) return false;
      if (view === 'archive') return n.archived;
      if (view.startsWith('label:')) return n.labels.includes(view.slice(6));
      return !n.archived;
    })
    .filter((n) => {
      if (!q) return true;
      const text = [n.title, n.body, ...(n.items || []).map((i) => i.text), ...n.labels].join('\n').toLowerCase();
      return text.includes(q);
    })
    .sort((a, b) => b.order - a.order);
}

// ---------- Rendering ----------

function render() {
  renderSidebar();
  const notes = visibleNotes();
  const splitPinned = view === 'notes' || view.startsWith('label:');
  const pinned = splitPinned ? notes.filter((n) => n.pinned) : [];
  const others = splitPinned ? notes.filter((n) => !n.pinned) : notes;

  fillGrid($('#pinnedGrid'), pinned);
  fillGrid($('#notesGrid'), others);
  $('#pinnedSection').hidden = pinned.length === 0;
  $('#othersTitle').hidden = pinned.length === 0 || others.length === 0;

  $('#composer').hidden = view === 'archive' || view === 'trash';
  $('#fabs').hidden = view === 'archive' || view === 'trash';
  $('#trashBar').hidden = view !== 'trash' || notes.length === 0;

  const empty = $('#emptyState');
  empty.hidden = notes.length > 0;
  if (!notes.length) {
    empty.textContent = query ? 'No matching notes'
      : view === 'archive' ? '📦 Your archived notes appear here'
      : view === 'trash' ? '🗑️ No notes in Trash'
      : view.startsWith('label:') ? '🏷️ No notes with this label yet'
      : '💡 Notes you add appear here';
  }
}

function renderSidebar() {
  const nav = $('#labelNav');
  nav.replaceChildren(...state.labels.map((label) => {
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.view = 'label:' + label;
    btn.title = label;
    btn.innerHTML = '<span class="ico">🏷️</span><span class="lbl"></span>';
    btn.querySelector('.lbl').textContent = label;
    return btn;
  }));
  document.querySelectorAll('.nav-item[data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
}

function fillGrid(grid, notes) {
  grid.replaceChildren(...notes.map(renderCard));
}

function renderCard(note) {
  const card = document.createElement('article');
  card.className = 'note';
  card.dataset.id = note.id;
  card.dataset.color = note.color;
  card.tabIndex = 0;
  const inTrash = !!note.trashedAt;
  card.classList.toggle('in-trash', inTrash);
  card.draggable = !inTrash && !query && !isTouch();

  if (!inTrash) {
    card.append(iconButton('📌', note.pinned ? 'Unpin' : 'Pin', 'pin' + (note.pinned ? ' on' : ''), () => {
      update(note, { pinned: !note.pinned, archived: false });
    }));
  }

  if (note.title) {
    const h = document.createElement('h3');
    h.append(linkify(note.title));
    card.append(h);
  }

  if (note.items) {
    const ul = document.createElement('ul');
    ul.className = 'checklist';
    // Unchecked items first, like Keep.
    const ordered = note.items.map((item, idx) => ({ item, idx }))
      .sort((a, b) => a.item.done - b.item.done);
    ordered.slice(0, 10).forEach(({ item, idx }) => {
      const li = document.createElement('li');
      li.classList.toggle('done', item.done);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.done;
      cb.disabled = inTrash;
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        note.items[idx].done = cb.checked;
        update(note, {});
      });
      const span = document.createElement('span');
      span.className = 'item-text';
      span.append(linkify(item.text));
      li.append(cb, span);
      ul.append(li);
    });
    if (note.items.length > 10) {
      const more = document.createElement('li');
      more.textContent = `… ${note.items.length - 10} more`;
      ul.append(more);
    }
    card.append(ul);
  } else if (note.body) {
    const div = document.createElement('div');
    div.className = 'body';
    div.append(linkify(note.body));
    card.append(div);
    // Mark long previews once laid out so they fade out and hint there's more.
    requestAnimationFrame(() => {
      if (div.scrollHeight > div.clientHeight + 1) {
        div.classList.add('clipped');
        const more = document.createElement('div');
        more.className = 'more';
        more.textContent = isTouch() ? 'Tap to read more…' : 'Click to read more…';
        div.after(more);
      }
    });
  }

  if (note.labels.length) card.append(chips(note.labels));

  const actions = document.createElement('div');
  actions.className = 'note-actions';
  if (inTrash) {
    actions.append(
      iconButton('♻️', 'Restore', '', () => update(note, { trashedAt: null }, 'Note restored')),
      iconButton('❌', 'Delete forever', '', () => deleteForever(note)),
    );
  } else {
    actions.append(
      iconButton('🎨', 'Background color', '', (btn) => {
        openFloatPalette(btn, note.color, (color) => update(note, { color }));
      }),
      iconButton(note.archived ? '📤' : '📦', note.archived ? 'Unarchive' : 'Archive', '', () => toggleArchive(note)),
      iconButton('🗑️', 'Delete', '', () => trash(note)),
    );
  }
  card.append(actions);

  card.addEventListener('click', () => openEditor(note.id));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === card) openEditor(note.id);
  });
  addDragHandlers(card);
  if (!inTrash) addSwipeHandlers(card, note);
  return card;
}

// Matches [label](url) links, bare web addresses and email addresses.
const LINK_RE = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|((?:https?:\/\/|www\.)[^\s<>"]*[^\s<>".,:;!?')\]])|([\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,})/gi;

function findLinks(text) {
  const links = [];
  for (const m of text.matchAll(LINK_RE)) {
    const [whole, label, labelUrl, bare, email] = m;
    let href;
    if (labelUrl) href = labelUrl;
    else if (bare) href = /^www\./i.test(bare) ? 'https://' + bare : bare;
    else href = 'mailto:' + email;
    links.push({ index: m.index, length: whole.length, text: label || bare || email, href });
  }
  return links;
}

function linkElement(link) {
  const a = document.createElement('a');
  a.href = link.href;
  a.textContent = link.text;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  // Follow the link instead of opening the note editor.
  a.addEventListener('click', (e) => e.stopPropagation());
  return a;
}

// Turn plain text into a fragment where links are clickable.
function linkify(text) {
  const frag = document.createDocumentFragment();
  let pos = 0;
  for (const link of findLinks(text)) {
    frag.append(text.slice(pos, link.index), linkElement(link));
    pos = link.index + link.length;
  }
  frag.append(text.slice(pos));
  return frag;
}

function iconButton(glyph, title, extraClass, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = ('icon-btn ' + extraClass).trim();
  b.title = title;
  b.setAttribute('aria-label', title);
  b.textContent = glyph;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(b);
  });
  return b;
}

function chips(labels) {
  const wrap = document.createElement('div');
  wrap.className = 'chips';
  labels.forEach((l) => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.textContent = l;
    wrap.append(c);
  });
  return wrap;
}

// ---------- Note actions ----------

function update(note, fields, message) {
  Object.assign(note, fields, { updated: Date.now() });
  save();
  render();
  if (editingId === note.id) renderEditorChrome();
  if (message) toast(message);
}

function toggleArchive(note) {
  const archived = !note.archived;
  update(note, { archived, pinned: archived ? false : note.pinned });
  toast(archived ? 'Note archived' : 'Note unarchived', () => update(note, { archived: !archived }));
}

function trash(note) {
  update(note, { trashedAt: Date.now() });
  toast('Note moved to Trash', () => update(note, { trashedAt: null }));
}

function deleteForever(note) {
  if (!confirm('Delete this note forever?')) return;
  state.notes = state.notes.filter((n) => n !== note);
  save();
  render();
}

// ---------- Composer ----------

const composer = $('#composer');
const newTitle = $('#newTitle');
const newBody = $('#newBody');
let composerColor = 'default';

function setComposerColor(color) {
  composerColor = color;
  composer.dataset.color = color;
}

function expandComposer() {
  newTitle.hidden = false;
  newBody.rows = 3;
  composer.querySelector('.composer-actions').hidden = false;
}

function collapseComposer() {
  const title = newTitle.value;
  const body = newBody.value;
  if (title.trim() || body.trim()) {
    const labels = view.startsWith('label:') ? [view.slice(6)] : [];
    state.notes.push(newNote({ title, body, labels, color: composerColor }));
    save();
    render();
  }
  newTitle.value = '';
  newBody.value = '';
  newBody.style.height = '';
  newBody.rows = 1;
  newTitle.hidden = true;
  composer.querySelector('.composer-actions').hidden = true;
  setComposerColor('default');
}

newBody.addEventListener('focus', expandComposer);
newBody.addEventListener('input', () => autoGrow(newBody));
composer.addEventListener('submit', (e) => {
  e.preventDefault();
  collapseComposer();
});
document.addEventListener('mousedown', (e) => {
  if (floatPalette.contains(e.target)) return;
  if (!floatPalette.hidden && e.target.closest('.icon-btn') !== floatPalette.anchor) floatPalette.hidden = true;
  if (!newTitle.hidden && !composer.contains(e.target) && !$('#editor').open) collapseComposer();
});

$('#newColorBtn').addEventListener('click', (e) => {
  openFloatPalette(e.currentTarget, composerColor, setComposerColor);
});

// Add a note and open it in the editor, ready for typing.
function createAndEdit(fields) {
  const labels = view.startsWith('label:') ? [view.slice(6)] : [];
  const note = newNote({ labels, ...fields });
  state.notes.push(note);
  render();
  openEditor(note.id, { focus: true });
}

// Move the draft into the large editor, which suits longer notes.
$('#newExpandBtn').addEventListener('click', () => {
  const fields = { title: newTitle.value, body: newBody.value, color: composerColor };
  newTitle.value = '';
  newBody.value = '';
  collapseComposer();
  createAndEdit(fields);
});

$('#fabNote').addEventListener('click', () => createAndEdit({}));
$('#fabList').addEventListener('click', () => createAndEdit({ items: [{ text: '', done: false }] }));

$('#newChecklistBtn').addEventListener('click', () => {
  // Turn whatever was typed into checklist items and open the full editor.
  const lines = newBody.value.split('\n').filter((l) => l.trim());
  const labels = view.startsWith('label:') ? [view.slice(6)] : [];
  const note = newNote({
    title: newTitle.value,
    items: lines.length ? lines.map((text) => ({ text, done: false })) : [{ text: '', done: false }],
    labels,
    color: composerColor,
  });
  state.notes.push(note);
  newTitle.value = '';
  newBody.value = '';
  collapseComposer();
  render();
  openEditor(note.id);
});

function autoGrow(el) {
  // A hidden box has nothing to measure; it is sized again once shown.
  if (!el.getClientRects().length) return;
  // Resizing briefly collapses the box, so keep scroll positions from jumping.
  const scroller = el.closest('.editor-scroll');
  const outerTop = scroller ? scroller.scrollTop : 0;
  const innerTop = el.scrollTop;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
  el.scrollTop = innerTop;
  if (scroller) scroller.scrollTop = outerTop;
}

// ---------- Editor ----------

const editor = $('#editor');
const editTitle = $('#editTitle');
const editBody = $('#editBody');
const editChecklist = $('#editChecklist');

// focus: true puts the cursor in the note for typing straight away. Otherwise
// touch devices open the note for reading, without popping up the keyboard.
function openEditor(id, { focus = false } = {}) {
  const note = findNote(id);
  if (!note) return;
  editingId = id;
  editTitle.value = note.title;
  editBody.value = note.body;
  renderEditorChrome();
  renderEditorChecklist();
  editor.showModal();
  replaceDrawerWith('editor');
  growEditorFields();
  editor.querySelector('.editor-scroll').scrollTop = 0;
  const inputs = editChecklist.querySelectorAll('.item-text');
  const target = note.items ? inputs[inputs.length - 1] : editBody;
  if (focus || (!isTouch() && note.items)) {
    target?.focus();
    if (target) target.setSelectionRange(target.value.length, target.value.length);
  } else if (isTouch()) {
    document.activeElement?.blur();
  }
}

// Fit the note text and every checklist item to its content.
function growEditorFields() {
  if (!editor.open) return;
  if (!editBody.hidden) autoGrow(editBody);
  editChecklist.querySelectorAll('.item-text').forEach(autoGrow);
}

// Clickable list of the links in the note, since links inside a text field can't be clicked.
function renderEditorLinks() {
  const note = currentNote();
  const box = $('#editLinks');
  if (!note) return;
  const text = [note.title, note.body, ...(note.items || []).map((i) => i.text)].join('\n');
  const seen = new Set();
  const links = findLinks(text).filter((l) => !seen.has(l.href) && seen.add(l.href));
  box.replaceChildren(...links.map((link) => {
    const row = linkElement(link);
    row.className = 'link-row';
    row.textContent = '🔗 ' + link.text;
    row.title = link.href;
    return row;
  }));
  box.hidden = links.length === 0;
}

function currentNote() {
  return editingId && findNote(editingId);
}

function renderEditorChrome() {
  const note = currentNote();
  if (!note) return;
  const inTrash = !!note.trashedAt;
  editor.dataset.color = note.color;
  editTitle.readOnly = editBody.readOnly = inTrash;
  editBody.hidden = !!note.items;
  editChecklist.hidden = !note.items;
  $('#pinBtn').classList.toggle('on', note.pinned);
  $('#pinBtn').title = note.pinned ? 'Unpin' : 'Pin';
  $('#archiveBtn').title = note.archived ? 'Unarchive' : 'Archive';
  $('#archiveBtn').textContent = note.archived ? '📤' : '📦';
  $('#toggleListBtn').title = note.items ? 'Convert to text' : 'Convert to checklist';
  ['#pinBtn', '#colorBtn', '#labelBtn', '#toggleListBtn', '#archiveBtn', '#deleteBtn'].forEach((s) => {
    $(s).hidden = inTrash;
  });
  $('#editLabels').replaceChildren(...(note.labels.length ? [chips(note.labels)] : []));
  const fmt = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  $('#editMeta').textContent = inTrash ? 'Note in Trash' : `Edited ${fmt(note.updated)}`;
  renderEditorLinks();
}

function renderEditorChecklist() {
  const note = currentNote();
  if (!note || !note.items) {
    editChecklist.replaceChildren();
    return;
  }
  const inTrash = !!note.trashedAt;
  const rows = note.items.map((item, idx) => {
    const li = document.createElement('li');
    li.classList.toggle('done', item.done);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = item.done;
    cb.disabled = inTrash;
    cb.addEventListener('change', () => {
      item.done = cb.checked;
      li.classList.toggle('done', item.done);
      touch(note);
    });
    const text = document.createElement('textarea');
    text.className = 'item-text';
    text.rows = 1;
    text.value = item.text;
    text.readOnly = inTrash;
    text.addEventListener('input', () => {
      item.text = text.value;
      autoGrow(text);
      touch(note);
      renderEditorLinks();
    });
    text.addEventListener('keydown', (e) => {
      // Enter starts a new item; Shift+Enter adds a line break inside this one.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        note.items.splice(idx + 1, 0, { text: '', done: false });
        touch(note);
        renderEditorChecklist();
        editChecklist.querySelectorAll('.item-text')[idx + 1].focus();
      } else if (e.key === 'Backspace' && !text.value && note.items.length > 1) {
        e.preventDefault();
        note.items.splice(idx, 1);
        touch(note);
        renderEditorChecklist();
        editChecklist.querySelectorAll('.item-text')[Math.max(0, idx - 1)].focus();
      }
    });
    li.append(cb, text);
    if (!inTrash) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'remove';
      rm.title = 'Remove item';
      rm.textContent = '✕';
      rm.addEventListener('click', () => {
        note.items.splice(idx, 1);
        touch(note);
        renderEditorChecklist();
      });
      li.append(rm);
    }
    return li;
  });
  if (!inTrash) {
    const addLi = document.createElement('li');
    const add = document.createElement('input');
    add.type = 'text';
    add.className = 'add-item';
    add.placeholder = '+ List item';
    add.addEventListener('input', () => {
      note.items.push({ text: add.value, done: false });
      touch(note);
      renderEditorChecklist();
      const inputs = editChecklist.querySelectorAll('.item-text');
      const target = inputs[inputs.length - 1];
      target.focus();
      target.setSelectionRange(target.value.length, target.value.length);
    });
    addLi.append(add);
    rows.push(addLi);
  }
  editChecklist.replaceChildren(...rows);
  editChecklist.querySelectorAll('.item-text').forEach(autoGrow);
}

// Persist an in-place edit without re-rendering the editor.
function touch(note) {
  note.updated = Date.now();
  save();
  render();
}

editTitle.addEventListener('input', () => {
  const note = currentNote();
  note.title = editTitle.value;
  touch(note);
  renderEditorLinks();
});
editBody.addEventListener('input', () => {
  const note = currentNote();
  note.body = editBody.value;
  autoGrow(editBody);
  touch(note);
  renderEditorLinks();
});

editor.addEventListener('close', () => {
  const note = currentNote();
  editingId = null;
  popOverlay('editor');
  $('#palette').hidden = true;
  $('#labelPicker').hidden = true;
  if (!note) return;
  if (note.items) note.items = note.items.filter((i) => i.text.trim());
  if (isEmpty(note) && !note.trashedAt) {
    state.notes = state.notes.filter((n) => n !== note);
  } else if (note.items && !note.items.length) {
    note.items = null;
  }
  save();
  render();
});

// Full-screen toggle for the editor, remembered between visits.
function setEditorFullscreen(on) {
  editor.classList.toggle('fullscreen', on);
  $('#expandBtn').textContent = on ? '⤡' : '⤢';
  $('#expandBtn').title = on ? 'Exit full screen' : 'Full screen';
}

try {
  setEditorFullscreen(localStorage.getItem(FULLSCREEN_KEY) === '1');
} catch (e) {
  setEditorFullscreen(false);
}

$('#expandBtn').addEventListener('click', () => {
  const on = !editor.classList.contains('fullscreen');
  setEditorFullscreen(on);
  growEditorFields();
  try { localStorage.setItem(FULLSCREEN_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
});

// Text rewraps when the window size changes, so refit it.
window.addEventListener('resize', growEditorFields);

$('#backBtn').addEventListener('click', () => editor.close());

// On phones the on-screen keyboard shrinks the visible area; size the editor to
// it so the toolbar stays above the keyboard.
if (window.visualViewport) {
  const fitViewport = () => {
    const vv = window.visualViewport;
    document.documentElement.style.setProperty('--vv-height', vv.height + 'px');
    document.documentElement.style.setProperty('--vv-top', vv.offsetTop + 'px');
  };
  window.visualViewport.addEventListener('resize', fitViewport);
  window.visualViewport.addEventListener('scroll', fitViewport);
  fitViewport();
}

// Close when clicking the backdrop.
editor.addEventListener('mousedown', (e) => {
  if (e.target === editor) editor.close();
});

$('#pinBtn').addEventListener('click', () => {
  const note = currentNote();
  update(note, { pinned: !note.pinned, archived: false });
});

$('#archiveBtn').addEventListener('click', () => {
  const note = currentNote();
  editor.close();
  if (findNote(note.id)) toggleArchive(note);
});

$('#deleteBtn').addEventListener('click', () => {
  const note = currentNote();
  editor.close();
  if (findNote(note.id)) trash(note);
});

$('#toggleListBtn').addEventListener('click', () => {
  const note = currentNote();
  if (note.items) {
    note.body = note.items.map((i) => i.text).filter((t) => t.trim()).join('\n');
    note.items = null;
    editBody.value = note.body;
  } else {
    const lines = note.body.split('\n').filter((l) => l.trim());
    note.items = lines.length ? lines.map((text) => ({ text, done: false })) : [{ text: '', done: false }];
    note.body = '';
  }
  update(note, {});
  renderEditorChecklist();
  if (!note.items) autoGrow(editBody);
});

// Color palettes

// Fill a palette element with one swatch per color; the current color is highlighted.
function fillSwatches(container, current, onPick) {
  container.replaceChildren(...COLORS.map((color) => {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'swatch';
    s.dataset.color = color;
    s.classList.toggle('selected', color === current);
    s.title = color[0].toUpperCase() + color.slice(1);
    s.setAttribute('aria-label', s.title);
    s.style.background = `var(--note-${color})`;
    s.addEventListener('click', (e) => {
      e.stopPropagation();
      onPick(color);
      container.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('selected', x === s));
    });
    return s;
  }));
}

// Palette shown next to a note card's or the composer's color button.
const floatPalette = $('#floatPalette');

function openFloatPalette(anchor, current, onPick) {
  if (!floatPalette.hidden && floatPalette.anchor === anchor) {
    floatPalette.hidden = true;
    return;
  }
  fillSwatches(floatPalette, current, onPick);
  floatPalette.anchor = anchor;
  floatPalette.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = floatPalette.offsetWidth;
  const h = floatPalette.offsetHeight;
  const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  const top = r.bottom + h + 8 > window.innerHeight ? r.top - h - 4 : r.bottom + 4;
  floatPalette.style.left = left + 'px';
  floatPalette.style.top = Math.max(8, top) + 'px';
}

window.addEventListener('scroll', () => { floatPalette.hidden = true; }, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') floatPalette.hidden = true;
});

// Palette inside the note editor.
const palette = $('#palette');

$('#colorBtn').addEventListener('click', () => {
  $('#labelPicker').hidden = true;
  palette.hidden = !palette.hidden;
  if (!palette.hidden) fillSwatches(palette, currentNote().color, (color) => update(currentNote(), { color }));
});

// Label picker
$('#labelBtn').addEventListener('click', () => {
  palette.hidden = true;
  const picker = $('#labelPicker');
  picker.hidden = !picker.hidden;
  if (!picker.hidden) renderLabelPicker();
});

function renderLabelPicker() {
  const note = currentNote();
  const picker = $('#labelPicker');
  if (!state.labels.length) {
    picker.innerHTML = '<div class="hint">No labels yet. Use “Edit labels” in the menu to create some.</div>';
    return;
  }
  picker.replaceChildren(...state.labels.map((label) => {
    const row = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = note.labels.includes(label);
    cb.addEventListener('change', () => {
      const labels = cb.checked ? [...note.labels, label] : note.labels.filter((l) => l !== label);
      update(note, { labels });
    });
    row.append(cb, document.createTextNode(label));
    return row;
  }));
}

// ---------- Label manager ----------

const labelDialog = $('#labelDialog');

$('#editLabelsBtn').addEventListener('click', () => {
  renderLabelList();
  labelDialog.showModal();
  replaceDrawerWith('labels');
  if (!isTouch()) $('#newLabel').focus();
});

labelDialog.addEventListener('close', () => popOverlay('labels'));

function addLabel() {
  const input = $('#newLabel');
  const name = input.value.trim();
  if (!name) return;
  if (state.labels.includes(name)) {
    toast('Label already exists');
    return;
  }
  state.labels.push(name);
  input.value = '';
  save();
  renderLabelList();
  render();
}

$('#addLabelBtn').addEventListener('click', addLabel);
$('#newLabel').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addLabel();
  }
});

function renderLabelList() {
  $('#labelList').replaceChildren(...state.labels.map((label) => {
    const li = document.createElement('li');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = label;
    input.addEventListener('change', () => renameLabel(label, input.value.trim()));
    const del = iconButton('🗑️', 'Delete label', '', () => deleteLabel(label));
    li.append(document.createTextNode('🏷️'), input, del);
    return li;
  }));
}

function renameLabel(oldName, newName) {
  if (!newName || newName === oldName) return renderLabelList();
  if (state.labels.includes(newName)) {
    toast('Label already exists');
    return renderLabelList();
  }
  state.labels = state.labels.map((l) => (l === oldName ? newName : l));
  state.notes.forEach((n) => {
    n.labels = n.labels.map((l) => (l === oldName ? newName : l));
  });
  if (view === 'label:' + oldName) view = 'label:' + newName;
  save();
  renderLabelList();
  render();
}

function deleteLabel(label) {
  if (!confirm(`Delete label “${label}”? Notes keep their content.`)) return;
  state.labels = state.labels.filter((l) => l !== label);
  state.notes.forEach((n) => {
    n.labels = n.labels.filter((l) => l !== label);
  });
  if (view === 'label:' + label) view = 'notes';
  save();
  renderLabelList();
  render();
}

// ---------- Drag & drop reordering ----------

let dragId = null;

function addDragHandlers(card) {
  card.addEventListener('dragstart', (e) => {
    dragId = card.dataset.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => {
    dragId = null;
    card.classList.remove('dragging');
    document.querySelectorAll('.drop-target').forEach((c) => c.classList.remove('drop-target'));
  });
  card.addEventListener('dragover', (e) => {
    if (!dragId || dragId === card.dataset.id) return;
    if (card.parentElement !== document.querySelector(`[data-id="${dragId}"]`)?.parentElement) return;
    e.preventDefault();
    card.classList.add('drop-target');
  });
  card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('drop-target');
    const grid = card.parentElement;
    const ids = [...grid.children].map((c) => c.dataset.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(card.dataset.id);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    // Re-assign order values within this grid, keeping the grid's existing range.
    const orders = ids.map((id) => findNote(id).order).sort((a, b) => b - a);
    ids.forEach((id, i) => { findNote(id).order = orders[i]; });
    save();
    render();
  });
}

// ---------- Sidebar, search, theme ----------

// On phones the sidebar is a drawer that slides over the notes.
const sidebar = $('#sidebar');
const scrim = $('#scrim');

function drawerOpen() {
  return isPhone() && !sidebar.classList.contains('collapsed');
}

function openDrawer() {
  sidebar.classList.remove('collapsed');
  scrim.hidden = false;
  pushOverlay('drawer');
}

function closeDrawer() {
  if (!drawerOpen()) return;
  sidebar.classList.add('collapsed');
  scrim.hidden = true;
  popOverlay('drawer');
}

sidebar.addEventListener('click', (e) => {
  const item = e.target.closest('.nav-item[data-view]');
  if (!item) return;
  view = item.dataset.view;
  closeDrawer();
  render();
  window.scrollTo(0, 0);
});

$('#menuBtn').addEventListener('click', () => {
  if (!isPhone()) sidebar.classList.toggle('collapsed');
  else if (drawerOpen()) closeDrawer();
  else openDrawer();
});
scrim.addEventListener('click', closeDrawer);
if (isPhone()) sidebar.classList.add('collapsed');
requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));

// ---------- Back button ----------

// Open overlays (editor, drawer, label dialog) add a history entry, so the
// phone's Back button closes them instead of leaving the app.
let skipPop = 0;

function pushOverlay(name) {
  try { history.pushState({ overlay: name }, ''); } catch (e) { /* ignore */ }
}

// Open an overlay; if the drawer is open, it closes and hands over its history entry.
function replaceDrawerWith(name) {
  if (drawerOpen()) {
    sidebar.classList.add('collapsed');
    scrim.hidden = true;
    try { history.replaceState({ overlay: name }, ''); } catch (e) { /* ignore */ }
  } else {
    pushOverlay(name);
  }
}

// Called when an overlay closes some other way; drop its history entry.
function popOverlay(name) {
  if (history.state && history.state.overlay === name) {
    skipPop++;
    history.back();
  }
}

window.addEventListener('popstate', () => {
  if (skipPop) {
    skipPop--;
    return;
  }
  if (editor.open) editor.close();
  else if (labelDialog.open) labelDialog.close();
  else if (drawerOpen()) {
    sidebar.classList.add('collapsed');
    scrim.hidden = true;
  }
});

// ---------- Swipe to archive (touch) ----------

function addSwipeHandlers(card, note) {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let swiping = false;
  let tracking = false;

  card.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || e.target.closest('a, input, button')) return;
    tracking = true;
    swiping = false;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
  });
  card.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!swiping) {
      if (Math.abs(dy) > 10) { tracking = false; return; }
      if (Math.abs(dx) < 12) return;
      swiping = true;
      card.setPointerCapture(e.pointerId);
      card.classList.add('swiping');
    }
    card.style.transform = `translateX(${dx}px)`;
    card.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / card.offsetWidth));
  });
  const end = () => {
    if (!tracking) return;
    tracking = false;
    if (!swiping) return;
    card.classList.remove('swiping');
    // Swallow the click the browser sends after the finger lifts.
    card.addEventListener('click', (ev) => ev.stopImmediatePropagation(), { capture: true, once: true });
    setTimeout(() => { swiping = false; }, 0);
    if (Math.abs(dx) > card.offsetWidth * 0.35) {
      card.style.transition = 'transform 0.15s, opacity 0.15s';
      card.style.transform = `translateX(${dx > 0 ? '' : '-'}110%)`;
      card.style.opacity = '0';
      setTimeout(() => toggleArchive(note), 150);
    } else {
      card.style.transition = 'transform 0.15s, opacity 0.15s';
      card.style.transform = '';
      card.style.opacity = '';
    }
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', () => {
    tracking = false;
    swiping = false;
    card.classList.remove('swiping');
    card.style.transform = '';
    card.style.opacity = '';
  });
}

// ---------- Layout (grid or list) ----------

function applyLayout(layout) {
  document.body.classList.toggle('list-view', layout === 'list');
  const btn = $('#layoutBtn');
  btn.textContent = layout === 'list' ? '▦' : '▤';
  btn.title = layout === 'list' ? 'Grid view' : 'List view';
}

applyLayout(storageGet(LAYOUT_KEY) || 'grid');
$('#layoutBtn').addEventListener('click', () => {
  const next = document.body.classList.contains('list-view') ? 'grid' : 'list';
  applyLayout(next);
  storageSet(LAYOUT_KEY, next);
});

$('#search').addEventListener('input', (e) => {
  query = e.target.value;
  render();
});

$('#emptyTrashBtn').addEventListener('click', () => {
  if (!confirm('Empty Trash? All notes in Trash will be permanently deleted.')) return;
  state.notes = state.notes.filter((n) => !n.trashedAt);
  save();
  render();
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  // Match the phone's status bar to the chosen theme.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.content = theme === 'dark' ? '#202124' : '#ffffff';
  });
}

function storedTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch (e) {
    return null;
  }
}

applyTheme(storedTheme() || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('#themeBtn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
});

// ---------- Import / export ----------

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `organizer-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.notes)) throw new Error('missing notes');
    if (!confirm(`Import ${data.notes.length} notes? This replaces your current notes.`)) return;
    state = {
      labels: Array.isArray(data.labels) ? data.labels : [],
      notes: data.notes.map((n) => newNote({ ...n, labels: Array.isArray(n.labels) ? n.labels : [] })),
    };
    view = 'notes';
    save();
    render();
    toast('Backup imported');
  } catch (err) {
    toast('That file is not a valid Organizer backup.');
  }
});

// ---------- Toast ----------

let toastTimer = null;

function toast(message, undo) {
  const el = $('#toast');
  el.replaceChildren(document.createTextNode(message));
  if (undo) {
    const b = document.createElement('button');
    b.textContent = 'Undo';
    b.addEventListener('click', () => {
      el.hidden = true;
      document.body.classList.remove('toast-open');
      undo();
    });
    el.append(b);
  }
  el.hidden = false;
  document.body.classList.add('toast-open');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
    document.body.classList.remove('toast-open');
  }, 5000);
}

// ---------- Keyboard shortcuts ----------

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  if (typing || editor.open || labelDialog.open) return;
  if (e.key === '/') {
    e.preventDefault();
    $('#search').focus();
  } else if (e.key === 'c' && !$('#composer').hidden) {
    e.preventDefault();
    newBody.focus();
  }
});

// ---------- Boot ----------

purgeOldTrash();
save();
render();

// Offline support and "Add to Home Screen" (only works when served over http/https).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}
