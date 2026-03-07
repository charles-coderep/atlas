const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MODEL_PATH = path.join(__dirname, '..', 'config', 'models', 'ggml-small.en.bin');

// Look for whisper binary in common locations
function findWhisperBinary() {
  const candidates = [
    path.join(__dirname, '..', 'config', 'models', 'whisper-cli.exe'),
    path.join(__dirname, '..', 'config', 'models', 'main.exe'),
    path.join(__dirname, '..', 'config', 'models', 'whisper.exe'),
  ];

  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

function isLocalWhisperAvailable() {
  return fs.existsSync(MODEL_PATH) && findWhisperBinary() !== null;
}

// Transcribe a WAV file using local whisper.cpp binary
async function transcribeLocal(wavPath) {
  const binary = findWhisperBinary();
  if (!binary) throw new Error('No whisper binary found in config/models/');
  if (!fs.existsSync(MODEL_PATH)) throw new Error('Whisper model not found at config/models/ggml-small.en.bin');

  return new Promise((resolve, reject) => {
    const args = [
      '-m', MODEL_PATH,
      '-f', wavPath,
      '--no-timestamps',
      '-l', 'en',
    ];

    execFile(binary, args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Whisper transcription failed: ${err.message}`));
        return;
      }
      // whisper.cpp outputs text with leading/trailing whitespace
      const text = stdout.trim();
      resolve(text);
    });
  });
}

// Save raw PCM/WAV buffer from renderer to a temp file
function saveTempWav(buffer) {
  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `atlas_voice_${Date.now()}.wav`);
  fs.writeFileSync(tmpPath, Buffer.from(buffer));
  return tmpPath;
}

function cleanupTempFile(filePath) {
  try { fs.unlinkSync(filePath); } catch {}
}

module.exports = { isLocalWhisperAvailable, transcribeLocal, saveTempWav, cleanupTempFile };
