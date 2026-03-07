const fs = require('fs');
const path = require('path');
const { getClient } = require('./db');

const FILES_DIR = path.join(__dirname, '..', 'files');
const MAX_CONTENT_CHARS = 8000;

function ensureFilesDir() {
  if (!fs.existsSync(FILES_DIR)) {
    fs.mkdirSync(FILES_DIR, { recursive: true });
  }
}

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text || '';
  }

  if (ext === '.csv') {
    const Papa = require('papaparse');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = Papa.parse(raw, { header: true, preview: 50 });
    const headers = parsed.meta.fields || [];
    const rowCount = raw.split('\n').length - 1;
    let summary = `CSV file: ${rowCount} rows, ${headers.length} columns\n`;
    summary += `Headers: ${headers.join(', ')}\n\n`;
    // Include first rows as readable data
    for (const row of parsed.data.slice(0, 20)) {
      summary += headers.map((h) => `${h}: ${row[h]}`).join(' | ') + '\n';
    }
    if (rowCount > 20) summary += `\n... and ${rowCount - 20} more rows`;
    return summary;
  }

  if (ext === '.json') {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Structural summary for large JSON
    if (raw.length > 2000) {
      const keys = Object.keys(parsed);
      let summary = `JSON file with ${keys.length} top-level keys: ${keys.join(', ')}\n\n`;
      for (const key of keys.slice(0, 10)) {
        const val = parsed[key];
        if (Array.isArray(val)) {
          summary += `${key}: array of ${val.length} items\n`;
        } else if (typeof val === 'object' && val !== null) {
          summary += `${key}: object with keys [${Object.keys(val).slice(0, 5).join(', ')}]\n`;
        } else {
          summary += `${key}: ${String(val).substring(0, 100)}\n`;
        }
      }
      return summary;
    }
    return raw;
  }

  throw new Error(`Unsupported file type: ${ext}. Supported: .txt, .md, .pdf, .csv, .json`);
}

async function ingestFile(filePath, goalId) {
  ensureFilesDir();

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const filename = path.basename(filePath);
  const fileType = path.extname(filePath).toLowerCase().replace('.', '');
  let content = await extractText(filePath);

  // Copy to files directory
  const destPath = path.join(FILES_DIR, filename);
  fs.copyFileSync(filePath, destPath);

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
