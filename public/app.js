// Initialize Marked with Highlight.js
(function() {
  if (typeof marked === 'undefined') {
    console.warn('marked library not loaded - markdown rendering disabled');
    return;
  }
  if (typeof markedHighlight !== 'undefined') {
    try {
      marked.use(markedHighlight({
        langPrefix: 'hljs language-',
        highlight: function(code, lang) {
          const language = hljs.getLanguage(lang) ? lang : 'plaintext';
          return hljs.highlight(code, { language }).value;
        }
      }));
    } catch (e) {
      console.warn('markedHighlight init failed, falling back:', e);
      marked.setOptions({
        highlight: function(code, lang) {
          try {
            const language = hljs.getLanguage(lang) ? lang : 'plaintext';
            return hljs.highlight(code, { language }).value;
          } catch(e2) {
            return code;
          }
        },
        langPrefix: 'hljs language-',
      });
    }
  } else {
    marked.setOptions({
      highlight: function(code, lang) {
        try {
          const language = hljs.getLanguage(lang) ? lang : 'plaintext';
          return hljs.highlight(code, { language }).value;
        } catch(e) {
          return code;
        }
      },
      langPrefix: 'hljs language-',
    });
  }
  marked.setOptions({ gfm: true, breaks: true });
})();

let subjects = [];
let notes = [];
let activeSubjectId = null;
let activeNoteId = null;
let isEditing = false;
let cm = null;

// Initialize CodeMirror
function initEditor() {
  if (cm || typeof CodeMirror === 'undefined') return;
  try {
    cm = CodeMirror.fromTextArea(el('noteEditor'), {
      mode: 'markdown',
      theme: 'base16-dark',
      lineNumbers: true,
      keyMap: 'vim',
      showCursorWhenSelecting: true,
      lineWrapping: true
    });
    CodeMirror.on(cm, 'vim-mode-change', (e) => {
      const bar = el('vim-status-bar');
      if (bar) bar.textContent = `-- ${e.mode.toUpperCase()} --`;
    });
  } catch (e) {
    console.warn('CodeMirror init failed:', e);
  }
}

const subjectIcons = {
  'ACCOUNTING': '📊', 'CBET': '📋', 'Economic': '💰', 'Economi': '💰',
  'Education_Technologies': '💻', 'KSTVET RESEARCH': '🔬', 'research': '🔬',
  'MATHEMATICS': '📐', 'Maths': '📐', 'Other_Revision_Files': '📁',
  'PE': '🏃', 'Training Methodologies': '🎯'
};

function getSubjectIcon(name) {
  for (const [key, icon] of Object.entries(subjectIcons)) {
    if (name.toUpperCase().includes(key.toUpperCase()) || key.toUpperCase().includes(name.toUpperCase())) return icon;
  }
  return '📂';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function getFileIcon(type) {
  const m = { '.pdf': '📕', '.docx': '📘', '.doc': '📘', '.pptx': '📙', '.ppt': '📙', '.md': '📄', '.txt': '📄', '.html': '🌐', '.odt': '📗' };
  return m[type] || '📎';
}

function isViewableInline(type) {
  return ['.md', '.txt', ''].includes(type);
}

function isViewableEmbed(type) {
  return ['.pdf', '.html'].includes(type);
}

async function api(path, opts = {}) {
  try {
    const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    if (!r.ok) {
      const error = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error(error.error || `HTTP ${r.status}`);
    }
    return r.json();
  } catch (e) {
    console.error(`API Error (${path}):`, e);
    throw e;
  }
}

async function loadSubjects() {
  subjects = await api('/api/subjects');
  renderSubjects();
}

function renderSubjects() {
  document.getElementById('subjectList').innerHTML = subjects.map(s =>
    `<div class="subject-item ${s.id === activeSubjectId ? 'active' : ''}" data-id="${s.id}">
      <span class="name"><span class="icon">${getSubjectIcon(s.name)}</span>${escapeHtml(s.name)}</span>
      <span class="count">${s.note_count || 0}</span>
    </div>`
  ).join('');
  document.querySelectorAll('.subject-item').forEach(el =>
    el.addEventListener('click', () => selectSubject(Number(el.dataset.id))));
}

async function selectSubject(id) {
  activeSubjectId = id;
  activeNoteId = null;
  isEditing = false;
  renderSubjects();
  const s = subjects.find(s => s.id === id);
  document.getElementById('panelTitle').textContent = s ? s.name : 'Notes';
  document.getElementById('addNoteBtn').style.display = '';
  document.getElementById('dropZone').style.display = 'block';
  notes = await api(`/api/subjects/${id}/notes`);
  renderNotes();
  showEmptyState();
}

// Drag & Drop Handling
const dropZone = el('dropZone');

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, () => dropZone.classList.add('active'), false);
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, () => dropZone.classList.remove('active'), false);
});

dropZone.addEventListener('drop', handleDrop, false);

async function handleDrop(e) {
  const dt = e.dataTransfer;
  const files = dt.files;
  if (!files.length || !activeSubjectId) return;

  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }

  try {
    const res = await fetch(`/api/subjects/${activeSubjectId}/upload`, {
      method: 'POST',
      body: formData
    });
    const result = await res.json();
    if (result.success) {
      // Small delay to let the watcher pick up files
      setTimeout(async () => {
        notes = await api(`/api/subjects/${activeSubjectId}/notes`);
        renderNotes();
      }, 500);
    }
  } catch (err) {
    console.error('Upload failed:', err);
    alert('Upload failed. Check console for details.');
  }
}

function renderNotes() {
  const list = document.getElementById('notesList');
  if (!notes.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">No notes yet. Create one!</div>';
    return;
  }
  list.innerHTML = notes.map(n =>
    `<div class="note-item ${n.id === activeNoteId ? 'active' : ''}" data-id="${n.id}">
      <div class="note-title">${getFileIcon(n.file_type)} ${escapeHtml(n.title)}</div>
      <div class="note-meta">${formatDate(n.updated_at)}</div>
      <div class="note-preview">${escapeHtml((n.content||'').replace(/[#*`\[\]]/g,'').substring(0,80))}</div>
    </div>`
  ).join('');
  document.querySelectorAll('.note-item').forEach(el =>
    el.addEventListener('click', () => selectNote(Number(el.dataset.id))));
}

async function selectNote(id) {
  activeNoteId = id;
  isEditing = false;
  renderNotes();
  showNoteViewer(await api(`/api/notes/${id}`));
}

// Theme handling
const themeSelect = el('themeSelect');
const currentTheme = localStorage.getItem('kstvet-theme') || 'catppuccin';
document.body.setAttribute('data-theme', currentTheme);
if (themeSelect) themeSelect.value = currentTheme;

if (themeSelect) {
  themeSelect.addEventListener('change', (e) => {
    const theme = e.target.value;
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('kstvet-theme', theme);
  });
}

async function showNoteViewer(note) {
  el('emptyState').style.display = 'none';
  el('noteViewer').style.display = 'flex';
  el('noteTitle').value = note.title;

  const ft = note.file_type || '';
  const fp = note.file_path || '';
  const inline = isViewableInline(ft);
  const embed = isViewableEmbed(ft);

  renderFileBar(fp, ft);

  const contentArea = el('noteContent');
  const pdfViewer = el('pdfViewer');
  const noPreview = el('noPreview');
  const editBtn = el('editToggleBtn');
  const delBtn = el('deleteNoteBtn');

  [contentArea, pdfViewer, noPreview].forEach(e => e.style.display = 'none');

  if (inline || !fp) {
    contentArea.style.display = 'block';
    if (fp) {
      try {
        const fileData = await api(`/api/file?path=${encodeURIComponent(fp)}`);
        contentArea.innerHTML = marked.parse(fileData.content || '*No content*');
      } catch {
        contentArea.innerHTML = marked.parse(note.content || '*No content*');
      }
    } else {
      contentArea.innerHTML = marked.parse(note.content || '*No content*');
    }
    editBtn.style.display = '';
    delBtn.style.display = '';
  } else if (embed) {
    editBtn.style.display = 'none';
    delBtn.style.display = '';
    if (ft === '.pdf') {
      pdfViewer.style.display = 'flex';
      pdfViewer.innerHTML = `<embed src="/api/file/serve?path=${encodeURIComponent(fp)}" type="application/pdf" class="pdf-embed">`;
    } else {
      contentArea.style.display = 'block';
      contentArea.innerHTML = `<iframe src="/api/file/serve?path=${encodeURIComponent(fp)}" class="html-embed" title="HTML Viewer"></iframe>`;
    }
  } else {
    editBtn.style.display = 'none';
    delBtn.style.display = '';
    try {
      const r = await api(`/api/file/read?path=${encodeURIComponent(fp)}`);
      if (r.html) {
        contentArea.style.display = 'block';
        contentArea.innerHTML = r.format === 'raw'
          ? `<iframe srcdoc="${attrEncode(r.html)}" class="html-embed"></iframe>`
          : r.html;
      } else {
        showNoPreview(fp, ft);
      }
    } catch {
      showNoPreview(fp, ft);
    }
  }

  el('noteEditor').style.display = 'none';
  const cmWrapper = document.querySelector('.CodeMirror');
  if (cmWrapper) cmWrapper.style.display = 'none';
  const statusBar = el('vim-status-bar');
  if (statusBar) statusBar.style.display = 'none';
  el('editorActions').style.display = 'none';
  el('editToggleBtn').textContent = 'Edit';
}

function attrEncode(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderFileBar(fp, ft) {
  const bar = el('fileBar');
  if (!fp) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  bar.innerHTML = `
    <span class="file-badge">${getFileIcon(ft)} ${ft.toUpperCase() || 'NOTE'}</span>
    <a href="/api/file/serve?path=${encodeURIComponent(fp)}" target="_blank" class="btn-secondary btn-sm">Open</a>
    <a href="/api/file/serve?path=${encodeURIComponent(fp)}" download class="btn-secondary btn-sm">Download</a>`;
}

function showNoPreview(fp, ft) {
  const np = el('noPreview');
  np.style.display = 'flex';
  np.innerHTML = `
    <div class="no-preview-content">
      <span class="no-preview-icon">${getFileIcon(ft)}</span>
      <p><strong>${ft.toUpperCase()}</strong> files cannot be previewed inline.</p>
      <div class="no-preview-actions">
        <a href="/api/file/serve?path=${encodeURIComponent(fp)}" target="_blank" class="btn-primary">Open</a>
        <a href="/api/file/serve?path=${encodeURIComponent(fp)}" download class="btn-secondary">Download</a>
      </div>
    </div>`;
}

function el(id) { return document.getElementById(id); }

function showEmptyState() {
  el('emptyState').style.display = 'flex';
  el('noteViewer').style.display = 'none';
}

// Search
el('searchInput').addEventListener('input', async e => {
  const q = e.target.value.trim();
  if (!q) { if (activeSubjectId) selectSubject(activeSubjectId); return; }
  notes = await api(`/api/search?q=${encodeURIComponent(q)}`);
  el('panelTitle').textContent = `Search: "${q}"`;
  el('addNoteBtn').style.display = 'none';
  renderNotes();
  showEmptyState();
});

// Add subject
el('addSubjectBtn').addEventListener('click', () => {
  el('subjectModal').style.display = 'flex';
  el('subjectNameInput').value = '';
  el('subjectDescInput').value = '';
  el('subjectNameInput').focus();
});
el('saveSubjectBtn').addEventListener('click', async () => {
  const n = el('subjectNameInput').value.trim();
  if (!n) return;
  await api('/api/subjects', { method: 'POST', body: JSON.stringify({ name: n, description: el('subjectDescInput').value.trim() }) });
  el('subjectModal').style.display = 'none';
  loadSubjects();
});
el('cancelSubjectBtn').addEventListener('click', () => el('subjectModal').style.display = 'none');

// Add note
el('addNoteBtn').addEventListener('click', () => {
  el('noteModal').style.display = 'flex';
  el('noteNameInput').value = '';
  el('noteNameInput').focus();
});
el('saveNoteNameBtn').addEventListener('click', async () => {
  const t = el('noteNameInput').value.trim();
  if (!t || !activeSubjectId) return;
  const note = await api('/api/notes', { method: 'POST', body: JSON.stringify({ subject_id: activeSubjectId, title: t, content: '' }) });
  el('noteModal').style.display = 'none';
  notes.unshift(note);
  renderNotes();
  selectNote(note.id);
});
el('cancelNoteNameBtn').addEventListener('click', () => el('noteModal').style.display = 'none');

// Edit toggle
el('editToggleBtn').addEventListener('click', () => {
  isEditing = !isEditing;
  const c = el('noteContent');
  const eWrapper = document.querySelector('.CodeMirror');
  const statusBar = el('vim-status-bar');
  const editorActions = el('editorActions');

  if (isEditing) {
    initEditor();
    c.style.display = 'none';
    const cmWrapper = document.querySelector('.CodeMirror');
    if (cmWrapper) cmWrapper.style.display = 'block';
    if (statusBar) statusBar.style.display = 'block';
    fetch(`/api/notes/${activeNoteId}`).then(r => r.json()).then(n => {
      if (n.file_path) {
        fetch(`/api/file?path=${encodeURIComponent(n.file_path)}`).then(r => r.json()).then(fd => {
          cm.setValue(fd.content || '');
          cm.refresh();
          cm.focus();
        }).catch(() => {
          cm.setValue(n.content || '');
          cm.refresh();
          cm.focus();
        });
      } else {
        cm.setValue(n.content || '');
        cm.refresh();
        cm.focus();
      }
    });
    editorActions.style.display = 'flex';
    el('editToggleBtn').textContent = 'Preview';
  } else {
    c.style.display = 'block';
    const cmWrapper = document.querySelector('.CodeMirror');
    if (cmWrapper) cmWrapper.style.display = 'none';
    if (statusBar) statusBar.style.display = 'none';
    editorActions.style.display = 'none';
    el('editToggleBtn').textContent = 'Edit';
  }
});

// Save / Cancel edit
el('saveNoteBtn').addEventListener('click', async () => {
  const title = el('noteTitle').value.trim();
  const content = cm ? cm.getValue() : el('noteEditor').value;
  if (!title || !activeNoteId) return;
  const note = await api(`/api/notes/${activeNoteId}`, { method: 'PUT', body: JSON.stringify({ title, content }) });
  isEditing = false;
  showNoteViewer(note);
  if (activeSubjectId) { notes = await api(`/api/subjects/${activeSubjectId}/notes`); renderNotes(); }
});

el('cancelEditBtn').addEventListener('click', () => {
  isEditing = false;
  fetch(`/api/notes/${activeNoteId}`).then(r => r.json()).then(n => showNoteViewer(n));
});

// Delete
el('deleteNoteBtn').addEventListener('click', async () => {
  if (!activeNoteId || !confirm('Delete this note?')) return;
  await api(`/api/notes/${activeNoteId}`, { method: 'DELETE' });
  activeNoteId = null;
  isEditing = false;
  if (activeSubjectId) { notes = await api(`/api/subjects/${activeSubjectId}/notes`); renderNotes(); }
  showEmptyState();
});

// Escape key on search
el('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Escape') { el('searchInput').value = ''; if (activeSubjectId) selectSubject(activeSubjectId); }
});

// Global keyboard
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && isEditing) { e.preventDefault(); el('saveNoteBtn').click(); }
  if (e.key === 'Escape') {
    if (isEditing) el('cancelEditBtn').click();
    else if (activeNoteId) { activeNoteId = null; showEmptyState(); }
  }
});

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; }));

// Init
loadSubjects();
