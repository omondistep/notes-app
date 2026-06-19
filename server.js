const express = require('express');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const JSZip = require('jszip');
const chokidar = require('chokidar');
const ROOT_DIR = path.resolve(__dirname, '..');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3456;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/subjects', (req, res) => {
  res.json(db.getAllSubjects());
});

app.post('/api/subjects', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const subject = db.createSubject(name, description);
  if (!subject) return res.status(409).json({ error: 'Subject already exists' });
  res.status(201).json(subject);
});

app.delete('/api/subjects/:id', (req, res) => {
  db.deleteSubject(req.params.id);
  res.json({ success: true });
});

app.get('/api/subjects/:id/notes', (req, res) => {
  res.json(db.getNotesBySubject(req.params.id));
});

app.get('/api/notes/:id', (req, res) => {
  const note = db.getNoteById(req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  res.json(note);
});

app.post('/api/notes', (req, res) => {
  const { subject_id, title, content, file_type, file_path } = req.body;
  if (!subject_id || !title) return res.status(400).json({ error: 'Subject ID and title are required' });
  const note = db.createNote(subject_id, title, content || '', file_type, file_path);
  res.status(201).json(note);
});

app.put('/api/notes/:id', (req, res) => {
  const { title, content } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const note = db.updateNote(req.params.id, title, content || '');
  if (!note) return res.status(404).json({ error: 'Note not found' });
  res.json(note);
});

app.delete('/api/notes/:id', (req, res) => {
  db.deleteNote(req.params.id);
  res.json({ success: true });
});

app.get('/api/search', (req, res) => {
  const q = req.query.q;
  if (!q) return res.json([]);
  res.json(db.searchNotes(q));
});

app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path required' });
  const content = db.readFileContent(filePath);
  if (content === '[File not found]' || content === '[Error reading file]') {
    return res.status(404).json({ error: content });
  }
  res.json({ content });
});

const MIME_MAP = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

app.get('/api/file/serve', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path required' });
  
  // Normalize path to prevent directory traversal and handle Windows/Unix differences
  const normalizedPath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.resolve(path.join(__dirname, '..', normalizedPath));
  
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    return res.status(404).json({ error: 'File not found' });
  }
  
  const ext = path.extname(fullPath).toLowerCase();
  const mime = MIME_MAP[ext] || 'application/octet-stream';
  const filename = path.basename(fullPath);
  
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
  res.sendFile(fullPath);
});

async function extractDocxContent(filePath) {
  const fullPath = path.resolve(path.join(__dirname, '..', filePath));
  if (!fs.existsSync(fullPath)) return null;
  const result = await mammoth.convertToHtml({ path: fullPath });
  return result.value;
}

async function extractPptxContent(filePath) {
  const fullPath = path.resolve(path.join(__dirname, '..', filePath));
  if (!fs.existsSync(fullPath)) return null;
  const data = fs.readFileSync(fullPath);
  const zip = await JSZip.loadAsync(data);
  const slideFiles = Object.keys(zip.files).filter(f => f.match(/ppt\/slides\/slide\d+\.xml/)).sort();
  let html = '';
  for (const sf of slideFiles) {
    const content = await zip.files[sf].async('string');
    const textMatches = content.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
    const texts = textMatches.map(m => m.replace(/<\/?a:t[^>]*>/g, ''));
    if (texts.length) {
      const titleMatch = content.match(/<p:ph type="title"[^>]*>.*?<a:t[^>]*>([^<]+)<\/a:t>/);
      const slideNum = sf.match(/(\d+)/)[1];
      html += `<h3>Slide ${slideNum}</h3>\n`;
      if (titleMatch) html += `<p><strong>${titleMatch[1]}</strong></p>\n`;
      html += `<p>${texts.join(' ')}</p>\n`;
    }
  }
  return html || '<p>[No text content found in this presentation]</p>';
}

function extractOdtContent(filePath) {
  const fullPath = path.resolve(path.join(__dirname, '..', filePath));
  if (!fs.existsSync(fullPath)) return null;
  try {
    const data = fs.readFileSync(fullPath);
    const text = data.toString('utf-8');
    const contentMatch = text.match(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g);
    if (contentMatch) {
      return contentMatch.map(p => {
        let cleaned = p.replace(/<\/?text:span[^>]*>/g, '').replace(/<text:p[^>]*>/, '').replace(/<\/text:p>/, '');
        return `<p>${cleaned}</p>`;
      }).join('\n');
    }
    return null;
  } catch { return null; }
}

app.get('/api/file/read', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path required' });
  const fullPath = path.resolve(path.join(__dirname, '..', filePath));
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });
  const ext = path.extname(fullPath).toLowerCase();
  try {
    let html = '';
    let format = 'html';
    if (ext === '.docx') {
      html = await extractDocxContent(filePath);
      if (!html) return res.status(500).json({ error: 'Failed to read docx' });
    } else if (ext === '.pptx') {
      html = await extractPptxContent(filePath);
      if (!html) return res.status(500).json({ error: 'Failed to read pptx' });
    } else if (ext === '.odt') {
      html = extractOdtContent(filePath);
      if (!html) html = '<p>[Could not extract content from this ODT file]</p>';
    } else if (ext === '.doc') {
      html = '<p>[.DOC files (old Word format) cannot be previewed inline. Please download and open in Word.]</p>';
    } else if (ext === '.html') {
      html = fs.readFileSync(fullPath, 'utf-8');
      format = 'raw';
    } else if (ext === '.md' || ext === '.txt') {
      html = fs.readFileSync(fullPath, 'utf-8');
    } else {
      html = '<p>[Preview not available for this file type]</p>';
    }
    res.json({ html, format });
  } catch (e) {
    res.status(500).json({ error: 'Error reading file: ' + e.message });
  }
});

async function start() {
  await db.getDb();
  
  // Setup Watcher
  const watcher = chokidar.watch(ROOT_DIR, {
    ignored: [/(^|[\/\\])\../, '**/node_modules/**', '**/notes-app/**'],
    persistent: true,
    ignoreInitial: false,
    depth: 1
  });

  const syncFile = (filePath, isDelete = false) => {
    const relPath = path.relative(ROOT_DIR, filePath);
    const parts = relPath.split(path.sep);
    if (parts.length !== 2) return; // Only sync files inside subject folders

    const subjectName = parts[0];
    const fileName = parts[1];
    const ext = path.extname(fileName).toLowerCase();
    const SUPPORTED_EXTS = ['.md', '.txt', '.html', '.pdf', '.docx', '.doc', '.pptx', '.odt'];
    
    if (!SUPPORTED_EXTS.includes(ext) || fileName.startsWith('~$')) return;

    let subjects = db.getAllSubjects();
    let subject = subjects.find(s => s.name === subjectName);
    
    if (!subject && !isDelete) {
      subject = db.createSubject(subjectName, `Folder: ${subjectName}`);
    }

    if (!subject) return;

    const notes = db.getNotesBySubject(subject.id);
    const existingNote = notes.find(n => n.file_path === relPath.replace(/\\/g, '/'));

    if (isDelete) {
      if (existingNote) db.deleteNote(existingNote.id);
    } else {
      if (!existingNote) {
        const title = path.basename(fileName, ext).replace(/_/g, ' ');
        db.createNote(subject.id, title, '', ext, relPath.replace(/\\/g, '/'));
      }
    }
  };

  watcher
    .on('add', path => syncFile(path))
    .on('unlink', path => syncFile(path, true));

  app.listen(PORT, () => {
    console.log(`Notes app running at http://localhost:${PORT}`);
  });
}

start();
