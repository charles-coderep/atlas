const readline = require('readline');
const path = require('path');
const {
  getActiveGoals, createSession, updateSession,
  getOpenActions, getOverdueActions, updateAction,
  searchEntries, getRecentSessions,
} = require('./db');
const { buildSystemPrompt, callEngine, callEngineConversation, loadUserContext } = require('./orchestrator');
const { processSession } = require('./processor');
const { webSearch, processSearchMarkers } = require('./search');
const { ingestFile, listFiles } = require('./files');
const { searchGmail, getCachedEmailContext } = require('./integrations/gmail');

let activeSession = null;
let activeConversationHistory = [];
let sessionStartTime = null;

// Session safety — handle unexpected exits
async function emergencyProcessing() {
  if (!activeSession) return;

  const duration = Math.round((Date.now() - sessionStartTime) / 60000);
  try {
    if (activeConversationHistory.length >= 4) {
      await processSession(activeSession.id, activeConversationHistory, duration);
      console.log('\n  [Session saved on exit]');
    } else {
      await updateSession(activeSession.id, { duration_minutes: duration });
    }
  } catch {}
  activeSession = null;
}

process.on('SIGINT', async () => {
  await emergencyProcessing();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await emergencyProcessing();
  process.exit(0);
});

process.on('beforeExit', async () => {
  await emergencyProcessing();
});

// --- Command handlers ---

async function handleComplete(searchText, rl) {
  const openActions = await getOpenActions();

  if (openActions.length === 0) {
    console.log('\n  No open action items.\n');
    return;
  }

  if (!searchText) {
    console.log('\n  Usage: /complete <search text>');
    console.log('  Open actions:');
    for (const a of openActions) {
      const due = a.due_date ? ` (due: ${a.due_date})` : '';
      console.log(`    - ${a.description}${due}`);
    }
    console.log('');
    return;
  }

  const search = searchText.toLowerCase();
  const matches = openActions.filter((a) => a.description.toLowerCase().includes(search));

  if (matches.length === 0) {
    console.log('\n  No matching action found. Open actions:');
    for (const a of openActions) {
      console.log(`    - ${a.description}`);
    }
    console.log('');
    return;
  }

  if (matches.length === 1) {
    await updateAction(matches[0].id, { status: 'completed' });
    console.log(`\n  Completed: ${matches[0].description}\n`);
    return;
  }

  console.log('\n  Multiple matches found:');
  for (let i = 0; i < matches.length; i++) {
    const due = matches[i].due_date ? ` (due: ${matches[i].due_date})` : '';
    console.log(`    ${i + 1}. ${matches[i].description}${due}`);
  }

  const answer = await new Promise((resolve) => {
    rl.question('  Which one? (number): ', (ans) => resolve(ans.trim()));
  });

  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < matches.length) {
    await updateAction(matches[idx].id, { status: 'completed' });
    console.log(`\n  Completed: ${matches[idx].description}\n`);
  } else {
    console.log('  Invalid choice.\n');
  }
}

async function handleRecall(topic, conversationHistory, systemPrompt) {
  if (!topic) {
    console.log('\n  Usage: /recall <topic>\n');
    return null;
  }

  console.log(`  [Searching memory for: ${topic}]`);
  const keywords = topic.split(/\s+/).filter((w) => w.length > 2);
  const entries = await searchEntries(keywords, 5);

  if (entries.length === 0) {
    console.log('  No matching entries found.\n');
    return null;
  }

  console.log(`  Found ${entries.length} relevant entries.\n`);

  const context = entries.map((e) => {
    const source = e.source === 'session' ? 'auto-captured' : e.source;
    return `[${source}] [${e.date}] [${e.entry_type}] ${e.content}`;
  }).join('\n');

  return context;
}

async function handleContext() {
  const ctx = loadUserContext();

  console.log('\n  ============================================');
  console.log('  User Context Files');
  console.log('  ============================================');

  console.log('\n  --- IDENTITY.md [user-maintained] ---');
  console.log(`  ${ctx.identity.split('\n').join('\n  ')}`);

  console.log('\n  --- SITUATION.md [user-maintained] ---');
  console.log(`  ${ctx.situation.split('\n').join('\n  ')}`);

  console.log('\n  --- PREFERENCES.md [user-maintained] ---');
  console.log(`  ${ctx.preferences.split('\n').join('\n  ')}`);

  console.log('\n  Edit these files directly in config/user/ to update your context.\n');
}

async function generateSessionOpening(overdueActions, highFollowUpActions, systemPrompt) {
  const items = [];

  for (const a of overdueActions) {
    items.push(`OVERDUE: "${a.description}" was due ${a.due_date}. Follow-up count: ${a.follow_up_count}.`);
  }

  for (const a of highFollowUpActions) {
    if (!overdueActions.find((o) => o.id === a.id)) {
      items.push(`STALLED: "${a.description}" has been followed up ${a.follow_up_count} times with no progress.`);
    }
  }

  if (items.length === 0) return null;

  const prompt = `You are starting a new advisory session. These items need attention:

${items.join('\n')}

Generate a brief, direct opening check-in. For overdue items, ask if they happened or should be rescheduled. For stalled items (3+ follow-ups), diagnose the obstacle per your escalation protocol. Keep it conversational, not a guilt trip. 2-4 sentences max.`;

  try {
    return await callEngine(prompt, systemPrompt);
  } catch {
    return null;
  }
}

// --- Process [SEARCH:] and [RECALL:] markers in Atlas responses ---

async function processMarkers(response, conversationHistory, systemPrompt) {
  const searchPattern = /\[SEARCH:\s*(.+?)\]/g;
  const recallPattern = /\[RECALL:\s*(.+?)\]/g;
  const emailSearchPattern = /\[EMAIL_SEARCH:\s*(.+?)\]/g;

  const searchMatches = [...response.matchAll(searchPattern)];
  const recallMatches = [...response.matchAll(recallPattern)];
  const emailSearchMatches = [...response.matchAll(emailSearchPattern)];

  if (searchMatches.length === 0 && recallMatches.length === 0 && emailSearchMatches.length === 0) {
    return response;
  }

  // Collect all results before making a single refinement call
  const contextParts = [];

  // Process all web searches
  for (const match of searchMatches) {
    const query = match[1].trim();
    console.log(`\n  [Searching web: ${query}]`);
    const result = await webSearch(query, systemPrompt);
    contextParts.push(`Web search results for "${query}":\n${result}`);
  }

  // Process all email searches
  for (const match of emailSearchMatches) {
    const query = match[1].trim();
    console.log(`\n  [Searching email: ${query}]`);
    const results = await searchGmail(query);
    if (results.length > 0) {
      const formatted = results.map((r) =>
        `From: ${r.from}\nSubject: ${r.subject}\nDate: ${r.date}\nPreview: ${r.snippet}`
      ).join('\n\n');
      contextParts.push(`Email search results for "${query}":\n${formatted}`);
    } else {
      contextParts.push(`Email search for "${query}": no results found.`);
    }
  }

  // Process all recalls
  for (const match of recallMatches) {
    const topic = match[1].trim();
    console.log(`\n  [Recalling: ${topic}]`);
    const keywords = topic.split(/\s+/).filter((w) => w.length > 2);
    const entries = await searchEntries(keywords, 5);

    if (entries.length > 0) {
      const context = entries.map((e) => `[${e.date}] [${e.entry_type}] ${e.content}`).join('\n');
      contextParts.push(`Memory results for "${topic}":\n${context}`);
    }
  }

  if (contextParts.length === 0) return response;

  // Single refinement call with all gathered context
  const refinedPrompt = `Here is the information you requested:\n\n${contextParts.join('\n\n---\n\n')}\n\nNow incorporate all of this into your advice. Cite what you found. Be specific. Reference past events naturally where relevant.`;
  return await callEngineConversation(refinedPrompt, systemPrompt, conversationHistory);
}

// --- Main session ---

async function runSession(options = {}) {
  const goals = await getActiveGoals();

  if (goals.length === 0) {
    console.log('\n  No active goals found. Run the goal-definition interview first.\n');
    return;
  }

  const session = await createSession('advisory');
  activeSession = session;
  activeConversationHistory = [];
  sessionStartTime = Date.now();

  const systemPrompt = await buildSystemPrompt(goals, {
    calendarData: options.calendarData || null,
    emailData: options.emailData || null,
  });
  const conversationHistory = activeConversationHistory;
  let recallContext = ''; // Extra context from /recall commands

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n  ============================================');
  console.log('  ATLAS — Advisory Session');
  console.log('  ============================================');
  console.log('  Commands: /brief /goals /actions /complete /history /search /recall /upload /files /emails /context /quit\n');

  // Follow-up logic — check for overdue and stalled actions
  const overdueActions = await getOverdueActions();
  const openActions = await getOpenActions();
  const highFollowUpActions = openActions.filter((a) => a.follow_up_count >= 2);

  if (overdueActions.length > 0 || highFollowUpActions.length > 0) {
    const opening = await generateSessionOpening(overdueActions, highFollowUpActions, systemPrompt);
    if (opening) {
      console.log(`  Atlas: ${opening.split('\n').join('\n  ')}\n`);
      conversationHistory.push({ role: 'Atlas', content: opening });

      for (const a of [...overdueActions, ...highFollowUpActions]) {
        await updateAction(a.id, { follow_up_count: a.follow_up_count + 1 });
      }
    }
  }

  const prompt = () => {
    rl.question('  You: ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) { prompt(); return; }

      // --- Commands ---

      if (trimmed === '/quit' || trimmed === '/exit') {
        console.log('\n  Processing session...\n');
        const duration = Math.round((Date.now() - sessionStartTime) / 60000);

        try {
          const result = await processSession(session.id, conversationHistory, duration);
          console.log(`  Session logged. ${result.entries} entries extracted, ${result.actions} action items tracked.`);
        } catch (err) {
          console.error(`  Warning: post-session processing failed: ${err.message}`);
          await updateSession(session.id, { duration_minutes: duration });
        }

        console.log('  Session ended. Stay sharp.\n');
        activeSession = null;
        rl.close();
        return;
      }

      if (trimmed === '/brief') {
        const { generateBrief } = require('./brief');
        await generateBrief(options);
        prompt(); return;
      }

      if (trimmed === '/goals') {
        const currentGoals = await getActiveGoals();
        console.log('\n  Active Goals:');
        for (const g of currentGoals) {
          console.log(`    [${g.priority || '-'}] ${g.title} (${g.id})`);
        }
        console.log('');
        prompt(); return;
      }

      if (trimmed === '/actions') {
        const actions = await getOpenActions();
        if (actions.length === 0) {
          console.log('\n  No open action items.\n');
        } else {
          console.log('\n  Open Actions:');
          for (const a of actions) {
            const due = a.due_date ? ` (due: ${a.due_date})` : '';
            const overdue = a.due_date && a.due_date < new Date().toISOString().split('T')[0] ? ' OVERDUE' : '';
            const followups = a.follow_up_count > 0 ? ` [${a.follow_up_count}x follow-up]` : '';
            console.log(`    - ${a.description}${due}${overdue}${followups}`);
          }
          console.log('');
        }
        prompt(); return;
      }

      if (trimmed.startsWith('/complete')) {
        await handleComplete(trimmed.replace('/complete', '').trim(), rl);
        prompt(); return;
      }

      if (trimmed === '/history') {
        const sessions = await getRecentSessions(7);
        if (sessions.length === 0) {
          console.log('\n  No recent sessions.\n');
        } else {
          console.log('\n  Recent Sessions (last 7 days):');
          for (const s of sessions) {
            console.log(`    [${s.date}] ${s.mode || 'session'} — ${s.summary || 'No summary'}`);
          }
          console.log('');
        }
        prompt(); return;
      }

      if (trimmed.startsWith('/search')) {
        const query = trimmed.replace('/search', '').trim();
        if (!query) {
          console.log('\n  Usage: /search <query>\n');
          prompt(); return;
        }
        console.log(`  [Searching: ${query}]`);
        const result = await webSearch(query, systemPrompt);
        console.log(`\n  ${result.split('\n').join('\n  ')}\n`);
        // Add to conversation context
        conversationHistory.push({ role: 'User', content: `/search ${query}` });
        conversationHistory.push({ role: 'Atlas', content: result });
        prompt(); return;
      }

      if (trimmed.startsWith('/recall')) {
        const topic = trimmed.replace('/recall', '').trim();
        const context = await handleRecall(topic, conversationHistory, systemPrompt);
        if (context) {
          recallContext = context;
          console.log('  Memory loaded into context for your next message.\n');
        }
        prompt(); return;
      }

      if (trimmed.startsWith('/upload')) {
        const filePath = trimmed.replace('/upload', '').trim();
        if (!filePath) {
          console.log('\n  Usage: /upload <filepath> [goal_id]\n');
          prompt(); return;
        }
        const parts = filePath.split(/\s+/);
        const fp = parts[0];
        const goalId = parts[1] || null;
        const resolved = path.isAbsolute(fp) ? fp : path.resolve(fp);

        try {
          const { file, truncated } = await ingestFile(resolved, goalId);
          console.log(`\n  File ingested: ${file.filename}${truncated ? ' (truncated — file was large)' : ''}`);
          console.log('  I can now reference it in our conversations.\n');
        } catch (err) {
          console.error(`\n  Upload failed: ${err.message}\n`);
        }
        prompt(); return;
      }

      if (trimmed === '/files') {
        const files = await listFiles();
        if (files.length === 0) {
          console.log('\n  No files ingested. Use /upload <filepath> to add one.\n');
        } else {
          console.log('\n  Ingested Files:');
          for (const f of files) {
            const goal = f.goal_id ? ` (${f.goal_id})` : '';
            console.log(`    - ${f.filename} [${f.file_type}]${goal} — ${new Date(f.uploaded_at).toLocaleDateString()}`);
          }
          console.log('');
        }
        prompt(); return;
      }

      if (trimmed === '/emails') {
        const emailCtx = getCachedEmailContext();
        if (!emailCtx) {
          console.log('\n  No email data available. Gmail may not be configured or no emails were found.\n');
        } else {
          console.log('\n  ============================================');
          console.log('  Email Context');
          console.log('  ============================================');
          console.log(`  Scanned: ${emailCtx.triageCount} emails (last 72h)`);
          console.log(`  Deeply read: ${emailCtx.deepReadCount} (goal-relevant)`);
          console.log(`  Threads expanded: ${emailCtx.expandedThreadCount}`);
          console.log(`  Inbox unread: ${emailCtx.unreadCount}`);
          if (emailCtx.summaries && emailCtx.summaries.length > 0) {
            console.log('\n  Deeply read emails:');
            for (const s of emailCtx.summaries) {
              const status = s.isUnread ? 'UNREAD' : 'read';
              console.log(`    [${status}] ${s.from}`);
              console.log(`      Subject: ${s.subject}`);
              if (s.threadExpanded) {
                console.log(`      Thread: ${s.threadMessages.length} messages (expanded)`);
              }
            }
          }
          console.log('');
        }
        prompt(); return;
      }

      if (trimmed === '/context') {
        await handleContext();
        prompt(); return;
      }

      // --- Normal message ---

      conversationHistory.push({ role: 'User', content: trimmed });

      // If recall context was loaded, inject it
      let effectivePrompt = trimmed;
      if (recallContext) {
        effectivePrompt = `[Retrieved memory context:\n${recallContext}]\n\nUser message: ${trimmed}`;
        recallContext = '';
      }

      try {
        process.stdout.write('\n  Atlas: ');
        let response = await callEngineConversation(effectivePrompt, systemPrompt, conversationHistory.slice(0, -1));

        // Process any [SEARCH:] or [RECALL:] markers in the response
        response = await processMarkers(response, conversationHistory, systemPrompt);

        console.log(`${response.split('\n').join('\n  ')}\n`);
        conversationHistory.push({ role: 'Atlas', content: response });
      } catch (err) {
        console.error(`\n  [Error: ${err.message}]\n`);
      }

      prompt();
    });
  };

  prompt();

  return new Promise((resolve) => {
    rl.on('close', resolve);
  });
}

module.exports = { runSession };
