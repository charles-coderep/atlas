const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const BaseEngine = require('./base');
const { getRuntimeFile } = require('../runtime');

class CodexEngine extends BaseEngine {
  constructor() {
    super('codex');
    this.preferredModel = process.env.ATLAS_CODEX_MODEL || 'gpt-5.4';
  }

  _vendorTarget() {
    if (process.platform !== 'win32') return null;
    return process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  }

  _vendorRoot() {
    if (process.platform !== 'win32') return null;
    const target = this._vendorTarget();
    if (!target) return null;

    const archSuffix = process.arch === 'arm64' ? 'arm64' : 'x64';
    const candidates = [
      process.env.CODEX_VENDOR_ROOT,
      process.env.APPDATA
        ? path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${archSuffix}`, 'vendor', target)
        : null,
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${archSuffix}`, 'vendor', target),
    ].filter(Boolean);

    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  _bin() {
    if (process.platform !== 'win32') return 'codex';

    const vendorRoot = this._vendorRoot();
    if (vendorRoot) {
      const vendorBinary = path.join(vendorRoot, 'codex', 'codex.exe');
      if (fs.existsSync(vendorBinary)) return vendorBinary;
    }

    const candidates = [
      process.env.CODEX_PATH,
      process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'codex.cmd') : null,
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex.cmd'),
      'codex.cmd',
    ].filter(Boolean);

    return candidates.find((candidate) => {
      if (!path.isAbsolute(candidate)) return true;
      return fs.existsSync(candidate) && path.basename(candidate).toLowerCase() === 'codex.cmd';
    }) || 'codex.cmd';
  }

  _cwd(options = {}) {
    return options.cwd || process.cwd();
  }

  _codexHome() {
    return process.env.ATLAS_CODEX_HOME || process.env.CODEX_HOME || getRuntimeFile('codex-home');
  }

  _env() {
    const codexHome = this._codexHome();
    const env = { ...process.env };
    if (codexHome) {
      fs.mkdirSync(codexHome, { recursive: true });
      if (process.env.ATLAS_CODEX_HOME || process.env.CODEX_HOME) {
        env.CODEX_HOME = codexHome;
      }
    }

    const vendorRoot = this._vendorRoot();
    if (vendorRoot) {
      const pathDir = path.join(vendorRoot, 'path');
      if (fs.existsSync(pathDir)) {
        const sep = process.platform === 'win32' ? ';' : ':';
        env.PATH = [pathDir, env.PATH || ''].filter(Boolean).join(sep);
      }
    }

    return env;
  }

  _spawn(args, options = {}) {
    const bin = this._bin();
    if (process.platform === 'win32' && /\.cmd$/i.test(bin)) {
      const command = [bin, ...args].map((arg) => {
        const value = String(arg);
        return /[\s"]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
      }).join(' ');

      return spawn('cmd.exe', ['/d', '/s', '/c', command], {
        env: this._env(),
        windowsHide: true,
        ...options,
      });
    }

    return spawn(bin, args, {
      env: this._env(),
      windowsHide: true,
      ...options,
    });
  }

  _buildArgs(systemPrompt, options = {}) {
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--color',
      'never',
      '--sandbox',
      'read-only',
      '-C',
      this._cwd(options),
      '--model',
      options.model || this.preferredModel,
    ];

    if (options.useSearch) {
      args.push('--search');
    }

    return args;
  }

  _buildPrompt(prompt, systemPrompt) {
    if (!systemPrompt) return prompt;
    return `${systemPrompt}\n\nUser request:\n${prompt}`;
  }

  _buildOutputPath() {
    return path.join(os.tmpdir(), `atlas-codex-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  }

  _readOutput(outputPath, fallback = '') {
    try {
      if (fs.existsSync(outputPath)) {
        const content = fs.readFileSync(outputPath, 'utf-8').trim();
        if (content) return content;
      }
    } catch {}
    return fallback.trim();
  }

  _cleanupOutput(outputPath) {
    try { fs.unlinkSync(outputPath); } catch {}
  }

  _errorMessage(stderr, stdout, lastError) {
    return (lastError || stderr || stdout || '').trim();
  }

  _bufferState() {
    return {
      buffer: '',
      streamedText: '',
      lastError: '',
    };
  }

  _extractDeltaText(value) {
    if (!value) return '';
    if (Array.isArray(value)) {
      return value.map((item) => this._extractDeltaText(item)).join('');
    }
    if (typeof value !== 'object') return '';

    let text = '';
    for (const [key, nested] of Object.entries(value)) {
      if (['delta', 'text', 'chunk'].includes(key) && typeof nested === 'string') {
        text += nested;
        continue;
      }
      if (nested && typeof nested === 'object') {
        text += this._extractDeltaText(nested);
      }
    }
    return text;
  }

  _handleJsonStream(state, data, onChunk) {
    state.buffer += data.toString();
    const lines = state.buffer.split(/\r?\n/);
    state.buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      const eventType = String(event.type || '');
      if (/^error$/i.test(eventType)) {
        state.lastError = event.message || event.error?.message || line;
        continue;
      }
      if (/turn\.failed/i.test(eventType)) {
        state.lastError = event.error?.message || event.message || line;
        continue;
      }
      if (!/(delta|chunk|stream)/i.test(eventType)) continue;

      const text = this._extractDeltaText(event);
      if (!text) continue;

      state.streamedText += text;
      if (onChunk) onChunk(text);
    }
  }

  async send(prompt, systemPrompt, options = {}) {
    return new Promise((resolve, reject) => {
      const outputPath = this._buildOutputPath();
      const args = [...this._buildArgs(systemPrompt, options), '--output-last-message', outputPath, '-'];
      const proc = this._spawn(args);

      let stderr = '';
      let stdout = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        try {
          if (code !== 0) {
            reject(new Error(`Active AI engine (${this.name}) exited with code ${code}: ${this._errorMessage(stderr, stdout)}`));
            return;
          }

          resolve(this._readOutput(outputPath));
        } catch (err) {
          reject(new Error(`Active AI engine (${this.name}) returned an unreadable response: ${err.message}`));
        } finally {
          this._cleanupOutput(outputPath);
        }
      });

      proc.on('error', (err) => {
        this._cleanupOutput(outputPath);
        reject(new Error(`Failed to start active AI engine (${this.name}): ${err.message}`));
      });

      proc.stdin.write(this._buildPrompt(prompt, systemPrompt));
      proc.stdin.end();
    });
  }

  async sendStreaming(prompt, systemPrompt, options = {}, onChunk) {
    return new Promise((resolve, reject) => {
      const outputPath = this._buildOutputPath();
      const args = [...this._buildArgs(systemPrompt, options), '--json', '--output-last-message', outputPath, '-'];
      const proc = this._spawn(args);
      const state = this._bufferState();

      let stderr = '';
      let stdout = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        this._handleJsonStream(state, data, onChunk);
      });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        try {
          if (state.buffer.trim()) {
            this._handleJsonStream(state, '\n', onChunk);
          }

          if (code !== 0) {
            reject(new Error(`Active AI engine (${this.name}) exited with code ${code}: ${this._errorMessage(stderr, stdout, state.lastError)}`));
            return;
          }

          resolve(this._readOutput(outputPath, state.streamedText));
        } catch (err) {
          reject(new Error(`Active AI engine (${this.name}) returned an unreadable streamed response: ${err.message}`));
        } finally {
          this._cleanupOutput(outputPath);
        }
      });

      proc.on('error', (err) => {
        this._cleanupOutput(outputPath);
        reject(new Error(`Failed to start active AI engine (${this.name}): ${err.message}`));
      });

      proc.stdin.write(this._buildPrompt(prompt, systemPrompt));
      proc.stdin.end();
    });
  }

  async isAvailable() {
    const bin = this._bin();
    if (path.isAbsolute(bin) && fs.existsSync(bin)) return true;
    try {
      execFileSync(bin, ['--version'], { stdio: 'pipe', timeout: 5000, windowsHide: true, env: this._env() });
      return true;
    } catch {
      return false;
    }
  }

  getCapabilities() {
    return {
      streaming: true,
      toolUse: true,
      webSearch: true,
      localCli: true,
    };
  }

  getSearchOptions() {
    return { useSearch: true };
  }

  getPreferredModel() {
    return this.preferredModel;
  }
}

module.exports = CodexEngine;
