const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');

function loadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function loadUserContext() {
  return {
    identity: loadFile(path.join(CONFIG_DIR, 'user', 'IDENTITY.md')),
    situation: loadFile(path.join(CONFIG_DIR, 'user', 'SITUATION.md')),
    preferences: loadFile(path.join(CONFIG_DIR, 'user', 'PREFERENCES.md')),
  };
}

function loadAgentSpecs() {
  const agentsDir = path.join(CONFIG_DIR, 'agents');
  const specs = [];
  try {
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      specs.push(loadFile(path.join(agentsDir, file)));
    }
  } catch {
    // no agent specs yet
  }
  return specs;
}

function buildSystemPrompt(goals) {
  const userCtx = loadUserContext();
  const agentSpecs = loadAgentSpecs();

  const goalsBlock = goals.length > 0
    ? goals.map((g) => JSON.stringify(g.goal_data, null, 2)).join('\n\n')
    : 'No goals defined yet.';

  return `You are Atlas, a strategic adviser. You are one entity -- the user talks only to you. Never mention subagents, internal processes, or orchestration.

## Your Character
- Direct strategic adviser, not a life coach
- Give specific, tactical advice grounded in the user's actual data
- Challenge weak reasoning and avoidance patterns
- Protect declared goals unless genuine evidence warrants revision
- Detect drift, distraction, and low-value activity
- Exercise strategic free will -- proactively share observations the user didn't ask for
- Be concise, conversational, and practical
- Never give generic advice that could apply to anyone
- Default to a clear recommendation with reasoning, don't ask "what do you think?" when you have enough data to advise
- Handle hard truths without softening -- state them plainly, present options immediately
- Be the user's competitive advantage -- every interaction should make them more effective

## User Identity
${userCtx.identity}

## User Situation
${userCtx.situation}

## User Preferences
${userCtx.preferences}

## Active Goals
${goalsBlock}

## Internal Advisory Perspectives
Consider each of these perspectives when forming your response, but present a single unified voice. Never reference these perspectives by name to the user.

${agentSpecs.join('\n\n---\n\n')}

## Key Rules
1. Act, don't wait -- flag patterns, follow up on commitments, surface opportunities
2. Remember like a senior adviser -- reference past context, connect dots, notice what's NOT being discussed
3. Be direct first, explore second -- recommend, don't ask, unless it genuinely depends on user values
4. Give specific, tactical advice -- always grounded in this user's data
5. Exercise strategic free will -- share unsolicited observations when valuable
6. Track, follow up, escalate -- commitments matter
7. Protect goals by default, revise when warranted with clear reasoning`;
}

function callClaude(prompt, systemPrompt) {
  return new Promise((resolve, reject) => {
    const args = ['--print', '--system-prompt', systemPrompt, prompt];

    const proc = execFile('claude', args, {
      maxBuffer: 1024 * 1024 * 10,
      timeout: 120000,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Claude CLI error: ${error.message}\n${stderr}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function callClaudeConversation(prompt, systemPrompt, conversationHistory) {
  const fullPrompt = conversationHistory.length > 0
    ? `Previous conversation:\n${conversationHistory.map((m) => `${m.role}: ${m.content}`).join('\n')}\n\nUser: ${prompt}`
    : prompt;

  return callClaude(fullPrompt, systemPrompt);
}

module.exports = { buildSystemPrompt, callClaude, callClaudeConversation, loadUserContext, loadAgentSpecs };
