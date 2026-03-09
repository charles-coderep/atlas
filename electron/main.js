const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Load .env â€” check app root first, then resources directory for packaged app
const envPaths = [
  path.join(__dirname, '..', '.env'),
  path.join(process.resourcesPath || '', '.env'),
];
for (const p of envPaths) {
  const result = require('dotenv').config({ path: p });
  if (!result.error) break;
}

const db = require('../src/db');
const {
  buildSystemPrompt, callEngine, callEngineStreaming, callEngineConversation,
  loadUserContext, checkUserContextFiles, getGoalSourcePolicy,
  generateGoalId, getAvailableEngines, getActiveEngineName, setEngine, getEngine,
  getAvailableTones, setSelectedTone, getSelectedTone, loadToneOverlay, mapDirectnessToTone,
  loadAgentSpecs, listAgentFiles, generatePerspective, perspectiveExists,
  getLastDiagnostics, DEFAULT_CONTEXT_SOURCES, AGENT_DEFAULTS_BY_TYPE,
  migrateGoalSources, syncPreferencesTone, syncToneFromPreferences,
} = require('../src/orchestrator');
const { processSession, runUserModelGeneration, runPatternDetection } = require('../src/processor');
const { webSearch } = require('../src/search');
const { ingestFile, listFiles, getFile: getFileRecord } = require('../src/files');
const { isGoogleConfigured } = require('../src/setup');
const { readRuntimeJson, writeRuntimeJson } = require('../src/runtime');

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
  process.env.ATLAS_RUNTIME_DIR = path.join(app.getPath('userData'), 'runtime');

  // Show window immediately so user sees something right away
  createWindow();
  registerIPC();

  // Run startup checks in background
  try {
    await db.initDB();
    try {
      const deletedEntries = await db.cleanupOldEntries(30);
      const deletedSessions = await db.cleanupEmptySessions(30);
      if (deletedEntries > 0 || deletedSessions > 0) {
        console.log(`[Cleanup] Removed ${deletedEntries} expired entries, ${deletedSessions} empty sessions`);
      }
    } catch (cleanupErr) {
      console.error('Cleanup failed:', cleanupErr.message);
    }
  } catch (err) {
    console.error('Database init failed:', err.message);
  }

  // Migrate goals: ensure all have explicit agents arrays
  try {
    const allGoals = await db.getAllGoals();
    for (const g of allGoals) {
      const sources = g.goal_data?.context_sources;
      if (!sources || !Array.isArray(sources.agents)) {
        const migrated = migrateGoalSources(g.goal_data || {}, g.type);
        await db.saveGoal({ ...g, goal_data: migrated });
        console.log(`[Migration] Goal "${g.title}" â†’ agents: [${migrated.context_sources.agents.join(', ')}]`);
      }
    }
  } catch (err) {
    console.error('Goal migration error:', err.message);
  }

  // Sync tone from preferences file (in case user edited it directly)
  try {
    syncToneFromPreferences();
  } catch (err) {
    console.error('Tone sync error:', err.message);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC Registration ---

function registerIPC() {
  const logTiming = (label, startedAt) => {
    console.log(`[Timing] ${label} in ${Date.now() - startedAt}ms`);
  };

  // --- Shared prompt builders ---

  function buildGoalInterviewPrompt(cleanName) {
    return `You are Atlas, a strategic adviser helping define a goal. Warm, direct, personable.

Rules:
- Ask one or two questions at a time.
- Acknowledge briefly, then ask the next question immediately.
- Infer what you can from natural language.
- Never use field names like "success criteria" — use natural language.
- Do not number your questions.
- Push back warmly on vague goals.
- Keep every response under 4 sentences.
- Do not summarise or restate what the user told you.
${cleanName ? `- The user's name is ${cleanName}. Use it naturally, not every message.` : ''}

Gather: outcome, metric, timeframe, baseline, why now, constraints, anti-goals.

When you have enough, present a natural-language summary and ask for confirmation. Do not name or list internal perspectives to the user — just confirm you have what you need.

After confirmation, respond with GOAL_READY on its own line, then your confirmation. Include a PERSPECTIVES: line with comma-separated lowercase-hyphenated slugs (invisible to user, used by the system).

Available defaults by type: ${JSON.stringify(AGENT_DEFAULTS_BY_TYPE)}. Meta-analyst always included.`;
  }

  function buildContextInterviewPrompt(file, info, guidance) {
    return `You are Atlas helping update the user's ${info.label} file.

${guidance[file] || ''}

Keep every response under 3 sentences. Ask one thing at a time. Acknowledge briefly, then ask the next question or propose the update.

Current file content:
${info.current}

Gather information through conversation. When you have enough, start your response with CONTEXT_READY on its own line, then include the proposed markdown between \`\`\`markdown and \`\`\` fences.`;
  }

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
  ipcMain.handle('goals:getArchived', () => db.getArchivedGoals());
  ipcMain.handle('goals:get', (_, id) => db.getGoal(id));
  ipcMain.handle('goals:save', (_, goal) => db.saveGoal(goal));
  ipcMain.handle('goals:updateStatus', (_, id, status) => db.updateGoalStatus(id, status));
  ipcMain.handle('goals:archive', (_, id) => db.archiveGoal(id));
  ipcMain.handle('goals:unarchive', (_, id) => db.unarchiveGoal(id));
  ipcMain.handle('goals:countLinked', (_, goalId) => db.countGoalLinkedItems(goalId));
  ipcMain.handle('goals:deleteCascade', (_, goalId, level) => db.deleteGoalCascade(goalId, level));

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
  ipcMain.handle('sessions:delete', (_, id) => db.deleteSession(id));
  ipcMain.handle('sessions:deleteAll', () => db.deleteAllSessions());

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
  ipcMain.handle('files:list', () => listFiles());
  ipcMain.handle('files:get', (_, id) => getFileRecord(id));
  ipcMain.handle('files:ingest', (_, filePath, goalId) => ingestFile(filePath, goalId));
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
    return ingestFile(result.filePaths[0], goalId);
  });

  ipcMain.handle('settings:resetAll', async () => {
    await db.resetAllData();
    return { ok: true };
  });

  // --- AI: Brief ---
  ipcMain.handle('brief:generate', async (_, options) => {
    const briefStartedAt = Date.now();

    const goals = await db.getActiveGoals();
    const allGoals = await db.getAllGoals();
    console.log('[Brief] Active goals:', goals.length, '| All goals:', allGoals.length);
    console.log('[Brief] Goal statuses:', allGoals.map(g => `${g.id}: ${g.status}`).join(', '));
    if (goals.length === 0) return null;

    const sourcePolicy = getGoalSourcePolicy(goals);
    const filteredOptions = { ...(options || {}) };
    if (!sourcePolicy.calendar) delete filteredOptions.calendarData;
    if (!sourcePolicy.gmail) delete filteredOptions.emailData;

    const promptStartedAt = Date.now();
    const systemPrompt = await buildSystemPrompt(goals, filteredOptions);
    logTiming('System prompt built', promptStartedAt);
    console.log('[Brief] System prompt length:', systemPrompt.length);
    const openActions = await db.getOpenActions();
    const overdueActions = await db.getOverdueActions();
    console.log('[Brief] Actions:', openActions.length, 'open,', overdueActions.length, 'overdue');

    const today = new Date().toLocaleDateString('en-GB', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const sections = [
      '**Top 3 Priorities Today** - derived from active goals AND open action items.',
      '**Open Commitments** - status of action items, especially overdue ones.',
      '**Risks or Concerns** - patterns from recent sessions, overdue items, goal drift.',
    ];
    if (sourcePolicy.calendar && filteredOptions.calendarData) sections.push('**Schedule Awareness** - today\'s events and conflicts.');
    if (sourcePolicy.gmail && filteredOptions.emailData) sections.push('**Email Highlights** - goal-relevant emails requiring action.');
    // Goal health assessment for goals active 14+ days
    const matureGoals = goals.filter(g => {
      if (!g.created_at) return false;
      const daysActive = Math.floor((Date.now() - new Date(g.created_at).getTime()) / 86400000);
      return daysActive >= 14;
    });
    if (matureGoals.length > 0) {
      sections.push(`**Goal Health** - For each goal active 14+ days (${matureGoals.map(g => g.title).join(', ')}): momentum (moving/stalled/drifting), clarity (well-defined/needs sharpening), risk (low/medium/high). One sentence each on what would most improve trajectory.`);
    }

    sections.push('**Recommended Focus** - clear directive on where to spend time and energy today.');

    const numberedSections = sections.map((s, i) => `${i + 1}. ${s}`).join('\n');

    const briefPrompt = `Generate today's morning brief. Today is ${today}.

You have access to:
- ${goals.length} active goal(s)
- ${openActions.length} open action items (${overdueActions.length} overdue)
- Session history and persistent insights

Produce a strategic brief:

${numberedSections}

Keep it scannable. Under 3 minutes to read. Reference specific past events and commitments.`;

    console.log('[Brief] Calling active AI engine...');
    try {
      const result = await callEngine(briefPrompt, systemPrompt, { label: 'Brief generated' });
      console.log('[Brief] Response length:', result ? result.length : 0);
      logTiming('Brief generated', briefStartedAt);
      return result;
    } catch (err) {
      console.error('[Brief] Active AI engine error:', err.message);
      throw err;
    }
  });

  // --- AI: Chat ---
  let chatSession = null;
  let chatHistory = [];
  let chatSystemPrompt = '';
  let chatSending = false;

  ipcMain.handle('chat:start', async (_, options) => {
    const chatStartTime = Date.now();
    const goals = await db.getActiveGoals();
    if (goals.length === 0) return { error: 'No active goals. Create a goal first.' };

    const promptStartedAt = Date.now();
    chatSystemPrompt = await buildSystemPrompt(goals, options || {});
    logTiming('System prompt built', promptStartedAt);
    chatHistory = [];
    chatSession = await db.createSession('advisory');

    // Gather context for opening
    const overdueActions = await db.getOverdueActions();
    const openActions = await db.getOpenActions();
    const highFollowUp = openActions.filter((a) => a.follow_up_count >= 2);
    const recentSessions = await db.getRecentSessions(3);
    const contextWarnings = checkUserContextFiles();

    // Build opening context
    const openerParts = [];

    if (overdueActions.length > 0 || highFollowUp.length > 0) {
      for (const a of overdueActions) {
        openerParts.push(`OVERDUE ACTION: "${a.description}" was due ${a.due_date}. Follow-up count: ${a.follow_up_count}.`);
      }
      for (const a of highFollowUp) {
        if (!overdueActions.find((o) => o.id === a.id)) {
          openerParts.push(`STALLED ACTION: "${a.description}" has been followed up ${a.follow_up_count} times.`);
        }
      }
    }

    if (recentSessions.length > 0) {
      const lastSession = recentSessions.find(s => s.summary);
      if (lastSession) {
        openerParts.push(`LAST SESSION (${lastSession.date}): ${lastSession.summary}`);
      }
    }

    for (const g of goals) {
      const days = g.created_at ? Math.floor((Date.now() - new Date(g.created_at).getTime()) / 86400000) : null;
      openerParts.push(`ACTIVE GOAL: "${g.title}" (${g.type}, ${days !== null ? days + ' days active' : 'recently created'})`);
    }

    if (contextWarnings.length > 0) {
      openerParts.push(`THIN CONTEXT: These user files still have placeholder content: ${contextWarnings.map(w => w.split(' â€” ')[0]).join(', ')}. Consider offering to fill them in.`);
    }

    // Decision follow-ups
    try {
      const pendingDecisions = await db.getPendingDecisionFollowups();
      for (const d of pendingDecisions) {
        openerParts.push(`DECISION FOLLOW-UP: On ${new Date(d.created_at).toLocaleDateString('en-GB')}, you decided “${d.description}”. Expected: ${d.expected_outcome || 'not specified'}. It's time to check: how did this play out?`);
      }
    } catch {}

    // Decision mode
    if (options && options.mode === 'decision') {
      openerParts.push(`MODE: Decision rehearsal. The user wants to think through a major decision. Start by asking what decision they're facing, then work through: name it precisely, identify affected goals, generate options (including not acting), run a pre-mortem, check opportunity cost, check second-order effects, and present your recommendation with confidence level. Work through one step at a time.`);
    }

    const openerPrompt = `You are starting a new advisory session. Generate a specific, grounded opening. 2-4 sentences max. Reference what you actually know â€” overdue items, recent sessions, active goals, today's date. Feel like you've been thinking about the user between sessions. Never be generic. Never introduce yourself.

Context for your opening:
${openerParts.length > 0 ? openerParts.join('\n') : 'No specific items â€” but you have the user\'s goals and context in your system prompt. Reference something specific.'}

Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;

    let opening = null;
    try {
      const openingStartedAt = Date.now();
      opening = await callEngine(openerPrompt, chatSystemPrompt, { label: 'Session opening generated' });
      logTiming('Session opening generated', openingStartedAt);
      chatHistory.push({ role: 'Atlas', content: opening });

      // Increment follow-up counts for overdue/stalled
      for (const a of [...overdueActions, ...highFollowUp]) {
        await db.updateAction(a.id, { follow_up_count: a.follow_up_count + 1 });
      }
    } catch (err) {
      console.error('[Chat] Opening generation failed:', err.message);
    }

    logTiming('Session start completed', chatStartTime);
    return { sessionId: chatSession.id, opening };
  });

  // Session windowing â€” keep history manageable
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

  ipcMain.handle('chat:send', async (_, message, options = {}) => {
    if (!chatSession) return { error: 'No active session' };
    if (chatSending) return { error: 'Already processing a message' };
    chatSending = true;

    const streaming = options.streaming !== false; // default to streaming

    try {
      chatHistory.push({ role: 'User', content: message });
      windowHistory();

      let response;

      if (streaming) {
        const historyPrefix = chatHistory.slice(0, -1);
        const fullPrompt = historyPrefix.length > 0
          ? `Previous conversation:\n${historyPrefix.map((m) => `${m.role}: ${m.content}`).join('\n')}\n\nUser: ${message}`
          : message;

        let fullResponse = '';
        try {
          fullResponse = await callEngineStreaming(fullPrompt, chatSystemPrompt, {}, (chunk) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('chat:stream-chunk', chunk);
            }
          });
        } catch (err) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('chat:stream-error', err.message);
          }
          return { error: err.message };
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('chat:stream-end');
        }
        response = fullResponse;
      } else {
        response = await callEngineConversation(message, chatSystemPrompt, chatHistory.slice(0, -1));
      }

      // Process markers (shared for both paths)
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
          try {
            const { searchGmail } = require('../src/integrations/gmail');
            const results = await searchGmail(m[1].trim());
            if (results.length > 0) {
              const formatted = results.map((r) => `From: ${r.from}\nSubject: ${r.subject}\nDate: ${r.date}\nPreview: ${r.snippet}`).join('\n\n');
              contextParts.push(`Email search results for "${m[1].trim()}":\n${formatted}`);
            }
          } catch {}
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
          response = await callEngineConversation(refinedPrompt, chatSystemPrompt, chatHistory);
          if (streaming && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('chat:stream-replace', response);
          }
        }
      }

      chatHistory.push({ role: 'Atlas', content: response });
      return { response, markers };
    } finally {
      chatSending = false;
    }
  });

  ipcMain.handle('chat:end', async () => {
    if (!chatSession) return null;
    chatSending = false;

    const duration = chatSession ? Math.round((Date.now() - new Date(chatSession.created_at).getTime()) / 60000) : 0;

    let result = { entries: 0, actions: 0, decisions: 0 };
    try {
      if (chatHistory.length >= 4) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('chat:processing-status', 'Extracting session insights...');
        }
        const sendProgress = (msg) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('chat:processing-status', msg);
          }
        };
        sendProgress('Processing session — this takes 15-30 seconds...');
        result = await processSession(chatSession.id, chatHistory, duration, sendProgress);
        sendProgress('Session saved.');

        // Check if user model / pattern detection should run (every 5 sessions)
        try {
          const settings = readRuntimeJson('settings.json', {});
          const count = (settings.sessionsSinceLastUserModel || 0) + 1;
          if (count >= 5) {
            writeRuntimeJson('settings.json', { ...settings, sessionsSinceLastUserModel: 0 });
            // Run in background — don't block session end
            runUserModelGeneration().then(m => { if (m) console.log('[UserModel] Regenerated'); });
            runPatternDetection().then(r => console.log(`[Patterns] Detected ${r.detected}, saved ${r.saved}`));
          } else {
            writeRuntimeJson('settings.json', { ...settings, sessionsSinceLastUserModel: count });
          }
        } catch (bgErr) {
          console.error('[Background tasks]', bgErr.message);
        }
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

  // --- Voice: Transcription --- (lazy: optional integration)
  ipcMain.handle('voice:isAvailable', () => {
    const { isLocalWhisperAvailable } = require('../src/voice');
    return isLocalWhisperAvailable();
  });

  ipcMain.handle('voice:transcribe', async (_, audioBuffer) => {
    const { saveTempWav, transcribeFile, cleanupTempFile } = require('../src/voice');
    const tmpPath = saveTempWav(audioBuffer);
    try {
      const text = await transcribeFile(tmpPath);
      return { text };
    } catch (err) {
      return { error: err.message };
    } finally {
      cleanupTempFile(tmpPath);
    }
  });

  // --- Search ---
  ipcMain.handle('search:web', async (_, query) => {
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
  ipcMain.handle('context:load', () => loadUserContext());

  ipcMain.handle('context:save', async (_, file, content) => {
    const configDir = path.join(__dirname, '..', 'config', 'user');
    const validFiles = ['IDENTITY.md', 'SITUATION.md', 'PREFERENCES.md'];
    if (!validFiles.includes(file)) throw new Error('Invalid context file');
    fs.writeFileSync(path.join(configDir, file), content, 'utf-8');

    // If a session is active, rebuild the system prompt so Atlas sees the update immediately
    if (chatSession) {
      try {
        const goals = await db.getActiveGoals();
        chatSystemPrompt = await buildSystemPrompt(goals);
        console.log('[Context] System prompt rebuilt mid-session after file update');
      } catch (err) {
        console.error('[Context] Failed to rebuild prompt mid-session:', err.message);
      }
    }

    // If PREFERENCES.md was saved, sync tone back to runtime settings
    if (file === 'PREFERENCES.md') {
      try {
        syncToneFromPreferences();
      } catch {}
    }
  });

  ipcMain.handle('context:checkPlaceholders', () => checkUserContextFiles());

  // --- DB: Entries by Session ---
  ipcMain.handle('entries:getBySession', (_, sessionId) => db.getEntriesBySession(sessionId));

  // --- Settings ---
  ipcMain.handle('settings:getDiagnostics', () => getLastDiagnostics());

  ipcMain.handle('goals:updateSources', async (_, id, sources) => {
    const goal = await db.getGoal(id);
    if (!goal) throw new Error('Goal not found');
    const goalData = goal.goal_data || {};
    goalData.context_sources = sources;
    await db.saveGoal({ ...goal, goal_data: goalData });
  });

  ipcMain.handle('goals:generateId', () => generateGoalId());

  // --- PDF Export ---
  ipcMain.handle('export:pdf', async (_, htmlContent, title) => {

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `Atlas_${title || 'Brief'}_${new Date().toISOString().split('T')[0]}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled) return null;

    const printWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false } });
    const styledHtml = `<!DOCTYPE html><html><head><style>
      body { font-family: 'Segoe UI', sans-serif; color: #1a1a1a; padding: 40px; max-width: 700px; margin: 0 auto; line-height: 1.6; }
      h1 { font-size: 22px; margin-bottom: 4px; } h2 { font-size: 18px; margin-top: 20px; } h3 { font-size: 15px; }
      ul, ol { padding-left: 20px; } li { margin-bottom: 4px; }
      strong { font-weight: 600; } code { background: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-size: 13px; }
      .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
    </style></head><body>
      <h1>Atlas â€” ${title || 'Brief'}</h1>
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

    const completedActions = await db.getCompletedActions();
    const completedToday = completedActions.filter(a => {
      if (!a.completed_at) return false;
      return new Date(a.completed_at).toISOString().split('T')[0] === new Date().toISOString().split('T')[0];
    });

    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const reflectionPrompt = `Generate an end-of-day reflection. Today is ${today}.

Today's sessions:
${sessionSummaries}

Open actions: ${openActions.length} (${overdueActions.length} overdue)
Completed today: ${completedToday.length}

Structure your reflection as:
1. **What moved forward** — concrete progress, be specific
2. **What didn't happen** — planned items that were skipped, with honest assessment of why
3. **Pattern check** — any drift, avoidance, or energy patterns you notice
4. **Carry forward** — the single most important thing to do first tomorrow, and why

Under 2 minutes to read. No fluff. Reference specific actions and sessions.`;

    return callEngine(reflectionPrompt, systemPrompt);
  });

  // --- Engine Info ---
  ipcMain.handle('settings:getEngines', () => getAvailableEngines());

  ipcMain.handle('settings:setEngine', (_, name) => {
    setEngine(name);
    return { ok: true, activeEngine: name };
  });

  ipcMain.handle('settings:getTones', () => getAvailableTones());

  ipcMain.handle('settings:setTone', (_, name) => {
    const tone = setSelectedTone(name);
    return { ok: true, tone };
  });

  ipcMain.handle('settings:getAgentSpecs', () => loadAgentSpecs());

  ipcMain.handle('settings:listAgentFiles', () => listAgentFiles().map(f => f.replace(/\.md$/, '')));

  ipcMain.handle('settings:saveAgentSpec', (_, name, content) => {
    const agentPath = path.join(__dirname, '..', 'config', 'agents', `${name}.md`);
    fs.writeFileSync(agentPath, content, 'utf-8');
  });

  ipcMain.handle('settings:deleteAgentSpec', (_, name) => {
    const agentPath = path.join(__dirname, '..', 'config', 'agents', `${name}.md`);
    if (fs.existsSync(agentPath)) fs.unlinkSync(agentPath);
  });

  ipcMain.handle('settings:getAgentDefaults', () => AGENT_DEFAULTS_BY_TYPE);

  ipcMain.handle('settings:generatePerspective', (_, name, domain) => generatePerspective(name, domain));

  ipcMain.handle('settings:perspectiveExists', (_, name) => perspectiveExists(name));

  ipcMain.handle('settings:getMethodology', () => {
    const methodPath = path.join(__dirname, '..', 'config', 'engine', 'methodology.md');
    try {
      const content = fs.readFileSync(methodPath, 'utf-8');
      const stats = fs.statSync(methodPath);
      return {
        content,
        filePath: methodPath,
        tokens: Math.ceil(content.length / 4),
        lastModified: stats.mtime.toISOString(),
        loaded: content.trim().length > 0,
      };
    } catch {
      return { content: '', filePath: methodPath, tokens: 0, lastModified: null, loaded: false };
    }
  });

  ipcMain.handle('settings:isGoogleConfigured', () => isGoogleConfigured());

  // --- Health Check ---
  ipcMain.handle('health:check', async () => {
    const status = {
      ai: { ok: false, label: 'not found' },
      database: { ok: false, label: 'error' },
      gmail: { ok: false, label: 'not set up' },
      calendar: { ok: false, label: 'not set up' },
      voice: { ok: false, label: 'model missing' },
    };

    // AI engine
    try {
      const engine = getEngine();
      const available = await engine.isAvailable();
      const engineName = getActiveEngineName();
      status.ai = available ? { ok: true, label: `${engineName} ready` } : { ok: false, label: `${engineName} unavailable` };
    } catch {
      status.ai = { ok: false, label: 'engine unavailable' };
    }

    // Database
    try {
      const client = db.getClient();
      const { error } = await client.from('goals').select('id').limit(1);
      status.database = error ? { ok: false, label: 'error' } : { ok: true, label: 'connected' };
    } catch { status.database = { ok: false, label: 'error' }; }

    // Gmail
    try {
      const configured = isGoogleConfigured();
      status.gmail = configured ? { ok: true, label: 'connected' } : { ok: false, label: 'not set up' };
    } catch {}

    // Calendar (same Google credentials)
    status.calendar = { ...status.gmail };

    // Voice (Whisper)
    try {
      const { isLocalWhisperAvailable } = require('../src/voice');
      const available = isLocalWhisperAvailable();
      status.voice = available ? { ok: true, label: 'ready' } : { ok: false, label: 'model missing' };
    } catch { status.voice = { ok: false, label: 'model missing' }; }

    return status;
  });

  // --- Conversational Goal Interview ---
  let interviewHistory = [];
  let interviewMode = null; // 'create' | 'edit'
  let interviewGoalId = null;
  let interviewSending = false;

  ipcMain.handle('interview:start', async (_, options) => {
    interviewHistory = [];
    interviewMode = options && options.goalId ? 'edit' : 'create';
    interviewGoalId = options && options.goalId ? options.goalId : null;

    const userCtx = loadUserContext();
    const userName = (userCtx.identity.match(/\*\*Name:\*\*\s*(.+)/i) || [])[1] || '';
    const cleanName = userName.replace(/\[.*?\]/g, '').trim();

    let systemPrompt = buildGoalInterviewPrompt(cleanName);

    let opening;
    if (interviewMode === 'edit' && interviewGoalId) {
      const goal = await db.getGoal(interviewGoalId);
      if (!goal) return { error: 'Goal not found' };
      const data = goal.goal_data || {};
      const summary = Object.entries(data)
        .filter(([k, v]) => v && k !== 'atlas_directness')
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
        .join(', ');

      opening = await callEngine(
        `The user wants to update their goal "${goal.title}". Here's what we currently have: ${summary}. Generate a warm, brief opening (1-2 sentences) asking what they'd like to change. Don't list every field.`,
        systemPrompt
      );
    } else {
      // Check if Atlas knows the user â€” skip cold intro if so
      const hasIdentity = userCtx.identity && !/\[.*to be filled.*\]/i.test(userCtx.identity);
      const existingSessions = await db.getRecentSessions(30);
      const existingGoals = await db.getActiveGoals();
      const isReturning = hasIdentity || existingSessions.length > 0 || existingGoals.length > 0;

      const createPrompt = isReturning
        ? `The user wants to create a new goal. You already know them${cleanName ? ` (${cleanName})` : ''} and they have ${existingGoals.length} active goal(s). Generate a brief opening (1-2 sentences max). Skip pleasantries. Ask what they're working toward.`
        : `Start a new goal-definition conversation. This is a new user you haven't met yet. Generate a brief opening (2 sentences max). Ask what they're working toward. No preamble.`;

      opening = await callEngine(createPrompt, systemPrompt);
      interviewGoalId = await generateGoalId();
    }

    interviewHistory.push({ role: 'Atlas', content: opening });
    return { opening, goalId: interviewGoalId };
  });

  ipcMain.handle('interview:send', async (_, message, options = {}) => {
    if (interviewSending) return { error: 'Already processing' };
    interviewSending = true;

    const streaming = options.streaming !== false; // default to streaming

    try {
      const systemPrompt = buildGoalInterviewPrompt('');
      let response;

      if (streaming) {
        const historyPrefix = [...interviewHistory];
        const fullPrompt = historyPrefix.length > 0
          ? `Previous conversation:\n${historyPrefix.map((m) => `${m.role}: ${m.content}`).join('\n')}\n\nUser: ${message}`
          : message;

        try {
          response = await callEngineStreaming(fullPrompt, systemPrompt, {}, (chunk) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('interview:stream-chunk', chunk);
            }
          });
        } catch (err) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('interview:stream-error', err.message);
          }
          return { error: err.message };
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('interview:stream-end');
        }
      } else {
        interviewHistory.push({ role: 'User', content: message });
        response = await callEngineConversation(message, systemPrompt, interviewHistory.slice(0, -1));
      }

      if (streaming) {
        interviewHistory.push({ role: 'User', content: message });
      }
      interviewHistory.push({ role: 'Atlas', content: response });

      const isReady = response.trim().startsWith('GOAL_READY');
      let cleanResponse = response.replace(/^GOAL_READY\n?/, '');

      let suggestedPerspectives = null;
      const perspMatch = cleanResponse.match(/^PERSPECTIVES:\s*(.+)$/m);
      if (perspMatch) {
        suggestedPerspectives = perspMatch[1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        cleanResponse = cleanResponse.replace(/^PERSPECTIVES:.*$/m, '').trim();
      }

      return { response: cleanResponse, isReady, suggestedPerspectives };
    } finally {
      interviewSending = false;
    }
  });

  ipcMain.handle('interview:complete', async () => {
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

    const result = await callEngine(structurePrompt, 'You extract structured data from conversations. Output only valid JSON.');
    const match = result.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Failed to structure goal from conversation');

    const goalData = JSON.parse(match[0]);
    goalData.atlas_directness = goalData.atlas_directness || 3;
    setSelectedTone(mapDirectnessToTone(goalData.atlas_directness));

    // Assign perspectives based on goal type, create missing perspective files
    if (!goalData.context_sources) {
      const typeAgents = AGENT_DEFAULTS_BY_TYPE[goalData.type] || ['day-planner'];
      const perspectives = [...new Set([...typeAgents, 'meta-analyst'])];

      // Create any missing perspective files
      for (const p of perspectives) {
        if (!perspectiveExists(p)) {
          const domain = p.replace(/-/g, ' ');
          try {
            await generatePerspective(p, domain);
            console.log(`[Interview] Created perspective: ${p}`);
          } catch (err) {
            console.error(`[Interview] Failed to create perspective ${p}:`, err.message);
          }
        }
      }

      goalData.context_sources = {
        ...DEFAULT_CONTEXT_SOURCES,
        agents: perspectives,
      };
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
    console.log('[Interview] Goal saved:', id, goalData.title, '| perspectives:', goalData.context_sources.agents.join(', '));

    interviewHistory = [];
    interviewMode = null;
    interviewGoalId = null;

    return { id, title: goalData.title, goalData };
  });

  // Keep legacy handler for backward compat
  ipcMain.handle('interview:structure', async (_, answers) => {
    const prompt = `Structure these goal interview answers into a JSON goal record:

${JSON.stringify(answers, null, 2)}

Return a JSON object with fields: id (generate a short slug), title, type (career/financial/learning/health/business/personal), priority (primary/secondary/supporting), outcome, metric, timeline, target_date (YYYY-MM-DD if mentioned), baseline, why_now, constraints, anti_goals, next_milestone, atlas_directness (1-5).

Return ONLY valid JSON.`;

    const result = await callEngine(prompt, 'You structure goal data. Output only valid JSON.');
    const match = result.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Failed to structure goal');
    return JSON.parse(match[0]);
  });

  // --- Conversational Context Update ---
  const contextFileGuidance = {
    'IDENTITY.md': `This file describes who the user is — name, location, background, communication style. Global, not goal-specific.

Check the current file content. If any fields contain placeholder text like "[To be filled in]" or "[User's name]", ask about those fields first. Work through them one at a time. Do not ask open-ended questions when specific fields are blank.`,

    'SITUATION.md': `This file describes the user's current life circumstances. Must be goal-agnostic — do not assume any particular goal type. Ask about what's happening, constraints, what's working, what's not. Include specific domains only when the user volunteers them.

Check the current file content. If any fields contain placeholder text, ask about those fields first. Work through them one at a time. When all fields have real content, propose the update.`,

    'PREFERENCES.md': `This file describes how the user wants Atlas to behave — directness, working style, communication preferences. Global, not goal-specific.

Check the current file content. If any fields contain placeholder text, ask about those fields first. Work through them one at a time. Only broaden to open questions once all fields have real content.`,
  };

  ipcMain.handle('context:interview', async (_, file, message, history, options = {}) => {
    const userCtx = loadUserContext();

    const fileLabels = {
      'IDENTITY.md': { label: 'Identity', current: userCtx.identity },
      'SITUATION.md': { label: 'Situation', current: userCtx.situation },
      'PREFERENCES.md': { label: 'Preferences', current: userCtx.preferences },
    };

    const info = fileLabels[file];
    if (!info) throw new Error('Invalid context file');

    const systemPrompt = buildContextInterviewPrompt(file, info, contextFileGuidance);

    const streaming = options.streaming !== false; // default to streaming
    let response;

    if (streaming) {
      const historyPrefix = history || [];
      const fullPrompt = historyPrefix.length > 0
        ? `Previous conversation:\n${historyPrefix.map((m) => `${m.role}: ${m.content}`).join('\n')}\n\nUser: ${message}`
        : message;

      try {
        response = await callEngineStreaming(fullPrompt, systemPrompt, {}, (chunk) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('context:stream-chunk', chunk);
          }
        });
      } catch (err) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('context:stream-error', err.message);
        }
        return { error: err.message };
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('context:stream-end');
      }
    } else {
      response = await callEngineConversation(message, systemPrompt, history || []);
    }

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

  // --- Decisions ---
  ipcMain.handle('decisions:save', (_, decision) => db.saveDecision(decision));
  ipcMain.handle('decisions:getPending', () => db.getPendingDecisionFollowups());
  ipcMain.handle('decisions:getAll', () => db.getAllDecisions());
  ipcMain.handle('decisions:update', (_, id, updates) => db.updateDecision(id, updates));

  // --- Alerts ---
  ipcMain.handle('atlas:getAlerts', async () => {
    const alerts = [];

    // Overdue actions
    const overdue = await db.getOverdueActions();
    if (overdue.length > 0) {
      alerts.push({
        type: 'overdue',
        priority: 'high',
        message: `${overdue.length} overdue action${overdue.length !== 1 ? 's' : ''} need attention`,
        detail: overdue.map(a => a.description).join(', '),
      });
    }

    // Decision follow-ups due
    try {
      const pendingDecisions = await db.getPendingDecisionFollowups();
      if (pendingDecisions.length > 0) {
        alerts.push({
          type: 'decision_followup',
          priority: 'medium',
          message: `${pendingDecisions.length} decision${pendingDecisions.length !== 1 ? 's' : ''} ready for outcome review`,
        });
      }
    } catch {}

    // Stalled actions (followed up 3+ times)
    const openActions = await db.getOpenActions();
    const stalled = openActions.filter(a => a.follow_up_count >= 3);
    if (stalled.length > 0) {
      alerts.push({
        type: 'stalled',
        priority: 'medium',
        message: `${stalled.length} action${stalled.length !== 1 ? 's' : ''} stalled after repeated follow-ups`,
      });
    }

    // No sessions in 3+ days
    const recentSessions = await db.getRecentSessions(3);
    const sessionsWithSummary = recentSessions.filter(s => s.summary);
    if (sessionsWithSummary.length === 0) {
      const goals = await db.getActiveGoals();
      if (goals.length > 0) {
        alerts.push({
          type: 'inactive',
          priority: 'low',
          message: 'No sessions in the last 3 days. Your goals are still waiting.',
        });
      }
    }

    return alerts;
  });

  // --- Rescue Mode ---
  ipcMain.handle('brief:rescue', async () => {
    const goals = await db.getActiveGoals();
    if (goals.length === 0) return null;

    const systemPrompt = await buildSystemPrompt(goals);
    const openActions = await db.getOpenActions();
    const overdueActions = await db.getOverdueActions();

    const rescuePrompt = `The user is overwhelmed and needs a reset. Do not challenge, do not follow up on overdue items, do not discuss what went wrong. Just stabilise.

Open actions: ${openActions.length} (${overdueActions.length} overdue)
Active goals: ${goals.map(g => g.title).join(', ')}

Produce exactly this, nothing more:
1. **The one thing that matters today** — the single highest-leverage action
2. **What can wait** — everything else, with permission to ignore it today
3. **Your next 30 minutes** — exactly what to do right now, step by step
4. **Stop doing this** — one thing to drop or pause immediately

Be warm. Be brief. Under 1 minute to read. The user needs clarity, not more pressure.`;

    return callEngine(rescuePrompt, systemPrompt);
  });

  // --- Weekly Review ---
  ipcMain.handle('brief:weeklyReview', async (_, options) => {
    const goals = await db.getActiveGoals();
    if (goals.length === 0) return null;

    const systemPrompt = await buildSystemPrompt(goals, options || {});
    const weekSessions = await db.getRecentSessions(7);
    const openActions = await db.getOpenActions();
    const overdueActions = await db.getOverdueActions();
    const completedActions = await db.getCompletedActions();
    const weekCompletions = completedActions.filter(a => {
      if (!a.completed_at) return false;
      const d = new Date(a.completed_at);
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      return d >= weekAgo;
    });

    const sessionSummaries = weekSessions
      .filter(s => s.summary)
      .map(s => `- [${s.date}] ${s.summary}`)
      .join('\n') || 'No sessions this week.';

    const reviewPrompt = `Generate a weekly strategic review. This week: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.

This week's sessions (${weekSessions.length}):
${sessionSummaries}

Actions completed this week: ${weekCompletions.length}
Currently open: ${openActions.length} (${overdueActions.length} overdue)

Active goals: ${goals.map(g => g.title).join(', ')}

Structure your review as:
1. **Week in review** — what actually happened across all goals, 3-5 sentences
2. **Momentum check** — which goals gained ground, which stalled, which drifted
3. **Patterns this week** — recurring behaviours, positive or negative
4. **Goal health** — should any goal be protected harder, paused, revised, or dropped?
5. **Next week's focus** — the 2-3 things that would make next week count

Be honest. Reference specific sessions and actions. Under 3 minutes to read.`;

    return callEngine(reviewPrompt, systemPrompt);
  });

  // --- Preparation Mode ---
  ipcMain.handle('chat:prepare', async (_, eventDescription) => {
    const goals = await db.getActiveGoals();
    const systemPrompt = await buildSystemPrompt(goals);

    const prepPrompt = `The user has a high-stakes event coming up and needs thorough preparation.

Event: ${eventDescription}

Produce a structured preparation brief:
1. **Event overview** — what this is and why it matters to the active goals
2. **Research** — what you know or can find about the other party, context, and environment. Use [SEARCH: query] if you need current information.
3. **Positioning** — how to frame the user's background and strengths for this specific event
4. **Likely questions or challenges** — what to expect and how to handle each
5. **Questions to ask** — what the user should ask to demonstrate engagement and gather information
6. **Risks and preparation gaps** — what could go wrong and how to mitigate it
7. **One-page summary** — the key points to remember, scannable in 2 minutes

Be specific to this event and this user. Reference their goals, experience, and situation. Generic advice is worthless here.`;

    return callEngine(prepPrompt, systemPrompt);
  });

  // --- User Model Regeneration ---
  ipcMain.handle('settings:regenerateUserModel', async () => {
    const model = await runUserModelGeneration();
    return { success: !!model, content: model };
  });

  // --- User Model Status ---
  ipcMain.handle('settings:getUserModelStatus', async () => {
    const settings = readRuntimeJson('settings.json', {});
    const model = await db.getLatestUserModel();
    return {
      exists: !!model,
      lastGenerated: model ? model.created_at : null,
      sessionsSinceRegeneration: settings.sessionsSinceLastUserModel || 0,
    };
  });
}


