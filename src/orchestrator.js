const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  getRecentSessions, getOpenActions, getOverdueActions,
  getPersistentEntries, getRecentEntries,
} = require('./db');

const crypto = require('crypto');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const TOKEN_CEILING = 6000;

// --- Diagnostics state ---
let lastDiagnostics = null;

// --- File loading ---

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
  } catch {}
  return specs;
}

function loadMethodology() {
  const raw = loadFile(path.join(CONFIG_DIR, 'engine', 'methodology.md'));
  if (!raw.trim()) return '';

  // Only load content up to "## Research anchors" — the rest is reference material
  const cutoff = raw.indexOf('## Research anchors');
  const content = cutoff > 0 ? raw.substring(0, cutoff).trim() : raw.trim();
  return content;
}

// --- Placeholder detection ---

function hasPlaceholders(content) {
  return /\[.*to be filled.*\]/i.test(content) || /\[.*user'?s? name.*\]/i.test(content);
}

function checkUserContextFiles() {
  const ctx = loadUserContext();
  const warnings = [];

  if (hasPlaceholders(ctx.identity)) {
    warnings.push('IDENTITY.md — Your stable identity (name, background, communication style). Edit: config/user/IDENTITY.md');
  }
  if (hasPlaceholders(ctx.situation)) {
    warnings.push('SITUATION.md — Your current situation (employment, finances, living). Edit: config/user/SITUATION.md');
  }
  if (hasPlaceholders(ctx.preferences)) {
    warnings.push('PREFERENCES.md — Your advisory preferences (directness, working style). Edit: config/user/PREFERENCES.md');
  }

  return warnings;
}

// --- Context formatting with ownership labels ---

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function formatActions(actions) {
  if (actions.length === 0) return 'None.';
  return actions.map((a) => {
    const due = a.due_date ? ` (due: ${a.due_date})` : '';
    const followups = a.follow_up_count > 0 ? ` [followed up ${a.follow_up_count}x]` : '';
    return `- [auto-captured] ${a.description}${due}${followups}`;
  }).join('\n');
}

function formatSessions(sessions) {
  if (sessions.length === 0) return 'No recent sessions.';
  return sessions
    .filter((s) => s.summary)
    .map((s) => `[auto-captured] [${s.date}] ${s.summary}`)
    .join('\n\n');
}

function formatEntries(entries) {
  if (entries.length === 0) return 'None.';
  return entries.map((e) => {
    const goal = e.goal_id ? ` (${e.goal_id})` : '';
    const source = e.source === 'session' ? 'auto-captured' : e.source;
    return `- [${source}] [${e.entry_type}/${e.domain}]${goal} ${e.content}`;
  }).join('\n');
}

// --- Context ranking ---

function rankContextSections(recentEntries, recentSessions, persistentEntries, calendarData, emailData) {
  const sections = [];

  if (emailData) {
    const { formatEmailsForPrompt } = require('./integrations/gmail');
    const content = formatEmailsForPrompt(emailData);
    if (content) {
      sections.push({ label: 'Email Context', content: `## Email Context [auto-captured]\n${content}`, priority: 1, items: emailData.summaries || [] });
    }
  }

  if (calendarData) {
    const { formatCalendarForPrompt } = require('./integrations/calendar');
    const content = formatCalendarForPrompt(calendarData);
    if (content) {
      sections.push({ label: 'Calendar', content: `## Calendar [auto-captured]\n${content}`, priority: 2, items: calendarData.thisWeek });
    }
  }

  if (recentEntries.length > 0) {
    sections.push({
      label: 'Recent Context',
      content: `## Recent Context (last 7 days) [auto-captured]\n${formatEntries(recentEntries)}`,
      priority: 3,
      items: recentEntries,
    });
  }

  if (recentSessions.length > 0) {
    sections.push({
      label: 'Recent Sessions',
      content: `## Recent Session History [auto-captured]\n${formatSessions(recentSessions)}`,
      priority: 4,
      items: recentSessions,
    });
  }

  if (persistentEntries.length > 0) {
    sections.push({
      label: 'Persistent Memory',
      content: `## Persistent Memory [auto-captured]\n${formatEntries(persistentEntries)}`,
      priority: 5,
      items: persistentEntries,
    });
  }

  return sections.sort((a, b) => a.priority - b.priority);
}

// --- System prompt builder ---

async function buildSystemPrompt(goals, options = {}) {
  const userCtx = loadUserContext();
  const agentSpecs = loadAgentSpecs();
  const methodology = loadMethodology();

  const goalsBlock = goals.length > 0
    ? goals.map((g) => JSON.stringify(g.goal_data, null, 2)).join('\n\n')
    : 'No goals defined yet.';

  const [recentSessions, openActions, overdueActions, persistentEntries, recentEntries] =
    await Promise.all([
      getRecentSessions(7),
      getOpenActions(),
      getOverdueActions(),
      getPersistentEntries(),
      getRecentEntries(7),
    ]);

  const calendarData = options.calendarData || null;
  const emailData = options.emailData || null;
  const extraContext = options.extraContext || '';

  // Core sections — never trimmed
  const coreSections = `You are Atlas, a strategic adviser. You are one entity -- the user talks only to you. Never mention subagents, internal processes, or orchestration.

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

## User Identity [user-maintained]
${userCtx.identity}

## User Situation [user-maintained]
${userCtx.situation}

## User Preferences [user-maintained]
${userCtx.preferences}

## Active Goals [user-maintained]
${goalsBlock}

## Open Action Items [auto-captured]
${formatActions(openActions)}
${overdueActions.length > 0 ? `\n⚠️ OVERDUE:\n${formatActions(overdueActions)}` : ''}

## Internal Advisory Perspectives
Consider each of these perspectives when forming your response, but present a single unified voice. Never reference these perspectives by name to the user.

${agentSpecs.join('\n\n---\n\n')}
${methodology ? `\n\n## Advisory Methodology\n${methodology}` : ''}
${extraContext ? `\n## Additional Context\n${extraContext}` : ''}

## Memory Source Labels
Context marked [user-maintained] was written by the user. Context marked [auto-captured] was extracted automatically from sessions. Context marked [AI-suggested] was proposed by Atlas and approved by the user. Treat user-maintained facts as ground truth. Treat auto-captured context as reliable but possibly incomplete. Note the source when relevant to your advice.

## Key Rules
1. Act, don't wait -- flag patterns, follow up on commitments, surface opportunities
2. Remember like a senior adviser -- reference past context, connect dots, notice what's NOT being discussed
3. Be direct first, explore second -- recommend, don't ask, unless it genuinely depends on user values
4. Give specific, tactical advice -- always grounded in this user's data
5. Exercise strategic free will -- share unsolicited observations when valuable
6. Track, follow up, escalate -- commitments matter
7. Protect goals by default, revise when warranted with clear reasoning
8. Never state personal facts about the user's finances, employment, or situation as known unless they appear explicitly in the user context files, goal records, or session history. If you are inferring, say so clearly.
9. When citing market statistics or specific numbers, note whether this is from your general knowledge or verified data. Do not soften strategic judgments -- only separate what you know from what you are assuming.
10. You have access to web search. Use it when you need current information -- job listings, company details, market data, news, or any factual claim you are not certain about. Do not guess at statistics or current facts when you could search instead. If you need to search, output [SEARCH: your query] and the system will execute it.
11. You can recall past memory by outputting [RECALL: topic]. The system will search archived entries and feed results back to you.
12. You can search the user's email history by outputting [EMAIL_SEARCH: query]. Use Gmail search syntax (sender, subject keywords, date ranges). Use this when you need older email context beyond the current session's scanned window.
13. Never reference your own build documentation, phase plans, internal project files, or development process in advisory conversations. You are Atlas the adviser, not a software project. If the user asks about Atlas itself, keep the answer brief and redirect to their goals.`;

  // Build trimmable sections with context ranking
  const trimmableSections = rankContextSections(
    recentEntries, recentSessions, persistentEntries, calendarData, emailData
  );

  // Assemble with deterministic trimming
  let prompt = coreSections;
  let currentTokens = estimateTokens(prompt);
  const includedSections = [];
  const trimmedSections = [];

  for (const section of trimmableSections) {
    const sectionTokens = estimateTokens(section.content);
    if (currentTokens + sectionTokens <= TOKEN_CEILING) {
      prompt += '\n\n' + section.content;
      currentTokens += sectionTokens;
      includedSections.push({ label: section.label, tokens: sectionTokens, items: section.items.length });
    } else {
      const items = [...section.items];
      let trimmedContent = '';
      let fitted = false;

      while (items.length > 0) {
        items.pop();
        if (section.label === 'Recent Sessions') {
          trimmedContent = `## Recent Session History [auto-captured]\n${formatSessions(items)}`;
        } else if (section.label === 'Calendar' || section.label === 'Email Context') {
          break;
        } else {
          trimmedContent = `## ${section.label} [auto-captured]\n${formatEntries(items)}`;
        }
        if (items.length > 0 && currentTokens + estimateTokens(trimmedContent) <= TOKEN_CEILING) {
          prompt += '\n\n' + trimmedContent;
          const trimTokens = estimateTokens(trimmedContent);
          currentTokens += trimTokens;
          includedSections.push({ label: section.label, tokens: trimTokens, items: items.length, trimmed: true });
          console.log(`  [Context trimmed: ${section.label} reduced to ${items.length} items]`);
          fitted = true;
          break;
        }
      }

      if (!fitted) {
        trimmedSections.push(section.label);
      }

      if (currentTokens >= TOKEN_CEILING) break;
    }
  }

  // Store diagnostics
  lastDiagnostics = {
    timestamp: new Date().toISOString(),
    totalTokens: currentTokens,
    tokenCeiling: TOKEN_CEILING,
    coreTokens: estimateTokens(coreSections),
    includedSections,
    trimmedSections,
    counts: {
      goals: goals.length,
      openActions: openActions.length,
      overdueActions: overdueActions.length,
      persistentEntries: persistentEntries.length,
      recentEntries: recentEntries.length,
      recentSessions: recentSessions.length,
      hasCalendar: !!calendarData,
      hasEmail: !!emailData,
      calendarEvents: calendarData ? (calendarData.today || []).length : 0,
      emailTriaged: emailData ? (emailData.triageCount || 0) : 0,
      emailDeepRead: emailData ? (emailData.deepReadCount || 0) : 0,
    },
  };

  return prompt;
}

function getLastDiagnostics() {
  return lastDiagnostics;
}

function generateGoalId() {
  return 'goal_' + crypto.randomUUID().split('-')[0];
}

// --- AI engine abstraction ---

const AI_ENGINES = {
  claude: {
    command: 'claude',
    buildArgs(systemPrompt, options = {}) {
      const args = ['--print'];
      if (systemPrompt) args.push('--system-prompt', systemPrompt);
      // Restrict tools to prevent project context leaking into advisory sessions
      args.push('--tools', '');
      // Add any extra allowed tools (e.g. web search)
      if (options.allowedTools && options.allowedTools.length > 0) {
        args.push('--allowedTools', ...options.allowedTools);
      }
      return args;
    },
    env() {
      return { ...process.env, CLAUDECODE: undefined };
    },
  },
  openai: {
    command: 'codex',
    buildArgs(systemPrompt, options = {}) {
      const args = ['--print'];
      if (systemPrompt) args.push('--system-prompt', systemPrompt);
      return args;
    },
    env() {
      return { ...process.env };
    },
  },
};

function getEngine() {
  const name = (process.env.AI_ENGINE || 'claude').toLowerCase();
  const engine = AI_ENGINES[name];
  if (!engine) {
    throw new Error(`Unknown AI_ENGINE "${name}". Supported: ${Object.keys(AI_ENGINES).join(', ')}`);
  }
  return engine;
}

function callClaude(prompt, systemPrompt, options = {}) {
  return new Promise((resolve, reject) => {
    const engine = getEngine();
    const args = engine.buildArgs(systemPrompt, options);

    const proc = spawn(engine.command, args, {
      env: engine.env(),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${engine.command} CLI exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ${engine.command} CLI: ${err.message}`));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function callClaudeConversation(prompt, systemPrompt, conversationHistory) {
  const fullPrompt = conversationHistory.length > 0
    ? `Previous conversation:\n${conversationHistory.map((m) => `${m.role}: ${m.content}`).join('\n')}\n\nUser: ${prompt}`
    : prompt;

  return callClaude(fullPrompt, systemPrompt);
}

module.exports = {
  buildSystemPrompt, callClaude, callClaudeConversation,
  loadUserContext, loadAgentSpecs, checkUserContextFiles,
  getLastDiagnostics, generateGoalId,
};
