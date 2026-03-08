const fs = require('fs');
const path = require('path');
const os = require('os');

const MODEL_PATH = path.join(__dirname, '..', 'config', 'models', 'ggml-small.en.bin');

let whisperCtx = null;

function isLocalWhisperAvailable() {
  try {
    require('whisper-cpp-node');
    return fs.existsSync(MODEL_PATH);
  } catch {
    return false;
  }
}

function getWhisperContext() {
  if (whisperCtx) return whisperCtx;

  const { createWhisperContext } = require('whisper-cpp-node');
  whisperCtx = createWhisperContext({
    model: MODEL_PATH,
    use_gpu: true,
  });
  return whisperCtx;
}

// Transcribe a WAV file
async function transcribeFile(wavPath) {
  const { transcribeAsync } = require('whisper-cpp-node');
  const ctx = getWhisperContext();

  const result = await transcribeAsync(ctx, {
    fname_inp: wavPath,
    language: 'en',
  });

  const text = result.segments.map(s => s.text).join('').trim();
  return text;
}

// Transcribe from a raw audio buffer (Float32Array PCM at 16kHz)
async function transcribeBuffer(float32Array) {
  const { transcribeAsync } = require('whisper-cpp-node');
  const ctx = getWhisperContext();

  const result = await transcribeAsync(ctx, {
    pcmf32: float32Array,
    language: 'en',
  });

  const text = result.segments.map(s => s.text).join('').trim();
  return text;
}

// Save raw audio buffer to temp WAV file
function saveTempWav(buffer) {
  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `atlas_voice_${Date.now()}.wav`);
  fs.writeFileSync(tmpPath, Buffer.from(buffer));
  return tmpPath;
}

function cleanupTempFile(filePath) {
  try { fs.unlinkSync(filePath); } catch {}
}

function cleanup() {
  if (whisperCtx) {
    try { whisperCtx.free(); } catch {}
    whisperCtx = null;
  }
}

module.exports = { isLocalWhisperAvailable, transcribeFile, transcribeBuffer, saveTempWav, cleanupTempFile, cleanup };
