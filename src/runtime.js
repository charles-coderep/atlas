const fs = require('fs');
const path = require('path');

function getRuntimeDir() {
  return process.env.ATLAS_RUNTIME_DIR || path.join(__dirname, '..', 'config', 'runtime');
}

function ensureRuntimeDir() {
  const dir = getRuntimeDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getRuntimeFile(...segments) {
  return path.join(ensureRuntimeDir(), ...segments);
}

function readRuntimeJson(filename, fallback = {}) {
  try {
    const filePath = getRuntimeFile(filename);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {}
  return { ...fallback };
}

function writeRuntimeJson(filename, value) {
  const filePath = getRuntimeFile(filename);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
  return filePath;
}

module.exports = {
  getRuntimeDir,
  ensureRuntimeDir,
  getRuntimeFile,
  readRuntimeJson,
  writeRuntimeJson,
};
