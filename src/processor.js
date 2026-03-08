const { updateSession, saveEntry, saveAction, saveOverride, getOpenActions, getActiveGoals } = require('./db');
const { callEngine } = require('./orchestrator');

const EXTRACTION_RUBRIC = `Rules for extraction:
- Be concise. Short, factual descriptions over verbose explanations.
- Preserve uncertainty. If something was tentative, mark it as such.
- Do not overstate confidence or importance.
- Only extract items worth remembering — not every sentence is an entry.`;

async function processSession(sessionId, conversationHistory, durationMinutes) {
  if (conversationHistory.length < 4) {
    // Fewer than 2 exchanges (user + atlas = 2 messages per exchange)
    await updateSession(sessionId, { duration_minutes: durationMinutes });
    return { entries: 0, actions: 0 };
  }

  const transcript = conversationHistory.map((m) => `${m.role}: ${m.content}`).join('\n\n');
  const goals = await getActiveGoals();
  const goalIds = goals.map((g) => `${g.id}: ${g.title}`).join(', ');

  // Run summary, entry extraction, and action extraction in parallel
  const [summary, rawEntries, rawActions] = await Promise.all([
    extractSummary(transcript),
    extractEntries(transcript, goalIds),
    extractActions(transcript, goalIds),
  ]);

  // Save session summary
  await updateSession(sessionId, {
    summary,
    duration_minutes: durationMinutes,
  });

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

  return { entries: entryCount, actions: actionCount };
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

module.exports = { processSession };
