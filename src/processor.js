const { updateSession, saveEntry, saveAction, saveOverride, getOpenActions, getActiveGoals, getCompletedActions, getRecentSessions, getPersistentEntries, saveDecision, getLatestUserModel, clearPreviousUserModels } = require('./db');
const { callEngine } = require('./orchestrator');

const EXTRACTION_RUBRIC = `Rules for extraction:
- Be concise. Short, factual descriptions over verbose explanations.
- Preserve uncertainty. If something was tentative, mark it as such.
- Do not overstate confidence or importance.
- Only extract items worth remembering — not every sentence is an entry.`;

async function processSession(sessionId, conversationHistory, durationMinutes, onProgress) {
  if (conversationHistory.length < 4) {
    // Fewer than 2 exchanges (user + atlas = 2 messages per exchange)
    await updateSession(sessionId, { duration_minutes: durationMinutes });
    return { entries: 0, actions: 0 };
  }

  const transcript = conversationHistory.map((m) => `${m.role}: ${m.content}`).join('\n\n');
  const goals = await getActiveGoals();
  const goalIds = goals.map((g) => `${g.id}: ${g.title}`).join(', ');

  if (onProgress) onProgress('Summarising conversation and extracting insights...');

  // Run summary, entry extraction, action extraction, and decision extraction in parallel
  const [summary, rawEntries, rawActions, rawDecisions] = await Promise.all([
    extractSummary(transcript),
    extractEntries(transcript, goalIds),
    extractActions(transcript, goalIds),
    extractDecisions(transcript, goalIds),
  ]);

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
  if (rawEntries.length + rawActions.length <= 5) {
    entries = rawEntries;
    actions = rawActions;
    overrides = rawEntries.filter((entry) => entry.entry_type === 'override');
  } else {
    ({ entries, actions, overrides } = await deduplicateExtractions(rawEntries, rawActions));
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

  return { entries: entryCount, actions: actionCount, decisions: decisionCount };
}

async function extractSummary(transcript) {
  const prompt = `Summarise this advisory session in 3-5 sentences. Capture: what was discussed, what was decided, what commitments were made, and any notable patterns or insights. Be concise and factual.

${EXTRACTION_RUBRIC}

${transcript}`;

  try {
    return await callEngine(prompt, 'You are a session summariser. Output only the summary text, nothing else.');
  } catch {
    return 'Summary generation failed.';
  }
}

async function extractEntries(transcript, goalIds) {
  const prompt = `Review this conversation and extract the important items as a JSON array. Each item should have:
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

Return ONLY a valid JSON array. No markdown, no explanation.

${transcript}`;

  try {
    const result = await callEngine(prompt, 'You extract structured memory entries from conversations. Output only valid JSON arrays.');
    const match = result.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]);
  } catch {
    return [];
  }
}

async function extractActions(transcript, goalIds) {
  const prompt = `Review this conversation and extract any commitments or action items the user made or agreed to. Return a JSON array where each item has:
- "description": what needs to be done
- "goal_id": relevant goal ID from [${goalIds}], or null
- "due_date": YYYY-MM-DD if mentioned or inferable, otherwise null

Only include concrete, actionable commitments. Not vague intentions.

${EXTRACTION_RUBRIC}

Return ONLY a valid JSON array.

${transcript}`;

  try {
    const result = await callEngine(prompt, 'You extract action items from conversations. Output only valid JSON arrays.');
    const match = result.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]);
  } catch {
    return [];
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

async function extractDecisions(transcript, goalIds) {
  const prompt = `Review this conversation and extract any significant decisions that were made or confirmed. A decision is different from an action — it is a choice between alternatives that affects strategy.

For each decision, return a JSON array with:
- "description": what was decided
- "alternatives": what other options were considered (or "none discussed")
- "expected_outcome": what the user/Atlas expects to happen as a result
- "atlas_confidence": "high", "medium", or "low"
- "goal_id": relevant goal ID from [${goalIds}], or null
- "follow_up_date": YYYY-MM-DD — when to check how this decision played out (typically 1-4 weeks)

Only extract genuine decisions, not routine actions. "Applied to 3 jobs" is an action. "Decided to focus on React roles over full-stack" is a decision.

${EXTRACTION_RUBRIC}

Return ONLY a valid JSON array.

${transcript}`;

  try {
    const result = await callEngine(prompt, 'You extract strategic decisions from conversations. Output only valid JSON arrays.');
    const match = result.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]);
  } catch {
    return [];
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

module.exports = { processSession, extractDecisions, generateUserModel, runUserModelGeneration, detectPatterns, runPatternDetection };
