const { updateSession, saveEntry, updateEntry, saveAction, saveOverride, getOpenActions, getActiveGoals, getCompletedActions, getRecentSessions, getRecentEntries, getPersistentEntries, saveDecision, getLatestUserModel, clearPreviousUserModels, getDailyDigest, getSessionsByDate } = require('./db');
const { callEngine } = require('./orchestrator');

const EXTRACTION_RUBRIC = `Rules for extraction:
- Be concise. Short, factual descriptions over verbose explanations.
- Preserve uncertainty. If something was tentative, mark it as such.
- Do not overstate confidence or importance.
- Only extract items worth remembering — not every sentence is an entry.`;

async function processSession(sessionId, conversationHistory, durationMinutes, onProgress) {
  if (conversationHistory.length < 2) {
    // Need at least one exchange to be worth processing
    await updateSession(sessionId, { duration_minutes: durationMinutes });
    return { entries: 0, actions: 0 };
  }

  const transcript = conversationHistory.map((m) => `${m.role}: ${m.content}`).join('\n\n');
  const goals = await getActiveGoals();
  const goalIds = goals.map((g) => `${g.id}: ${g.title}`).join(', ');

  if (onProgress) onProgress('Summarising conversation and extracting insights...');

  // Run combined extractions in parallel (2 CLI calls instead of 4)
  const [summaryAndEntries, actionsAndDecisions] = await Promise.all([
    extractSummaryAndEntries(transcript, goalIds),
    extractActionsAndDecisions(transcript, goalIds),
  ]);

  const summary = summaryAndEntries.summary;
  const rawEntries = summaryAndEntries.entries;
  const rawActions = actionsAndDecisions.actions;
  const rawDecisions = actionsAndDecisions.decisions;

  // Save session summary
  await updateSession(sessionId, {
    summary,
    duration_minutes: durationMinutes,
  });

  if (onProgress) onProgress(`Extracted ${rawEntries.length} entries, ${rawActions.length} actions, ${rawDecisions.length} decisions. Deduplicating...`);

  // Deduplicate entries and actions together
  let entries;
  let actions;
  let overrides;
  if (rawEntries.length + rawActions.length <= 10) {
    entries = rawEntries;
    actions = rawActions;
    overrides = rawEntries.filter((entry) => entry.entry_type === 'override');
  } else {
    ({ entries, actions, overrides } = await deduplicateExtractions(rawEntries, rawActions));
  }

  // Cross-session dedup: remove new entries already covered by recent database entries
  if (entries.length > 0) {
    if (onProgress) onProgress('Checking for cross-session duplicates...');
    entries = await deduplicateAgainstExisting(entries);
  }

  // Check for duplicate actions against existing open actions
  const existingActions = await getOpenActions();
  const newActions = await filterDuplicateActions(actions, existingActions);

  if (onProgress) onProgress('Saving to database...');

  // Save entries
  let entryCount = 0;
  for (const entry of entries) {
    try {
      const saved = await saveEntry({
        session_id: sessionId,
        goal_id: entry.goal_id || null,
        domain: entry.domain,
        entry_type: entry.entry_type,
        content: entry.content,
        importance: entry.importance,
        is_persistent: entry.importance >= 4,
        source: 'session',
        tags: entry.tags || [],
      });

      // If this is an override entry, also write to overrides table (Addendum 2)
      if (entry.entry_type === 'override') {
        const override = overrides.find((o) => o.content === entry.content);
        if (override) {
          await saveOverride({
            session_id: sessionId,
            goal_id: entry.goal_id || null,
            atlas_recommendation: override.atlas_recommendation || 'See entry',
            user_decision: override.user_decision || 'See entry',
            user_reasoning: override.user_reasoning || null,
          });
        }
      }

      entryCount++;
    } catch (err) {
      console.error(`  Warning: failed to save entry: ${err.message}`);
    }
  }

  // Save actions
  let actionCount = 0;
  for (const action of newActions) {
    try {
      await saveAction({
        goal_id: action.goal_id || null,
        description: action.description,
        due_date: action.due_date || null,
      });
      actionCount++;
    } catch (err) {
      console.error(`  Warning: failed to save action: ${err.message}`);
    }
  }

  // Save decisions
  let decisionCount = 0;
  for (const decision of rawDecisions) {
    try {
      await saveDecision({
        session_id: sessionId,
        goal_id: decision.goal_id || null,
        description: decision.description,
        alternatives: decision.alternatives || null,
        expected_outcome: decision.expected_outcome || null,
        atlas_confidence: decision.atlas_confidence || null,
        follow_up_date: decision.follow_up_date || null,
      });
      decisionCount++;
    } catch (err) {
      console.error(`  Warning: failed to save decision: ${err.message}`);
    }
  }

  // Generate or update daily digest (runs after all saves complete)
  if (summary && summary !== 'Summary generation failed.') {
    try {
      if (onProgress) onProgress('Updating daily digest...');
      await updateDailyDigest(summary);
    } catch (err) {
      console.error('[Processor] Daily digest update failed:', err.message);
    }
  }

  return { entries: entryCount, actions: actionCount, decisions: decisionCount };
}

async function updateDailyDigest(latestSessionSummary) {
  const today = new Date().toISOString().split('T')[0];
  const existingDigest = await getDailyDigest(today);

  if (existingDigest) {
    // Merge new session into existing digest
    const prompt = `Here is today's existing daily digest and the summary from the latest session. Merge them into one updated digest.

EXISTING DIGEST:
${existingDigest.content}

NEW SESSION SUMMARY:
${latestSessionSummary}

Rules:
- If the new session contains information already covered in the digest, do not add it again.
- If the new session adds a meaningful new detail to something already mentioned, update that section with the new detail.
- If the new session introduces an entirely new topic, append it.
- If the new session contradicts something in the existing digest (for example, a plan changed or something was canceled), replace the old information with the new.
- The digest should read as one coherent summary of the day, not as a list of sessions.
- Keep it under 250 words.

Output ONLY the updated digest text, nothing else.`;

    try {
      const updated = await callEngine(prompt, 'You merge session summaries into a concise daily digest. Output only the digest text.');
      if (updated && updated.length > 20) {
        await updateEntry(existingDigest.id, { content: updated });
        console.log('[Processor] Daily digest updated for', today);
      }
    } catch (err) {
      console.error('[Processor] Digest merge failed:', err.message);
    }
  } else {
    // First session of the day — gather all today's sessions and create digest
    const todaySessions = await getSessionsByDate(today);
    const summaries = todaySessions.filter(s => s.summary).map(s => s.summary);

    // If this is the only session, use the summary directly without an AI call
    if (summaries.length <= 1) {
      await saveEntry({
        session_id: null,
        goal_id: null,
        domain: 'meta',
        entry_type: 'daily_digest',
        content: latestSessionSummary,
        importance: 4,
        is_persistent: true,
        source: 'system',
        date: today,
        tags: ['daily-digest'],
      });
      console.log('[Processor] Daily digest created for', today);
      return;
    }

    // Multiple sessions already exist — consolidate
    const prompt = `Produce a single consolidated summary of everything discussed, decided, and committed to today across these advisory sessions.

TODAY'S SESSION SUMMARIES:
${summaries.map((s, i) => `Session ${i + 1}: ${s}`).join('\n\n')}

Write one coherent summary covering the full day. Not a list of sessions — a unified summary. Keep it under 250 words.

Output ONLY the digest text, nothing else.`;

    try {
      const digest = await callEngine(prompt, 'You consolidate multiple session summaries into one daily digest. Output only the digest text.');
      if (digest && digest.length > 20) {
        await saveEntry({
          session_id: null,
          goal_id: null,
          domain: 'meta',
          entry_type: 'daily_digest',
          content: digest,
          importance: 4,
          is_persistent: true,
          source: 'system',
          date: today,
          tags: ['daily-digest'],
        });
        console.log('[Processor] Daily digest created for', today);
      }
    } catch (err) {
      console.error('[Processor] Digest creation failed:', err.message);
    }
  }
}

async function extractSummaryAndEntries(transcript, goalIds) {
  const prompt = `You are processing an advisory session transcript. Produce TWO outputs in a single response.

PART 1 — SESSION SUMMARY:
Summarise this session in 3-5 sentences. Capture: what was discussed, what was decided, what commitments were made, and any notable patterns or insights. Be concise and factual.

PART 2 — MEMORY ENTRIES:
Extract important items as a JSON array. Each item should have:
- "domain": one of career, finances, learning, health, business, personal, meta
- "entry_type": one of insight, decision, commitment, pattern, alert, data_point, breakthrough, override
- "content": a concise description of the item
- "importance": 1-5 (5=critical strategic decisions, 4=significant reusable insights, 3=notable context, 2=routine updates, 1=ephemeral)
- "goal_id": the relevant goal ID from [${goalIds}], or null if global
- "tags": array of relevant short tags

For entries with entry_type "override" (user disagreed with Atlas), also include:
- "atlas_recommendation": what Atlas recommended
- "user_decision": what the user chose instead
- "user_reasoning": why, if stated

Only extract items worth remembering. Not every sentence is an entry. Focus on decisions, commitments, insights, and patterns.

${EXTRACTION_RUBRIC}

RESPONSE FORMAT — use exactly this structure:

SUMMARY:
[your 3-5 sentence summary here]

ENTRIES_JSON:
[your JSON array here]

${transcript}`;

  try {
    const result = await callEngine(prompt, 'You extract session summaries and memory entries. Follow the response format exactly.');

    // Parse summary
    let summary = 'Summary generation failed.';
    const summaryMatch = result.match(/SUMMARY:\s*\n([\s\S]*?)(?=\nENTRIES_JSON:)/);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    }

    // Parse entries
    let entries = [];
    const entriesMatch = result.match(/ENTRIES_JSON:\s*\n([\s\S]*)/);
    if (entriesMatch) {
      const jsonMatch = entriesMatch[1].match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        entries = JSON.parse(jsonMatch[0]);
      }
    }

    return { summary, entries };
  } catch (err) {
    console.error('[Processor] Summary+entries extraction failed:', err.message);
    return { summary: 'Summary generation failed.', entries: [] };
  }
}

async function extractActionsAndDecisions(transcript, goalIds) {
  const prompt = `You are processing an advisory session transcript. Extract TWO types of items in a single response.

PART 1 — ACTION ITEMS:
Extract any commitments or action items the user made or agreed to. Each item should have:
- "description": what needs to be done
- "goal_id": relevant goal ID from [${goalIds}], or null
- "due_date": YYYY-MM-DD if mentioned or inferable, otherwise null

Only include concrete, actionable commitments. Not vague intentions.

PART 2 — STRATEGIC DECISIONS:
Extract any significant decisions that were made or confirmed. A decision is different from an action — it is a choice between alternatives that affects strategy. Each item should have:
- "description": what was decided
- "alternatives": what other options were considered (or "none discussed")
- "expected_outcome": what the user/Atlas expects to happen as a result
- "atlas_confidence": "high", "medium", or "low"
- "goal_id": relevant goal ID from [${goalIds}], or null
- "follow_up_date": YYYY-MM-DD — when to check how this decision played out (typically 1-4 weeks)

Only extract genuine decisions, not routine actions. "Applied to 3 jobs" is an action. "Decided to focus on React roles over full-stack" is a decision.

${EXTRACTION_RUBRIC}

RESPONSE FORMAT — use exactly this structure:

ACTIONS_JSON:
[your JSON array of actions here]

DECISIONS_JSON:
[your JSON array of decisions here]

${transcript}`;

  try {
    const result = await callEngine(prompt, 'You extract action items and strategic decisions. Follow the response format exactly.');

    // Parse actions
    let actions = [];
    const actionsMatch = result.match(/ACTIONS_JSON:\s*\n([\s\S]*?)(?=\nDECISIONS_JSON:)/);
    if (actionsMatch) {
      const jsonMatch = actionsMatch[1].match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        actions = JSON.parse(jsonMatch[0]);
      }
    }

    // Parse decisions
    let decisions = [];
    const decisionsMatch = result.match(/DECISIONS_JSON:\s*\n([\s\S]*)/);
    if (decisionsMatch) {
      const jsonMatch = decisionsMatch[1].match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        decisions = JSON.parse(jsonMatch[0]);
      }
    }

    return { actions, decisions };
  } catch (err) {
    console.error('[Processor] Actions+decisions extraction failed:', err.message);
    return { actions: [], decisions: [] };
  }
}

async function deduplicateExtractions(entries, actions) {
  if (entries.length === 0 && actions.length === 0) {
    return { entries: [], actions: [], overrides: [] };
  }

  const prompt = `You have two lists extracted from the same conversation. Remove duplicates and near-duplicates.

ENTRIES:
${JSON.stringify(entries, null, 2)}

ACTIONS:
${JSON.stringify(actions, null, 2)}

Rules:
- If two entries describe the same insight in different words, merge into one (keep the better wording, higher importance).
- If an action restates what a "commitment" entry already says, keep the action (it's the trackable version) and keep the entry as the memory note — but don't have two entries saying the same thing.
- Remove any items that are trivially obvious or not worth storing.

Return ONLY a JSON object with three keys:
{
  "entries": [deduplicated entries array],
  "actions": [deduplicated actions array],
  "overrides": [any override entries extracted, with atlas_recommendation, user_decision, user_reasoning fields]
}`;

  try {
    const result = await callEngine(prompt, 'You deduplicate extracted data. Output only valid JSON.');
    const match = result.match(/\{[\s\S]*\}/);
    if (!match) return { entries, actions, overrides: [] };
    const parsed = JSON.parse(match[0]);
    return {
      entries: parsed.entries || entries,
      actions: parsed.actions || actions,
      overrides: parsed.overrides || [],
    };
  } catch {
    return { entries, actions, overrides: [] };
  }
}

async function filterDuplicateActions(newActions, existingActions) {
  if (newActions.length === 0 || existingActions.length === 0) {
    return newActions;
  }

  const existingDescs = existingActions.map((a) => a.description.toLowerCase());

  return newActions.filter((action) => {
    const desc = action.description.toLowerCase();
    // Simple substring check — if the new action's core content appears in an existing one, skip it
    return !existingDescs.some((existing) =>
      existing.includes(desc) || desc.includes(existing)
    );
  });
}

async function deduplicateAgainstExisting(newEntries) {
  if (newEntries.length === 0) return newEntries;

  const existingEntries = await getRecentEntries(7);
  if (existingEntries.length === 0) return newEntries;

  const prompt = `Here are entries already in the database from previous sessions, and here are new entries about to be saved from the latest session.

EXISTING DATABASE ENTRIES:
${JSON.stringify(existingEntries.map(e => ({ content: e.content, entry_type: e.entry_type, date: e.date })), null, 2)}

NEW ENTRIES TO SAVE:
${JSON.stringify(newEntries.map((e, i) => ({ index: i, content: e.content, entry_type: e.entry_type })), null, 2)}

Remove any new entry that duplicates information already stored. Rules:
- If a new entry is essentially the same information as an existing entry restated in different words, remove it.
- If a new entry adds a meaningful update or new detail to an existing fact, KEEP the new entry.
- If a new entry covers an entirely new topic not in the existing entries, KEEP it.
- When in doubt, keep the new entry.

Return ONLY a JSON array of the index numbers of new entries that SHOULD BE SAVED. For example: [0, 2, 3] means keep entries at index 0, 2, and 3, and discard the rest.`;

  try {
    const result = await callEngine(prompt, 'You identify duplicate entries. Output only a valid JSON array of index numbers.');
    const match = result.match(/\[[\s\S]*?\]/);
    if (!match) return newEntries;

    const keepIndices = JSON.parse(match[0]);
    if (!Array.isArray(keepIndices)) return newEntries;

    const filtered = newEntries.filter((_, i) => keepIndices.includes(i));
    const removed = newEntries.length - filtered.length;
    if (removed > 0) {
      console.log(`[Processor] Cross-session dedup: removed ${removed} duplicate entries`);
    }
    return filtered;
  } catch (err) {
    console.error('[Processor] Cross-session dedup failed:', err.message);
    return newEntries;
  }
}

async function generateUserModel(recentSessions, persistentEntries, existingModel) {
  const sessionContext = recentSessions
    .filter(s => s.summary)
    .map(s => `[${s.date}] ${s.summary}`)
    .join('\n');

  const patternEntries = persistentEntries
    .filter(e => ['pattern', 'override', 'breakthrough', 'insight'].includes(e.entry_type))
    .map(e => `[${e.entry_type}] ${e.content}`)
    .join('\n');

  const prompt = `Based on the following session history and persistent observations, generate a concise user model. This is Atlas's private working understanding of the user — it will be loaded into every future session to improve advice quality.

Recent sessions:
${sessionContext}

Persistent observations:
${patternEntries}

${existingModel ? `Previous user model:\n${existingModel}\n\nUpdate this model based on new evidence. Preserve what is still true. Revise what has changed. Add new observations.` : 'This is the first user model. Build it from what you can observe.'}

Generate a model covering:
1. **Decision-making style** — how they approach choices, what they tend to over/underweight
2. **Recurring patterns** — what behaviours repeat across sessions (positive and negative)
3. **What advice lands** — what kind of recommendations they actually act on vs resist
4. **Blind spots** — what they consistently miss or avoid
5. **Motivation drivers** — what genuinely moves them to action
6. **Working relationship** — what works best when advising this person (directness level, detail level, push vs support)

Keep it under 300 words. Be specific and evidence-based — reference actual events and patterns, not generic observations. Write in third person. This is a private advisory document, not a message to the user.`;

  return await callEngine(prompt, 'You synthesise behavioural observations into a concise user model. Output only the model text.');
}

async function runUserModelGeneration() {
  try {
    const recentSessions = await getRecentSessions(30);
    const persistentEntries = await getPersistentEntries();
    const existing = await getLatestUserModel();
    const existingContent = existing ? existing.content : null;

    const model = await generateUserModel(recentSessions, persistentEntries, existingContent);
    if (!model || model.length < 50) return null;

    // Demote previous models
    await clearPreviousUserModels();

    // Save new model
    await saveEntry({
      session_id: null,
      goal_id: null,
      domain: 'meta',
      entry_type: 'user_model',
      content: model,
      importance: 5,
      is_persistent: true,
      source: 'system',
      tags: ['user-model'],
    });

    return model;
  } catch (err) {
    console.error('[UserModel] Generation failed:', err.message);
    return null;
  }
}

async function detectPatterns(recentSessions, openActions, completedActions, entries) {
  const sessionSummaries = recentSessions
    .filter(s => s.summary)
    .map(s => `[${s.date}] ${s.summary}`)
    .join('\n');

  const actionHistory = [...openActions, ...completedActions]
    .map(a => `[${a.status}] ${a.description} ${a.due_date ? '(due: ' + a.due_date + ')' : ''} ${a.follow_up_count > 0 ? '[' + a.follow_up_count + 'x follow-up]' : ''}`)
    .join('\n');

  const prompt = `Analyse this user's recent behaviour for patterns. Look across sessions and actions, not just individual events.

Sessions (last 30 days):
${sessionSummaries}

Actions:
${actionHistory}

Look for:
- Commitment slippage patterns (do they consistently defer certain types of actions?)
- Energy/productivity patterns (any day-of-week or time patterns visible?)
- Avoidance patterns (what topics or actions keep getting dodged?)
- Over-planning vs under-executing
- Goals that are declared but behaviourally abandoned
- Positive patterns worth reinforcing

Return a JSON array of patterns found. Each item:
- "pattern": concise description
- "evidence": what data supports this
- "frequency": "one-off" | "recurring" | "persistent"
- "type": "positive" | "risk" | "avoidance" | "drift"
- "importance": 3-5

Only include patterns with real evidence. Do not speculate. If no clear patterns exist, return an empty array.

Return ONLY a valid JSON array.`;

  try {
    const result = await callEngine(prompt, 'You analyse behavioural patterns from session and action data. Output only valid JSON.');
    const match = result.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]);
  } catch {
    return [];
  }
}

async function runPatternDetection() {
  try {
    const recentSessions = await getRecentSessions(30);
    const openActions = await getOpenActions();
    const completedActions = await getCompletedActions();
    const entries = await getPersistentEntries();

    const patterns = await detectPatterns(recentSessions, openActions, completedActions, entries);

    let saved = 0;
    for (const p of patterns) {
      try {
        await saveEntry({
          session_id: null,
          goal_id: null,
          domain: 'meta',
          entry_type: 'pattern',
          content: `[${p.type}] ${p.pattern} — Evidence: ${p.evidence}`,
          importance: p.importance || 4,
          is_persistent: true,
          source: 'system',
          tags: ['pattern-detection', p.type, p.frequency],
        });
        saved++;
      } catch (err) {
        console.error('[Patterns] Failed to save pattern:', err.message);
      }
    }

    return { detected: patterns.length, saved };
  } catch (err) {
    console.error('[Patterns] Detection failed:', err.message);
    return { detected: 0, saved: 0 };
  }
}

async function runStalenessCheck() {
  try {
    const persistentEntries = await getPersistentEntries();
    if (persistentEntries.length === 0) return { checked: 0, demoted: 0 };

    const recentSessions = await getRecentSessions(7);
    const summaries = recentSessions
      .filter(s => s.summary)
      .slice(0, 5)
      .map(s => `[${s.date}] ${s.summary}`);

    if (summaries.length === 0) return { checked: persistentEntries.length, demoted: 0 };

    const prompt = `You are reviewing persistent memory entries for staleness. These entries are stored long-term and loaded into every session. Some may no longer be accurate based on recent activity.

PERSISTENT ENTRIES:
${JSON.stringify(persistentEntries.map(e => ({ id: e.id, content: e.content, entry_type: e.entry_type, date: e.date })), null, 2)}

RECENT SESSION SUMMARIES:
${summaries.join('\n\n')}

Are any of these persistent entries no longer accurate based on recent evidence? Examples of staleness:
- A behavioural pattern that has been resolved (e.g. "tends to avoid networking" but recent sessions show active networking)
- A constraint that no longer applies (e.g. "limited by budget" but finances have improved)
- A situation that has changed (e.g. "interviewing at Company X" but that process ended)
- A goal-related fact that is outdated (e.g. "targeting £60k salary" but target was revised)

Only flag entries where recent sessions provide clear evidence the entry is outdated. Do not flag entries just because they are old — age alone is not staleness. Do not flag entries that are still plausibly true.

Return ONLY a JSON array of entry IDs to demote. If none are stale, return an empty array [].`;

    const result = await callEngine(prompt, 'You identify stale persistent memory entries. Output only a valid JSON array of entry IDs.');
    const match = result.match(/\[[\s\S]*?\]/);
    if (!match) return { checked: persistentEntries.length, demoted: 0 };

    const idsToDemote = JSON.parse(match[0]);
    if (!Array.isArray(idsToDemote) || idsToDemote.length === 0) {
      return { checked: persistentEntries.length, demoted: 0 };
    }

    // Validate IDs against actual persistent entries
    const validIds = new Set(persistentEntries.map(e => e.id));
    let demoted = 0;
    for (const id of idsToDemote) {
      if (!validIds.has(id)) continue;
      try {
        await updateEntry(id, { importance: 1, is_persistent: false });
        demoted++;
      } catch (err) {
        console.error(`[Staleness] Failed to demote entry ${id}:`, err.message);
      }
    }

    if (demoted > 0) {
      console.log(`[Staleness] Demoted ${demoted} stale persistent entries`);
    }

    return { checked: persistentEntries.length, demoted };
  } catch (err) {
    console.error('[Staleness] Check failed:', err.message);
    return { checked: 0, demoted: 0 };
  }
}

module.exports = { processSession, generateUserModel, runUserModelGeneration, detectPatterns, runPatternDetection, runStalenessCheck };
