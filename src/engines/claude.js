const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync, execSync } = require('child_process');
const BaseEngine = require('./base');

class ClaudeEngine extends BaseEngine {
  constructor() {
    super('claude');
    this.preferredModel = process.env.ATLAS_CLAUDE_MODEL || 'claude-opus-4-6';
  }

  _bin() {
    if (process.platform !== 'win32') return 'claude';
    const candidates = [
      process.env.CLAUDE_PATH,
      path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
      'claude',
    ].filter(Boolean);
    return candidates.find((candidate) => !path.isAbsolute(candidate) || fs.existsSync(candidate)) || 'claude';
  }

  _writeSystemPromptFile(systemPrompt) {
    if (!systemPrompt) return null;
    const tmpPath = path.join(os.tmpdir(), `atlas-sp-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
    fs.writeFileSync(tmpPath, systemPrompt, 'utf-8');
    return tmpPath;
  }

  _cleanupFile(filePath) {
    try { if (filePath) fs.unlinkSync(filePath); } catch {}
  }

  _buildArgs(systemPromptFile, options = {}) {
    const args = ['--print'];
    args.push('--model', options.model || this.preferredModel);
    // Use --system-prompt-file to avoid ENAMETOOLONG on Windows.
    // The previous --system-prompt flag passed the entire prompt as a CLI
    // argument which exceeds the OS command-line length limit (~32K chars).
    if (systemPromptFile) args.push('--system-prompt-file', systemPromptFile);
    args.push('--tools', '');
    if (options.allowedTools && options.allowedTools.length > 0) {
      args.push('--allowedTools', ...options.allowedTools);
    }
    return args;
  }

  _env() {
    return { ...process.env, CLAUDECODE: undefined };
  }

  async send(prompt, systemPrompt, options = {}) {
    const spFile = this._writeSystemPromptFile(systemPrompt);
    return new Promise((resolve, reject) => {
      const args = this._buildArgs(spFile, options);
      const proc = spawn(this._bin(), args, { env: this._env(), windowsHide: true });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        this._cleanupFile(spFile);
        if (code !== 0) {
          reject(new Error(`Active AI engine (${this.name}) exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      });

      proc.on('error', (err) => {
        this._cleanupFile(spFile);
        reject(new Error(`Failed to start active AI engine (${this.name}): ${err.message}`));
      });

      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  }

  async sendStreaming(prompt, systemPrompt, options = {}, onChunk) {
    const spFile = this._writeSystemPromptFile(systemPrompt);
    return new Promise((resolve, reject) => {
      const args = this._buildArgs(spFile, options);
      const proc = spawn(this._bin(), args, { env: this._env(), windowsHide: true });

      let fullOutput = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        fullOutput += text;
        if (onChunk) onChunk(text);
      });

      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        this._cleanupFile(spFile);
        if (code !== 0) {
          reject(new Error(`Active AI engine (${this.name}) exited with code ${code}: ${stderr}`));
        } else {
          resolve(fullOutput.trim());
        }
      });

      proc.on('error', (err) => {
        this._cleanupFile(spFile);
        reject(new Error(`Failed to start active AI engine (${this.name}): ${err.message}`));
      });

      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  }

  async isAvailable() {
    const bin = this._bin();
    if (path.isAbsolute(bin) && fs.existsSync(bin)) return true;
    try {
      if (process.platform === 'win32') {
        execFileSync(bin, ['--version'], { stdio: 'pipe', timeout: 5000, windowsHide: true, env: this._env() });
      } else {
        execSync('claude --version', { stdio: 'pipe', timeout: 5000, windowsHide: true });
      }
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
    return { allowedTools: ['mcp__claude-web-search__web_search'] };
  }

  getPreferredModel() {
    return this.preferredModel;
  }
}

module.exports = ClaudeEngine;
