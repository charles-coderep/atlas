const { spawn, execSync } = require('child_process');
const BaseEngine = require('./base');

class ClaudeEngine extends BaseEngine {
  constructor() {
    super('claude');
  }

  _buildArgs(systemPrompt, options = {}) {
    const args = ['--print'];
    if (systemPrompt) args.push('--system-prompt', systemPrompt);
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
    return new Promise((resolve, reject) => {
      const args = this._buildArgs(systemPrompt, options);
      const proc = spawn('claude', args, { env: this._env(), windowsHide: true });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`claude CLI exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
      });

      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  }

  async sendStreaming(prompt, systemPrompt, options = {}, onChunk) {
    return new Promise((resolve, reject) => {
      const args = this._buildArgs(systemPrompt, options);
      const proc = spawn('claude', args, { env: this._env(), windowsHide: true });

      let fullOutput = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        fullOutput += text;
        if (onChunk) onChunk(text);
      });

      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`claude CLI exited with code ${code}: ${stderr}`));
        } else {
          resolve(fullOutput.trim());
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
      });

      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  }

  async isAvailable() {
    try {
      execSync('claude --version', { stdio: 'pipe', timeout: 5000, windowsHide: true });
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
}

module.exports = ClaudeEngine;
