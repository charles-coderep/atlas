const fs = require('fs');
const path = require('path');
const { getClient } = require('./db');

const FILES_DIR = path.join(__dirname, '..', 'files');
const MAX_CONTENT_CHARS = 8000; // ~2000 tokens

function ensureFilesDir() {
  if (!fs.existsSync(FILES_DIR)) {
    fs.mkdirSync(FILES_DIR, { recursive: true });
  }
}

function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  if (ext === '.pdf') {
    // PDF support requires a library — for now, note the limitation
    throw new Error('PDF parsing not yet supported. Convert to .txt or .md first.');
  }

  throw new Error(`Unsupported file type: ${ext}. Supported: .txt, .md`);
}

async function ingestFile(filePath, goalId) {
  ensureFilesDir();

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const filename = path.basename(filePath);
  const fileType = path.extname(filePath).toLowerCase().replace('.', '');
  let content = extractText(filePath);

  // Copy to files directory
  const destPath = path.join(FILES_DIR, filename);
  fs.copyFileSync(filePath, destPath);

  // Truncate if too large
  let truncated = false;
  if (content.length > MAX_CONTENT_CHARS) {
    content = content.substring(0, MAX_CONTENT_CHARS);
    truncated = true;
  }

  const db = getClient();
  const { data, error } = await db
    .from('files')
    .insert({
      filename,
      file_type: fileType,
      content,
      goal_id: goalId || null,
    })
    .select()
    .single();

  if (error) throw error;

  return { file: data, truncated };
}

async function listFiles() {
  const db = getClient();
  const { data, error } = await db
    .from('files')
    .select('id, filename, file_type, goal_id, uploaded_at')
    .order('uploaded_at', { ascending: false });

  if (error) throw error;
  return data;
}

async function getFilesByGoal(goalId) {
  const db = getClient();
  const { data, error } = await db
    .from('files')
    .select('*')
    .eq('goal_id', goalId);

  if (error) throw error;
  return data;
}

async function searchFiles(keywords) {
  const db = getClient();
  // Search filenames and content for keyword matches
  const { data, error } = await db
    .from('files')
    .select('*')
    .order('uploaded_at', { ascending: false });

  if (error) throw error;

  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  return data.filter((f) => {
    const text = `${f.filename} ${f.content}`.toLowerCase();
    return lowerKeywords.some((kw) => text.includes(kw));
  });
}

async function getFile(id) {
  const db = getClient();
  const { data, error } = await db.from('files').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

module.exports = { ingestFile, listFiles, getFilesByGoal, searchFiles, getFile };
