const fs = require('fs');
const path = require('path');
const db = require('./database');

const ROOT_DIR = path.join(__dirname, '..');

const TEXT_EXTS = ['.md', '.txt', '.html'];
const SUPPORTED_EXTS = ['.md', '.txt', '.html', '.pdf', '.docx', '.doc', '.pptx', '.odt'];

async function scanAndSeed() {
  await db.getDb();
  console.log('Scanning subject folders...');

  const entries = fs.readdirSync(ROOT_DIR, { withFileTypes: true });
  const subjectDirs = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'notes-app')
    .map(e => e.name);

  let totalNotes = 0;

  for (const dirName of subjectDirs) {
    const dirPath = path.join(ROOT_DIR, dirName);
    const subject = db.createSubject(dirName, `Notes for ${dirName}`);
    if (!subject) continue;

    const files = fs.readdirSync(dirPath).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return SUPPORTED_EXTS.includes(ext) && !f.startsWith('~$');
    });

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const filePath = dirName + '/' + file;
      const title = path.basename(file, path.extname(file)).replace(/_/g, ' ');

      let content = '';
      const fileSize = fs.statSync(path.join(dirPath, file)).size;
      if (TEXT_EXTS.includes(ext)) {
        try {
          content = fs.readFileSync(path.join(dirPath, file), 'utf-8');
        } catch {
          content = `[Could not read ${file}]`;
        }
      } else {
        const kb = (fileSize / 1024).toFixed(1);
        content = `[${ext.toUpperCase()} — ${kb} KB — ${file}]`;
      }

      db.createNote(subject.id, title, content, ext, filePath);
      totalNotes++;
    }
  }

  console.log(`Seeded ${totalNotes} notes across ${subjectDirs.length} subjects.`);
}

scanAndSeed().catch(console.error);
