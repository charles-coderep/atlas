const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');

// Load .env before anything else
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/db');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Atlas',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(async () => {
  try {
    await db.initDB();
  } catch (err) {
    console.error('Database init failed:', err.message);
  }

  createWindow();
  registerIPC();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC Registration ---

function registerIPC() {
  // --- DB: Goals ---
  ipcMain.handle('goals:getActive', async () => {
    const goals = await db.getActiveGoals();
    console.log('[IPC] goals:getActive returned', goals.length, 'goals');
    if (goals.length === 0) {
      const all = await db.getAllGoals();
      console.log('[IPC] All goals:', all.map(g => `${g.id}="${g.title}" status=${g.status}`).join(' | '));
    }
    return goals;
  });
  ipcMain.handle('goals:getAll', () => db.getAllGoals());
  ipcMain.handle('goals:get', (_, id) => db.getGoal(id));
  ipcMain.handle('goals:save', (_, goal) => db.saveGoal(goal));
  ipcMain.handle('goals:updateStatus', (_, id, status) => db.updateGoalStatus(id, status));

  // --- DB: Actions ---
  ipcMain.handle('actions:getOpen', () => db.getOpenActions());
  ipcMain.handle('actions:getOverdue', () => db.getOverdueActions());
  ipcMain.handle('actions:getCompleted', () => db.getCompletedActions());
  ipcMain.handle('actions:getAll', () => db.getAllActions());
  ipcMain.handle('actions:update', (_, id, updates) => db.updateAction(id, updates));
  ipcMain.handle('actions:save', (_, action) => db.saveAction(action));

  // --- DB: Sessions ---
  ipcMain.handle('sessions:getRecent', (_, days) => db.getRecentSessions(days || 30));
  ipcMain.handle('sessions:create', (_, mode) => db.createSession(mode));
  ipcMain.handle('sessions:update', (_, id, updates) => db.updateSession(id, updates));

  // --- DB: Entries ---
  ipcMain.handle('entries:getRecent', (_, days) => db.getRecentEntries(days || 7));
  ipcMain.handle('entries:getPersistent', () => db.getPersistentEntries());
  ipcMain.handle('entries:search', (_, keywords, limit) => db.searchEntries(keywords, limit || 10));
  ipcMain.handle('entries:getByGoal', (_, goalId, days) => db.getEntriesByGoal(goalId, days));

  // --- DB: Overrides ---
  ipcMain.handle('overrides:getUnresolved', () => db.getUnresolvedOverrides());
  ipcMain.handle('overrides:getAll', () => db.getAllOverrides());
  ipcMain.handle('overrides:update', (_, id, updates) => db.updateOverride(id, updates));

  // --- DB: Files ---
  ipcMain.handle('files:list', () => {
    const { listFiles } = require('../src/files');
    return listFiles();
  });
  ipcMain.handle('files:get', (_, id) => {
    const { getFile } = require('../src/files');
    return getFile(id);
  });
  ipcMain.handle('files:ingest', async (_, filePath, goalId) => {
    const { ingestFile } = require('../src/files');
    return ingestFile(filePath, goalId);
  });
  ipcMain.handle('files:delete', async (_, id) => {
    const client = db.getClient();
    const { error } = await client.from('files').delete().eq('id', id);
    if (error) throw error;
  });
  ipcMain.handle('files:pickAndIngest', async (_, goalId) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Documents', extensions: ['txt', 'md', 'pdf', 'csv', 'json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const { ingestFile } = require('../src/files');
    return ingestFile(result.filePaths[0], goalId);
  });

  // --- AI: Brief ---
  ipcMain.handle('brief:generate', async (_, options) => {
    const { getActiveGoals } = db;
    const { buildSystemPrompt, callClaude } = require('../src/orchestrator');
    const { getOpenActions, getOverdueActions } = db;

    const goals = await getActiveGoals();
    const allGoals = await db.getAllGoals();
    console.log('[Brief] Active goals:', goals.length, '| All goals:', allGoals.length);
    console.log('[Brief] Goal statuses:', allGoals.map(g => `${g.id}: ${g.status}`).join(', '));
    if (goals.length === 0) return null;

    const systemPrompt = await buildSystemPrompt(goals, options || {});
    console.log('[Brief] System prompt length:', systemPrompt.length);
    const openActions = await getOpenActions();
    const overdueActions = await getOverdueActions();
    console.log('[Brief] Actions:', openActions.length, 'open,', overdueActions.length, 'overdue');

    const today = new Date().toLocaleDateString('en-GB', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const sections = [
      '**Top 3 Priorities Today** — derived from active goals AND open action items.',
      '**Open Commitments** — status of action items, especially overdue ones.',
      '**Risks or Concerns** — patterns from recent sessions, overdue items, goal drift.',
    ];
    if (options && options.calendarData) sections.push('**Schedule Awareness** — today\'s events and conflicts.');
    if (options && options.emailData) sections.push('**Email Highlights** — goal-relevant emails requiring action.');
    sections.push('**Recommended Focus** — clear directive on where to spend time and energy today.');

    const numberedSections = sections.map((s, i) => `${i + 1}. ${s}`).join('\n');

    const briefPrompt = `Generate today's morning brief. Today is ${today}.

You have access to:
- ${goals.length} active goal(s)
- ${openActions.length} open action items (${overdueActions.length} overdue)
- Session history and persistent insights

Produce a strategic brief:

${numberedSections}

Keep it scannable. Under 3 minutes to read. Reference specific past events and commitments.`;

    console.log('[Brief] Calling Claude CLI...');
    try {
      const result = await callClaude(briefPrompt, systemPrompt);
      console.log('[Brief] Response length:', result ? result.length : 0);
      return result;
    } catch (err) {
      console.error('[Brief] Claude CLI error:', err.message);
      throw err;
    }
  });

  // --- AI: Chat ---
  let chatSession = null;
  let chatHistory = [];
  let chatSystemPrompt = '';

  ipcMain.handle('chat:start', async (_, options) => {
    const goals = await db.getActiveGoals();
    if (goals.length === 0) return { error: 'No active goals' };

    const { buildSystemPrompt } = require('../src/orchestrator');
    chatSystemPrompt = await buildSystemPrompt(goals, options || {});
    chatHistory = [];
    chatSession = await db.createSession('advisory');

    // Check for overdue/stalled actions for opening
    const overdueActions = await db.getOverdueActions();
    const openActions = await db.getOpenActions();
    const highFollowUp = openActions.filter((a) => a.follow_up_count >= 2);

    let opening = null;
    if (overdueActions.length > 0 || highFollowUp.length > 0) {
      const { callClaude } = require('../src/orchestrator');
      const items = [];
      for (const a of overdueActions) {
        items.push(`OVERDUE: "${a.description}" was due ${a.due_date}. Follow-up count: ${a.follow_up_count}.`);
      }
      for (const a of highFollowUp) {
        if (!overdueActions.find((o) => o.id === a.id)) {
          items.push(`STALLED: "${a.description}" has been followed up ${a.follow_up_count} times.`);
        }
      }
      try {
        opening = await callClaude(
          `You are starting a new advisory session. These items need attention:\n\n${items.join('\n')}\n\nGenerate a brief, direct opening check-in. 2-4 sentences max.`,
          chatSystemPrompt
        );
        chatHistory.push({ role: 'Atlas', content: opening });
        for (const a of [...overdueActions, ...highFollowUp]) {
          await db.updateAction(a.id, { follow_up_count: a.follow_up_count + 1 });
        }
      } catch {}
    }

    return { sessionId: chatSession.id, opening };
  });

  // Session windowing — keep history manageable
  const MAX_HISTORY_MESSAGES = 40;
  const WINDOWED_KEEP_RECENT = 20;

  function windowHistory() {
    if (chatHistory.length > MAX_HISTORY_MESSAGES) {
      // Keep first 2 messages (opening context) + last WINDOWED_KEEP_RECENT
      const opening = chatHistory.slice(0, 2);
      const recent = chatHistory.slice(-WINDOWED_KEEP_RECENT);
      chatHistory = [...opening, { role: 'System', content: `[${chatHistory.length - 2 - WINDOWED_KEEP_RECENT} earlier messages trimmed for context management]` }, ...recent];
    }
  }

  ipcMain.handle('chat:send', async (_, message) => {
    if (!chatSession) return { error: 'No active session' };

    const { callClaudeConversation } = require('../src/orchestrator');
    const { webSearch } = require('../src/search');
    const { searchGmail } = require('../src/integrations/gmail');

    chatHistory.push({ role: 'User', content: message });
    windowHistory();

    let response = await callClaudeConversation(message, chatSystemPrompt, chatHistory.slice(0, -1));

    // Process markers
    const markers = [];
    const searchPattern = /\[SEARCH:\s*(.+?)\]/g;
    const recallPattern = /\[RECALL:\s*(.+?)\]/g;
    const emailPattern = /\[EMAIL_SEARCH:\s*(.+?)\]/g;

    const searchMatches = [...response.matchAll(searchPattern)];
    const recallMatches = [...response.matchAll(recallPattern)];
    const emailMatches = [...response.matchAll(emailPattern)];

    if (searchMatches.length > 0 || recallMatches.length > 0 || emailMatches.length > 0) {
      const contextParts = [];

      for (const m of searchMatches) {
        markers.push({ type: 'search', query: m[1].trim() });
        const result = await webSearch(m[1].trim(), chatSystemPrompt);
        contextParts.push(`Web search results for "${m[1].trim()}":\n${result}`);
      }
      for (const m of emailMatches) {
        markers.push({ type: 'email_search', query: m[1].trim() });
        const results = await searchGmail(m[1].trim());
        if (results.length > 0) {
          const formatted = results.map((r) => `From: ${r.from}\nSubject: ${r.subject}\nDate: ${r.date}\nPreview: ${r.snippet}`).join('\n\n');
          contextParts.push(`Email search results for "${m[1].trim()}":\n${formatted}`);
        }
      }
      for (const m of recallMatches) {
        markers.push({ type: 'recall', query: m[1].trim() });
        const keywords = m[1].trim().split(/\s+/).filter((w) => w.length > 2);
        const entries = await db.searchEntries(keywords, 5);
        if (entries.length > 0) {
          const context = entries.map((e) => `[${e.date}] [${e.entry_type}] ${e.content}`).join('\n');
          contextParts.push(`Memory results for "${m[1].trim()}":\n${context}`);
        }
      }

      if (contextParts.length > 0) {
        const refinedPrompt = `Here is the information you requested:\n\n${contextParts.join('\n\n---\n\n')}\n\nNow incorporate all of this into your advice. Cite what you found. Be specific.`;
        response = await callClaudeConversation(refinedPrompt, chatSystemPrompt, chatHistory);
      }
    }

    chatHistory.push({ role: 'Atlas', content: response });
    return { response, markers };
  });

  ipcMain.handle('chat:end', async () => {
    if (!chatSession) return null;

    const duration = chatSession ? Math.round((Date.now() - new Date(chatSession.created_at).getTime()) / 60000) : 0;

    let result = { entries: 0, actions: 0 };
    try {
      if (chatHistory.length >= 4) {
        const { processSession } = require('../src/processor');
        result = await processSession(chatSession.id, chatHistory, duration);
      } else {
        await db.updateSession(chatSession.id, { duration_minutes: duration });
      }
    } catch (err) {
      await db.updateSession(chatSession.id, { duration_minutes: duration });
    }

    const sessionId = chatSession.id;
    chatSession = null;
    chatHistory = [];
    chatSystemPrompt = '';

    return { sessionId, ...result };
  });

  // --- Search ---
  ipcMain.handle('search:web', async (_, query) => {
    const { webSearch } = require('../src/search');
    const { buildSystemPrompt } = require('../src/orchestrator');
    const goals = await db.getActiveGoals();
    const systemPrompt = goals.length > 0 ? await buildSystemPrompt(goals) : '';
    return webSearch(query, systemPrompt);
  });

  ipcMain.handle('search:entries', async (_, keywords, limit) => {
    return db.searchEntries(keywords, limit || 10);
  });

  // --- Email ---
  ipcMain.handle('email:fetch', async () => {
    const { fetchEmailContext, isConfigured } = require('../src/integrations/gmail');
    if (!isConfigured()) return null;
    const goals = await db.getActiveGoals();
    const openActions = await db.getOpenActions();
    const recentEntries = await db.getRecentEntries(7);
    return fetchEmailContext(goals, openActions, recentEntries);
  });

  ipcMain.handle('email:search', async (_, query) => {
    const { searchGmail } = require('../src/integrations/gmail');
    return searchGmail(query);
  });

  ipcMain.handle('email:getCached', () => {
    const { getCachedEmailContext } = require('../src/integrations/gmail');
    return getCachedEmailContext();
  });

  // --- Calendar ---
  ipcMain.handle('calendar:fetch', async () => {
    const { fetchCalendarEvents, isConfigured } = require('../src/integrations/calendar');
    if (!isConfigured()) return null;
    return fetchCalendarEvents();
  });

  // --- User Context ---
  ipcMain.handle('context:load', () => {
    const { loadUserContext } = require('../src/orchestrator');
    return loadUserContext();
  });

  ipcMain.handle('context:save', (_, file, content) => {
    const fs = require('fs');
    const configDir = path.join(__dirname, '..', 'config', 'user');
    const validFiles = ['IDENTITY.md', 'SITUATION.md', 'PREFERENCES.md'];
    if (!validFiles.includes(file)) throw new Error('Invalid context file');
    fs.writeFileSync(path.join(configDir, file), content, 'utf-8');
  });

  ipcMain.handle('context:checkPlaceholders', () => {
    const { checkUserContextFiles } = require('../src/orchestrator');
    return checkUserContextFiles();
  });

  // --- DB: Entries by Session ---
  ipcMain.handle('entries:getBySession', (_, sessionId) => db.getEntriesBySession(sessionId));

  // --- Settings ---
  ipcMain.handle('settings:getDiagnostics', () => {
    const { getLastDiagnostics } = require('../src/orchestrator');
    return getLastDiagnostics();
  });

  ipcMain.handle('goals:updateSources', async (_, id, sources) => {
    const goal = await db.getGoal(id);
    if (!goal) throw new Error('Goal not found');
    const goalData = goal.goal_data || {};
    goalData.context_sources = sources;
    await db.saveGoal({ ...goal, goal_data: goalData });
  });

  ipcMain.handle('goals:generateId', () => {
    const { generateGoalId } = require('../src/orchestrator');
    return generateGoalId();
  });

  // --- PDF Export ---
  ipcMain.handle('export:pdf', async (_, htmlContent, title) => {
    const fs = require('fs');
    const { BrowserWindow: BW } = require('electron');

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `Atlas_${title || 'Brief'}_${new Date().toISOString().split('T')[0]}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled) return null;

    const printWindow = new BW({ show: false, webPreferences: { nodeIntegration: false } });
    const styledHtml = `<!DOCTYPE html><html><head><style>
      body { font-family: 'Segoe UI', sans-serif; color: #1a1a1a; padding: 40px; max-width: 700px; margin: 0 auto; line-height: 1.6; }
      h1 { font-size: 22px; margin-bottom: 4px; } h2 { font-size: 18px; margin-top: 20px; } h3 { font-size: 15px; }
      ul, ol { padding-left: 20px; } li { margin-bottom: 4px; }
      strong { font-weight: 600; } code { background: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-size: 13px; }
      .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
    </style></head><body>
      <h1>Atlas — ${title || 'Brief'}</h1>
      <div class="meta">${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
      ${htmlContent}
    </body></html>`;

    await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(styledHtml));
    const pdfData = await printWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
    fs.writeFileSync(result.filePath, pdfData);
    printWindow.close();

    shell.showItemInFolder(result.filePath);
    return result.filePath;
  });

  // --- AI: End-of-Day Reflection ---
  ipcMain.handle('brief:reflection', async (_, options) => {
    const { buildSystemPrompt, callClaude } = require('../src/orchestrator');
    const goals = await db.getActiveGoals();
    if (goals.length === 0) return null;

    const systemPrompt = await buildSystemPrompt(goals, options || {});
    const todaySessions = await db.getRecentSessions(1);
    const openActions = await db.getOpenActions();
    const overdueActions = await db.getOverdueActions();

    const sessionSummaries = todaySessions
      .filter((s) => s.summary)
      .map((s) => `- ${s.summary}`)
      .join('\n') || 'No sessions today.';

    const reflectionPrompt = `Generate an end-of-day reflection. Today's date: ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

Today's sessions:
${sessionSummaries}

Open actions: ${openActions.length} (${overdueActions.length} overdue)

Generate a brief, honest reflection covering:
1. **What moved forward today** — concrete progress on goals
2. **What didn't happen** — planned items that were skipped or avoided
3. **Pattern check** — any drift, avoidance, or procrastination patterns
4. **Tomorrow's priority** — the single most important thing to do first

Be direct. Under 2 minutes to read. No fluff.`;

    return callClaude(reflectionPrompt, systemPrompt);
  });

  // --- Engine Info ---
  ipcMain.handle('settings:getEngines', () => {
    const { getAvailableEngines } = require('../src/orchestrator');
    return getAvailableEngines();
  });

  ipcMain.handle('settings:setEngine', (_, name) => {
    const { setEngine } = require('../src/orchestrator');
    setEngine(name);
  });

  ipcMain.handle('settings:getAgentSpecs', () => {
    const { loadAgentSpecs } = require('../src/orchestrator');
    return loadAgentSpecs();
  });

  ipcMain.handle('settings:getMethodology', () => {
    const fs = require('fs');
    const methodPath = path.join(__dirname, '..', 'config', 'engine', 'methodology.md');
    try { return fs.readFileSync(methodPath, 'utf-8'); } catch { return ''; }
  });

  ipcMain.handle('settings:isGoogleConfigured', () => {
    const { isGoogleConfigured } = require('../src/setup');
    return isGoogleConfigured();
  });

  // --- Conversational Goal Interview ---
  let interviewHistory = [];
  let interviewMode = null; // 'create' | 'edit'
  let interviewGoalId = null;

  ipcMain.handle('interview:start', async (_, options) => {
    const { callClaude, loadUserContext, generateGoalId } = require('../src/orchestrator');
    interviewHistory = [];
    interviewMode = options && options.goalId ? 'edit' : 'create';
    interviewGoalId = options && options.goalId ? options.goalId : null;

    const userCtx = loadUserContext();
    const userName = (userCtx.identity.match(/\*\*Name:\*\*\s*(.+)/i) || [])[1] || '';
    const cleanName = userName.replace(/\[.*?\]/g, '').trim();

    let systemPrompt = `You are Atlas, a strategic adviser conducting a goal-definition conversation. You are warm, direct, and personable — like a sharp senior colleague who genuinely wants to help.

Rules:
- Ask one or two questions at a time, never a list
- Acknowledge what the user shared before asking more
- Infer fields from natural language — if they say "I need a job in 2 months" you already have timeframe and urgency
- Never use field names like "success criteria" or "baseline" — use natural language
- Don't number your questions
- Push back warmly on vague goals: "I can work with that direction, but I need to sharpen it before it's useful."
- When you have enough information, present a summary in natural prose (NOT a field list or JSON)
- Required information: outcome (what success looks like), metric (how to measure), timeframe, current baseline, why now, constraints, anti-goals (what they won't sacrifice)
- ${cleanName ? `The user's name is ${cleanName}. Use it naturally, not every message.` : 'You don\'t know the user\'s name yet.'}
- When the goal is sharp, present it like: "Here's what I'm working with: you want to [outcome] by [date], starting from [baseline]. The main constraints are [constraints], and you definitely don't want [anti-goals]. Sound right?"
- After the user confirms, respond with EXACTLY the text "GOAL_READY" on its own line at the start, followed by your confirmation message.`;

    let opening;
    if (interviewMode === 'edit' && interviewGoalId) {
      const goal = await db.getGoal(interviewGoalId);
      if (!goal) return { error: 'Goal not found' };
      const data = goal.goal_data || {};
      const summary = Object.entries(data)
        .filter(([k, v]) => v && k !== 'atlas_directness')
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
        .join(', ');

      opening = await callClaude(
        `The user wants to update their goal "${goal.title}". Here's what we currently have: ${summary}. Generate a warm, brief opening (2-3 sentences) asking what they'd like to change. Don't list every field.`,
        systemPrompt
      );
    } else {
      opening = await callClaude(
        `Start a new goal-definition conversation. Generate a warm, personable opening (2-3 sentences). Invite the user to describe what they're trying to achieve. Don't be generic or bureaucratic.`,
        systemPrompt
      );
      interviewGoalId = await generateGoalId();
    }

    interviewHistory.push({ role: 'Atlas', content: opening });
    return { opening, goalId: interviewGoalId };
  });

  ipcMain.handle('interview:send', async (_, message) => {
    const { callClaudeConversation } = require('../src/orchestrator');

    const systemPrompt = `You are Atlas conducting a goal-definition conversation. Be warm, direct, personable. Ask one or two questions at a time. Acknowledge what was shared. Infer what you can. Push back on vagueness warmly. Never use field names. Don't number questions.

Required information to gather: outcome, metric, timeframe, baseline, why now, constraints, anti-goals.

When the goal is sharp enough, present a natural-language summary and ask for confirmation. After the user confirms, your response MUST start with "GOAL_READY" on its own line, followed by your confirmation message.`;

    interviewHistory.push({ role: 'User', content: message });
    const response = await callClaudeConversation(message, systemPrompt, interviewHistory.slice(0, -1));
    interviewHistory.push({ role: 'Atlas', content: response });

    const isReady = response.trim().startsWith('GOAL_READY');
    return { response: response.replace(/^GOAL_READY\n?/, ''), isReady };
  });

  ipcMain.handle('interview:complete', async () => {
    const { callClaude, generateGoalId, DEFAULT_CONTEXT_SOURCES } = require('../src/orchestrator');

    const transcript = interviewHistory.map((m) => `${m.role}: ${m.content}`).join('\n\n');

    const structurePrompt = `Here is a goal-definition conversation transcript:

${transcript}

Extract a structured goal from this conversation. Return ONLY a valid JSON object with these fields:
- title (concise goal title)
- type (one of: career, financial, learning, health, business, personal)
- priority (one of: primary, secondary, supporting)
- outcome (what success looks like)
- metric (how to measure progress)
- target_date (YYYY-MM-DD if mentioned, null otherwise)
- baseline (where they are now)
- why_now (urgency/motivation)
- constraints (limitations)
- anti_goals (what they won't sacrifice)
- next_milestone (first concrete checkpoint, 7-14 days)
- atlas_directness (1-5, infer from conversation tone, default 3)

Return ONLY valid JSON. No explanation.`;

    const result = await callClaude(structurePrompt, 'You extract structured data from conversations. Output only valid JSON.');
    const match = result.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Failed to structure goal from conversation');

    const goalData = JSON.parse(match[0]);
    // Add default context sources if not present
    if (!goalData.context_sources) {
      goalData.context_sources = { ...DEFAULT_CONTEXT_SOURCES };
    }
    const id = interviewGoalId || await generateGoalId();

    await db.saveGoal({
      id,
      title: goalData.title,
      type: goalData.type,
      priority: goalData.priority,
      goal_data: goalData,
      status: 'active',
    });
    await db.updateGoalStatus(id, 'active');
    console.log('[Interview] Goal saved:', id, goalData.title);

    interviewHistory = [];
    interviewMode = null;
    interviewGoalId = null;

    return { id, title: goalData.title, goalData };
  });

  // Keep legacy handler for backward compat
  ipcMain.handle('interview:structure', async (_, answers) => {
    const { callClaude } = require('../src/orchestrator');
    const prompt = `Structure these goal interview answers into a JSON goal record:

${JSON.stringify(answers, null, 2)}

Return a JSON object with fields: id (generate a short slug), title, type (career/financial/learning/health/business/personal), priority (primary/secondary/supporting), outcome, metric, timeline, target_date (YYYY-MM-DD if mentioned), baseline, why_now, constraints, anti_goals, next_milestone, atlas_directness (1-5).

Return ONLY valid JSON.`;

    const result = await callClaude(prompt, 'You structure goal data. Output only valid JSON.');
    const match = result.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Failed to structure goal');
    return JSON.parse(match[0]);
  });

  // --- Conversational Context Update ---
  ipcMain.handle('context:interview', async (_, file, message, history) => {
    const { callClaudeConversation, loadUserContext } = require('../src/orchestrator');
    const userCtx = loadUserContext();

    const fileLabels = {
      'IDENTITY.md': { label: 'Identity', current: userCtx.identity },
      'SITUATION.md': { label: 'Situation', current: userCtx.situation },
      'PREFERENCES.md': { label: 'Preferences', current: userCtx.preferences },
    };

    const info = fileLabels[file];
    if (!info) throw new Error('Invalid context file');

    const systemPrompt = `You are Atlas helping update the user's ${info.label} file. Be warm and conversational.

Current file content:
${info.current}

Your job: gather information from the user through conversation, then when you have enough, propose updated file content. When proposing the update, start your response with "CONTEXT_READY" on its own line, then include the proposed markdown content between \`\`\`markdown and \`\`\` fences.`;

    const response = await callClaudeConversation(message, systemPrompt, history || []);
    const isReady = response.includes('CONTEXT_READY');

    let proposedContent = null;
    if (isReady) {
      const mdMatch = response.match(/```markdown\n([\s\S]*?)```/);
      if (mdMatch) proposedContent = mdMatch[1].trim();
    }

    return {
      response: response.replace(/^CONTEXT_READY\n?/, ''),
      isReady,
      proposedContent,
    };
  });
}
