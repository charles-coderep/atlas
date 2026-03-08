const fs = require('fs');
const path = require('path');
const {
  getRecentSessions, getOpenActions, getOverdueActions,
  getPersistentEntries, getRecentEntries,
} = require('./db');

const crypto = require('crypto');
const { getRuntimeFile, readRuntimeJson, writeRuntimeJson } = require('./runtime');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const TOKEN_CEILING = 6000;
const SETTINGS_FILE = 'settings.json';
const VALID_TONES = ['supportive', 'direct', 'challenging', 'uncompromising'];

const TONE_METADATA = {
  supportive: {
    name: 'Supportive',
    description: 'Encouraging first, honest underneath. Frames challenges as opportunities.',
  },
  direct: {
    name: 'Direct',
    description: 'Plain-spoken and efficient. Says it once, clearly, and moves on.',
  },
  challenging: {
    name: 'Challenging',
    description: 'Pushes harder. Holds commitments to a high standard.',
  },
  uncompromising: {
    name: 'Uncompromising',
    description: 'Maximum directness. No cushioning. Sharpest possible feedback.',
  },
};

const DEFAULT_CONTEXT_SOURCES = {
  gmail: 'included',
  calendar: 'included',
  files: 'included',
  web_search: 'included',
  memory: 'included',
  agents: ['meta-analyst'],
};

const AGENT_DEFAULTS_BY_TYPE = {
  career:        ['job-search', 'financial', 'day-planner', 'learning'],
  financial:     ['financial', 'day-planner'],
  learning:      ['learning', 'day-planner'],
  health:        ['nutrition', 'fitness', 'day-planner', 'habit-formation'],
  business:      ['financial', 'day-planner', 'learning'],
  personal:      ['day-planner'],
  relationships: ['communication', 'day-planner'],
  creative:      ['creative-process', 'day-planner', 'learning'],
};

const PERSPECTIVE_FALLBACK = ['meta-analyst', 'day-planner'];

function getGoalSourcePolicy(goals) {
  // Merge source policies across all active goals
  // A source is included if ANY active goal includes it
  const merged = { gmail: false, calendar: false, files: false, web_search: false, memory: false };
  for (const g of goals) {
    const sources = (g.goal_data && g.goal_data.context_sources) || DEFAULT_CONTEXT_SOURCES;
    for (const key of Object.keys(merged)) {
      if (sources[key] === 'included') merged[key] = true;
    }
  }
  return merged;
}

function getExcludedByGoal(goals) {
  // Returns which sources are excluded per goal (for diagnostics)
  const exclusions = [];
  for (const g of goals) {
    const sources = (g.goal_data && g.goal_data.context_sources) || DEFAULT_CONTEXT_SOURCES;
    for (const [key, val] of Object.entries(sources)) {
      if (val === 'excluded') {
        exclusions.push({ goal: g.title || g.id, source: key });
      }
    }
  }
  return exclusions;
}

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

function listAgentFiles() {
  const agentsDir = path.join(CONFIG_DIR, 'agents');
  try {
    return fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  } catch { return []; }
}

function loadAgentSpecs(agentNames) {
  const agentsDir = path.join(CONFIG_DIR, 'agents');
  const specs = [];
  try {
    const files = listAgentFiles();
    for (const file of files) {
      if (agentNames) {
        const name = file.replace(/\.md$/, '');
        if (!agentNames.includes(name)) continue;
      }
      specs.push({ name: file.replace(/\.md$/, ''), content: loadFile(path.join(agentsDir, file)) });
    }
  } catch {}
  return specs;
}

function getGoalAgentPolicy(goals) {
  // Union agent lists across all active goals, always include meta-analyst
  const agentSet = new Set(['meta-analyst']);

  for (const g of goals) {
    const sources = (g.goal_data && g.goal_data.context_sources) || DEFAULT_CONTEXT_SOURCES;
    const agents = Array.isArray(sources.agents) ? sources.agents : DEFAULT_CONTEXT_SOURCES.agents;
    for (const a of agents) agentSet.add(a);
  }

  return [...agentSet];
}

// Migrate a goal's context_sources to ensure agents is always an explicit array
function migrateGoalSources(goalData, type) {
  if (!goalData.context_sources) {
    goalData.context_sources = { ...DEFAULT_CONTEXT_SOURCES };
  }
  if (!Array.isArray(goalData.context_sources.agents)) {
    const typeAgents = AGENT_DEFAULTS_BY_TYPE[type || goalData.type] || PERSPECTIVE_FALLBACK;
    goalData.context_sources.agents = [...new Set([...typeAgents, 'meta-analyst'])];
  }
  return goalData;
}

// Generate a perspective file via Claude
async function generatePerspective(name, domain) {
  const prompt = `Create an advisory perspective file for "${domain}". Follow this exact format:

# [Perspective Name]

## Role
[1-2 sentences describing what this perspective focuses on]

## Focus Areas
- [Area 1]
- [Area 2]
- [Area 3]
- [Area 4]

## Output Format
[1 sentence: how insights from this perspective should be structured]

Keep it under 25 lines. Be specific to the domain, not generic. The perspective name should be a professional title.`;

  const content = await callClaude(prompt, 'You create concise advisory perspective files. Output only the markdown content, nothing else.');
  const agentsDir = path.join(CONFIG_DIR, 'agents');
  const filePath = path.join(agentsDir, `${name}.md`);
  fs.writeFileSync(filePath, content.trim(), 'utf-8');
  return content.trim();
}

function perspectiveExists(name) {
  return fs.existsSync(path.join(CONFIG_DIR, 'agents', `${name}.md`));
}

function loadMethodology() {
  const raw = loadFile(path.join(CONFIG_DIR, 'engine', 'methodology.md'));
  if (!raw.trim()) return '';

  // Only load content up to "## Research anchors" — the rest is reference material
  const cutoff = raw.indexOf('## Research anchors');
  const content = cutoff > 0 ? raw.substring(0, cutoff).trim() : raw.trim();
  return content;
}

function normalizeToneName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_TONES.includes(normalized) ? normalized : 'direct';
}

function getRuntimeSettings() {
  return readRuntimeJson(SETTINGS_FILE, { activeTone: 'direct' });
}

function writeRuntimeSettings(nextSettings) {
  const current = getRuntimeSettings();
  const merged = { ...current, ...nextSettings };
  writeRuntimeJson(SETTINGS_FILE, merged);
  return merged;
}

function getSelectedTone() {
  return normalizeToneName(getRuntimeSettings().activeTone || 'direct');
}

function getToneFilePath(name) {
  return path.join(CONFIG_DIR, 'tone', `${normalizeToneName(name)}.md`);
}

function loadToneOverlay(name = getSelectedTone()) {
  const selected = normalizeToneName(name);
  const filePath = getToneFilePath(selected);
  let content = loadFile(filePath).trim();
  let resolvedName = selected;

  if (!content) {
    resolvedName = 'direct';
    content = loadFile(getToneFilePath('direct')).trim();
  }

  return {
    name: resolvedName,
    filePath: getToneFilePath(resolvedName),
    content,
    ...TONE_METADATA[resolvedName],
  };
}

function formatDirectnessLine(toneName) {
  switch (normalizeToneName(toneName)) {
    case 'supportive':
      return '- **Directness level:** Supportive -- encouraging first, collaborative, and careful with difficult feedback';
    case 'challenging':
      return '- **Directness level:** Challenging -- push hard, call out drift early, and hold commitments to a high standard';
    case 'uncompromising':
      return '- **Directness level:** Uncompromising -- maximum directness, no cushioning, sharp feedback when the plan is weak';
    case 'direct':
    default:
      return '- **Directness level:** Direct -- plain-spoken, balanced, and efficient';
  }
}

function syncPreferencesTone(toneName) {
  const filePath = path.join(CONFIG_DIR, 'user', 'PREFERENCES.md');
  const directnessLine = formatDirectnessLine(toneName);
  let content = loadFile(filePath);

  if (!content.trim()) {
    content = `# Preferences\n\n${directnessLine}\n`;
  } else if (/\- \*\*Directness level:\*\*.*/i.test(content)) {
    content = content.replace(/\- \*\*Directness level:\*\*.*/i, directnessLine);
  } else {
    content = `${content.trim()}\n${directnessLine}\n`;
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  return content;
}

function setSelectedTone(name) {
  const normalized = normalizeToneName(name);
  writeRuntimeSettings({ activeTone: normalized });
  syncPreferencesTone(normalized);
  return loadToneOverlay(normalized);
}

function mapDirectnessToTone(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return 'direct';

  if (VALID_TONES.includes(raw)) return raw;
  if (['low', 'gentle', 'supportive', 'soft', 'be gentle'].includes(raw)) return 'supportive';
  if (['medium', 'balanced', 'normal', 'direct', 'be balanced'].includes(raw)) return 'direct';
  if (['high', 'tough', 'challenge me', 'push hard', 'challenging'].includes(raw)) return 'challenging';
  if (['brutal', 'no filter', 'maximum', 'uncompromising'].includes(raw)) return 'uncompromising';

  const numeric = Number(raw);
  if (!Number.isNaN(numeric)) {
    if (numeric <= 2) return 'supportive';
    if (numeric === 3) return 'direct';
    if (numeric === 4) return 'challenging';
    if (numeric >= 5) return 'uncompromising';
  }

  if (raw.includes('gentle') || raw.includes('support')) return 'supportive';
  if (raw.includes('brutal') || raw.includes('no filter') || raw.includes('maximum')) return 'uncompromising';
  if (raw.includes('challenge') || raw.includes('push') || raw.includes('tough')) return 'challenging';
  return 'direct';
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
  const startedAt = Date.now();
  const userCtx = loadUserContext();
  const agentPolicy = getGoalAgentPolicy(goals);
  const agentSpecs = loadAgentSpecs(agentPolicy);
  const methodology = loadMethodology();
  const toneOverlay = loadToneOverlay();

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

  // Goal-aware source filtering
  const sourcePolicy = getGoalSourcePolicy(goals);
  const sourceExclusions = getExcludedByGoal(goals);

  const calendarData = sourcePolicy.calendar ? (options.calendarData || null) : null;
  const emailData = sourcePolicy.gmail ? (options.emailData || null) : null;
  const extraContext = options.extraContext || '';

  // Core sections — never trimmed
  const coreSections = `You are Atlas, a strategic adviser. You are one entity -- the user talks only to you. Never mention subagents, internal processes, or orchestration.

## Your Character
You are Atlas - a calm, sharp strategic adviser. You speak like a trusted senior colleague: warm but honest, precise but human.

- Lead with a clear recommendation and your reasoning. Only ask questions when the decision genuinely depends on the user's values or preferences.
- Ground every piece of advice in this user's actual data, goals, and situation. Generic advice has no place here.
- When something is going wrong - drift, avoidance, weak reasoning - name it plainly and move straight to what you recommend instead. State the issue once, clearly, without dramatic framing.
- Protect the user's declared goals. If they are drifting, say so and explain the cost. If the goal should genuinely change, explain why with evidence.
- Share observations the user did not ask for when they are strategically valuable. Do not wait to be prompted on important patterns.
- Speak conversationally. Keep responses concise and structured. Say each point once - do not restate in different words.
- When you are uncertain, say so. Separate what you know from what you are inferring. Your confidence in the recommendation matters as much as the recommendation itself.
- You are one adviser with one voice. Never reference internal systems, file names, perspectives, or orchestration. The user talks to Atlas, not to software.
- If asked what model or AI you are during a conversation, say you are Atlas. Do not name your underlying engine or provider in chat. The Settings and Diagnostics screens may show the engine name for debugging purposes - that is fine.

## Adviser Style
${toneOverlay.content}

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

${agentSpecs.map(s => s.content).join('\n\n---\n\n')}
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
8. Distinguish what you know from what you are inferring. Known facts come from the user's context, goals, session history, or retrieved data. When making a strong recommendation based materially on inference, briefly state what you are basing it on: "Based on your goal listing four role families, I'm assuming you have multiple CV variants - correct me if that's wrong."
9. When citing statistics, market data, or specific numbers, note whether this is from your general knowledge or from a search. Use web search when available and when current data would strengthen the recommendation rather than guessing.
10. You have access to web search. Use it when you need current information -- job listings, company details, market data, news, or any factual claim you are not certain about. Do not guess at statistics or current facts when you could search instead. If you need to search, output [SEARCH: your query] and the system will execute it.
11. You can recall past memory by outputting [RECALL: topic]. The system will search archived entries and feed results back to you.
12. You can search the user's email history by outputting [EMAIL_SEARCH: query]. Use Gmail search syntax (sender, subject keywords, date ranges). Use this when you need older email context beyond the current session's scanned window.
13. Never reference your own build documentation, phase plans, internal project files, or development process in advisory conversations. You are Atlas the adviser, not a software project. If the user asks about Atlas itself, keep the answer brief and redirect to their goals.
14. Keep responses concise. Do not restate the same point in different words within a single response. Say it once, clearly, and move on.
15. If the user explicitly says this is a test session, that they are building the app, or that they just set up Atlas, treat that session as exploratory. Acknowledge the context. Do not treat test interactions as evidence of drift or missed commitments.`;

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
    sourcePolicy,
    sourceExclusions,
    agentPolicy,
    loadedAgents: agentSpecs.map(s => s.name),
    availableAgents: listAgentFiles().map(f => f.replace(/\.md$/, '')),
  };

  console.log(`[Timing] System prompt built in ${Date.now() - startedAt}ms`);
  return prompt;
}

function getLastDiagnostics() {
  return lastDiagnostics;
}

function generateGoalId() {
  return 'goal_' + crypto.randomUUID().split('-')[0];
}

// --- AI engine abstraction ---

const ClaudeEngine = require('./engines/claude');
const CodexEngine = require('./engines/codex');

const engines = {
  claude: new ClaudeEngine(),
  codex: new CodexEngine(),
};

const ENGINE_SETTINGS_FILE = getRuntimeFile('engine-settings.json');

function loadPersistedEngineName() {
  const parsed = readRuntimeJson('engine-settings.json', {});
  if (parsed && typeof parsed.activeEngine === 'string') {
    return parsed.activeEngine.toLowerCase();
  }
  return null;
}

function persistEngineName(name) {
  writeRuntimeJson('engine-settings.json', { activeEngine: name });
}

let activeEngineName = (loadPersistedEngineName() || process.env.AI_ENGINE || 'claude').toLowerCase();

function getEngine() {
  const engine = engines[activeEngineName];
  if (!engine) {
    throw new Error(`Unknown AI_ENGINE "${activeEngineName}". Supported: ${Object.keys(engines).join(', ')}`);
  }
  return engine;
}

function setEngine(name) {
  const normalized = String(name || '').toLowerCase();
  if (!engines[normalized]) {
    throw new Error(`Unknown engine "${name}". Supported: ${Object.keys(engines).join(', ')}`);
  }
  activeEngineName = normalized;
  persistEngineName(activeEngineName);
}

function getActiveEngineName() {
  return activeEngineName;
}

async function getAvailableEngines() {
  const entries = await Promise.all(Object.keys(engines).map(async (name) => {
    let available = false;
    try {
      available = await engines[name].isAvailable();
    } catch {}
    return {
      name,
      active: name === activeEngineName,
      available,
      model: typeof engines[name].getPreferredModel === 'function' ? engines[name].getPreferredModel() : null,
      capabilities: engines[name].getCapabilities(),
    };
  }));
  return entries.map((entry) => ({
    ...entry,
    label: `${entry.available ? 'Available' : 'Unavailable'}${entry.active ? ' - selected' : ''}`,
  }));
}

function getAvailableTones() {
  const selected = getSelectedTone();
  return VALID_TONES.map((tone) => ({
    id: tone,
    selected: tone === selected,
    filePath: getToneFilePath(tone),
    ...TONE_METADATA[tone],
  }));
}

module.exports = {
  buildSystemPrompt, callClaude, callClaudeStreaming, callClaudeConversation,
  loadUserContext, loadAgentSpecs, listAgentFiles, checkUserContextFiles,
  getLastDiagnostics, generateGoalId, DEFAULT_CONTEXT_SOURCES, AGENT_DEFAULTS_BY_TYPE,
  migrateGoalSources, generatePerspective, perspectiveExists,
  getEngine, setEngine, getAvailableEngines, getActiveEngineName,
  getSelectedTone, setSelectedTone, getAvailableTones, loadToneOverlay, mapDirectnessToTone, syncPreferencesTone,
};

async function callClaude(prompt, systemPrompt, options = {}) {
  const startedAt = Date.now();
  const label = options.label || 'Active AI engine responded';
  const result = await getEngine().send(prompt, systemPrompt, options);
  console.log(`[Timing] ${label} in ${Date.now() - startedAt}ms`);
  return result;
}

async function callClaudeStreaming(prompt, systemPrompt, options = {}, onChunk) {
  const startedAt = Date.now();
  let firstChunkAt = null;
  const result = await getEngine().sendStreaming(prompt, systemPrompt, options, (chunk) => {
    if (firstChunkAt === null) {
      firstChunkAt = Date.now();
      console.log(`[Timing] Active AI engine first streaming chunk in ${firstChunkAt - startedAt}ms`);
    }
    if (onChunk) onChunk(chunk);
  });
  console.log(`[Timing] Active AI engine responded in ${Date.now() - startedAt}ms`);
  return result;
}

function callClaudeConversation(prompt, systemPrompt, conversationHistory) {
  const fullPrompt = conversationHistory.length > 0
    ? `Previous conversation:\n${conversationHistory.map((m) => `${m.role}: ${m.content}`).join('\n')}\n\nUser: ${prompt}`
    : prompt;

  return callClaude(fullPrompt, systemPrompt);
}
