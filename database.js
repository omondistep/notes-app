const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'notes.db');

let db;
let SQL;

async function getDb() {
  if (db) return db;
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  initTables();
  saveDb();
  return db;
}

function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

function initTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      file_type TEXT DEFAULT '',
      file_path TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_notes_subject ON notes(subject_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_notes_title ON notes(title)');
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

function getAllSubjects() {
  return queryAll(`
    SELECT s.*, COUNT(n.id) as note_count
    FROM subjects s
    LEFT JOIN notes n ON n.subject_id = s.id
    GROUP BY s.id
    ORDER BY s.name
  `);
}

function getNotesBySubject(subjectId) {
  return queryAll(`
    SELECT * FROM notes WHERE subject_id = ?
    ORDER BY updated_at DESC
  `, [subjectId]);
}

function getNoteById(noteId) {
  return queryOne('SELECT * FROM notes WHERE id = ?', [noteId]);
}

function createNote(subjectId, title, content, fileType, filePath) {
  const stmt = db.prepare(`
    INSERT INTO notes (subject_id, title, content, file_type, file_path)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.bind([subjectId, title, content || '', fileType || '', filePath || '']);
  stmt.step();
  const id = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
  stmt.free();
  saveDb();
  return getNoteById(id);
}

function updateNote(noteId, title, content) {
  run(`
    UPDATE notes SET title = ?, content = ?, updated_at = datetime('now')
    WHERE id = ?
  `, [title, content, noteId]);
  return getNoteById(noteId);
}

function deleteNote(noteId) {
  run('DELETE FROM notes WHERE id = ?', [noteId]);
}

function searchNotes(query) {
  const q = `%${query}%`;
  return queryAll(`
    SELECT n.*, s.name as subject_name
    FROM notes n
    JOIN subjects s ON s.id = n.subject_id
    WHERE n.title LIKE ? OR n.content LIKE ?
    ORDER BY n.updated_at DESC
  `, [q, q]);
}

function createSubject(name, description) {
  const existing = queryOne('SELECT * FROM subjects WHERE name = ?', [name]);
  if (existing) return null;
  const stmt = db.prepare('INSERT INTO subjects (name, description) VALUES (?, ?)');
  stmt.bind([name, description || '']);
  stmt.step();
  const id = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
  stmt.free();
  saveDb();
  return queryOne('SELECT * FROM subjects WHERE id = ?', [id]);
}

function deleteSubject(subjectId) {
  run('DELETE FROM subjects WHERE id = ?', [subjectId]);
}

function readFileContent(filePath) {
  try {
    const fullPath = path.resolve(path.join(__dirname, '..', filePath));
    if (fs.existsSync(fullPath)) {
      const ext = path.extname(fullPath).toLowerCase();
      if (ext === '.md' || ext === '.txt') {
        return fs.readFileSync(fullPath, 'utf-8');
      }
      if (ext === '.html') {
        return fs.readFileSync(fullPath, 'utf-8');
      }
      return `[File: ${path.basename(filePath)} - ${ext.toUpperCase()} files cannot be previewed inline]`;
    }
    return '[File not found]';
  } catch {
    return '[Error reading file]';
  }
}

module.exports = {
  getDb,
  getAllSubjects,
  getNotesBySubject,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
  searchNotes,
  createSubject,
  deleteSubject,
  readFileContent,
};
