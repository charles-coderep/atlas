// Base engine interface — all engines implement these methods

class BaseEngine {
  constructor(name) {
    this.name = name;
  }

  // Buffered response — returns full text
  async send(prompt, systemPrompt, options = {}) {
    throw new Error(`${this.name}: send() not implemented`);
  }

  // Streaming response — calls onChunk(text) as data arrives
  async sendStreaming(prompt, systemPrompt, options = {}, onChunk) {
    // Default: fall back to buffered
    const result = await this.send(prompt, systemPrompt, options);
    if (onChunk) onChunk(result);
    return result;
  }

  // Check if CLI is installed and responsive
  async isAvailable() {
    return false;
  }

  // Return capability flags
  getCapabilities() {
    return {
      streaming: false,
      toolUse: false,
      webSearch: false,
      localCli: false,
    };
  }
}

module.exports = BaseEngine;
