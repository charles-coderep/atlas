# Phase 2 Build Instructions — Memory Layer

Read `PROJECT_ATLAS_v5.md` Sections 7 and 8 for the full memory architecture and database schema. Read `CLAUDE.md` for project principles. This document tells you exactly what to build for Phase 2.

**Do not start Phase 2 until all Phase 1 fixes are verified working.**

---

## Objective

Give Atlas memory that persists across sessions. When Phase 2 is done, Atlas remembers what happened in previous sessions, tracks commitments and follows up on them, extracts insights and decisions automatically, and loads relevant history into every new session.

**When this phase is done:**
1. Every session is summarised and stored automatically when it ends
2. Decisions, commitments, insights, and patterns are extracted as tagged entries
3. Each entry is scored for long-term importance (1-5)
4. Open action items are tracked with due dates and follow-up counts
5. Morning briefs include recent session history, open actions, and persistent insights
6. Atlas references past sessions naturally in conversation
7. Overrides (when the user disagrees with Atlas) are logged

---

## Step 1: Database Tables

Create these tables in Supabase SQL Editor. These match the spec's schema (Section 8) adapted for PostgreSQL/Supabase.

```sql
-- Sessions
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    brief JSONB,
    summary TEXT,
    duration_minutes INTEGER,
    mode TEXT CHECK(mode IN ('brief', 'advisory', 'review', 'mixed')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Entries (the core memory units)
CREATE TABLE entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES sessions(id),
    goal_id TEXT REFERENCES goals(id),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    domain TEXT NOT NULL CHECK(domain IN ('career', 'finances', 'learning', 'health', 'business', 'personal', 'meta')),
    entry_type TEXT NOT NULL CHECK(entry_type IN ('insight', 'decision', 'commitment', 'pattern', 'alert', 'data_point', 'breakthrough', 'override')),
    content TEXT NOT NULL,
    importance INTEGER CHECK(importance BETWEEN 1 AND 5),
    is_persistent BOOLEAN DEFAULT FALSE,
    source TEXT DEFAULT 'session' CHECK(source IN ('session', 'email', 'calendar', 'file', 'web', 'voice')),
    tags JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Actions (commitments and follow-ups)
CREATE TABLE actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID REFERENCES entries(id),
    goal_id TEXT REFERENCES goals(id),
    description TEXT NOT NULL,
    due_date DATE,
    status TEXT DEFAULT 'open' CHECK(status IN ('open', 'completed', 'deferred', 'dropped')),
    follow_up_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Overrides (when user disagrees with Atlas)
CREATE TABLE overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES sessions(id),
    goal_id TEXT REFERENCES goals(id),
    atlas_recommendation TEXT NOT NULL,
    user_decision TEXT NOT NULL,
    user_reasoning TEXT,
    outcome TEXT,
    outcome_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger for actions completed_at
CREATE OR REPLACE FUNCTION set_completed_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        NEW.completed_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER actions_completed_at
    BEFORE UPDATE ON actions
    FOR EACH ROW
    EXECUTE FUNCTION set_completed_at();

-- RLS policies (same open policy as goals — single-user app)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON actions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON overrides FOR ALL USING (true) WITH CHECK (true);
```

**Provide this SQL to the user to run in Supabase.** Do not attempt to create tables from code.

---

## Step 2: Database Functions in `src/db.js`

Add CRUD functions for the new tables. All async, all using the existing Supabase client pattern.

**Sessions:**
- `createSession(mode)` — insert a new session, return the session record with ID
- `updateSession(id, { summary, duration_minutes, brief })` — update after session ends
- `getRecentSessions(days = 7)` — return sessions from the last N days, ordered by date descending

**Entries:**
- `saveEntry(entry)` — insert an entry (session_id, goal_id, domain, entry_type, content, importance, is_persistent, source, tags)
- `getRecentEntries(days = 7)` — entries from the last N days
- `getPersistentEntries()` — all entries where is_persistent = true
- `getEntriesByGoal(goalId, days = 7)` — entries for a specific goal, recent window
- `getEntriesByType(entryType)` — all entries of a given type (e.g. all 'commitment' entries)

**Actions:**
- `saveAction(action)` — insert an action item
- `getOpenActions()` — all actions with status 'open', ordered by due_date
- `updateAction(id, updates)` — update status, follow_up_count, etc.
- `getOverdueActions()` — open actions where due_date < today

**Overrides:**
- `saveOverride(override)` — insert an override record
- `getUnresolvedOverrides()` — overrides where outcome is null

---

## Step 3: Post-Session Processor — `src/processor.js`

This is a new file. It runs after every advisory session ends and does three things: summarise, extract, and score.

### 3a: Session Summary

Take the full conversation history and generate a concise summary via Claude. The summary should capture: what was discussed, what was decided, what commitments were made, and any notable patterns or insights.

Prompt Claude with the conversation history and ask for a summary in 3-5 sentences. Save it to the session record via `updateSession()`.

### 3b: Entry Extraction

Send the conversation history to Claude and ask it to extract structured entries. Each entry should have: domain, entry_type, content, importance (1-5), suggested tags, and associated goal_id if relevant.

Prompt structure:

```
Review this conversation and extract the important items as a JSON array. Each item should have:
- "domain": one of career, finances, learning, health, business, personal, meta
- "entry_type": one of insight, decision, commitment, pattern, alert, data_point, breakthrough, override
- "content": a concise description of the item
- "importance": 1-5 (see scoring guide below)
- "goal_id": the relevant goal ID, or null if global
- "tags": array of relevant tags

Importance scoring:
5 = Critical: strategic decisions, major pivots, crisis points
4 = Significant: reusable insights, standing commitments, pattern identifications
3 = Notable: useful context, interview feedback, specific events
2 = Routine: daily activity updates, calendar notes
1 = Ephemeral: passing remarks, transient observations

Only extract items that are worth remembering. Not every sentence is an entry. Focus on decisions, commitments, insights, and patterns.

Return ONLY a valid JSON array. No markdown, no explanation.
```

Parse the response. For each entry with importance >= 4, set `is_persistent = true`. Save all entries via `saveEntry()`.

### 3c: Action Extraction

From the same conversation, extract any commitments that need follow-up. These become action items.

```
Review this conversation and extract any commitments or action items the user made or agreed to. Return a JSON array where each item has:
- "description": what needs to be done
- "goal_id": relevant goal ID or null
- "due_date": YYYY-MM-DD if mentioned or inferable, otherwise null

Only include concrete, actionable commitments. Not vague intentions.

Return ONLY a valid JSON array.
```

Save each via `saveAction()`.

### 3d: Integration with Session Flow

At the end of `src/session.js`, when the user types `/quit` or `/exit`:
1. Calculate session duration (track start time when session begins)
2. Call the processor with the conversation history
3. Display a brief summary: "Session logged. X entries extracted, Y action items tracked."
4. Return to menu

---

## Step 4: Pre-Session Context Loading

Update `src/orchestrator.js` to load memory context before each session.

The `buildSystemPrompt()` function currently loads goals and user context files. Expand it to also load:

1. **Recent session summaries** — last 7 days via `getRecentSessions(7)`. Include date and summary for each.
2. **Open action items** — via `getOpenActions()`. Include description, due date, follow-up count, and associated goal.
3. **Persistent entries** — via `getPersistentEntries()`. These are the high-importance items that persist beyond the 7-day window.
4. **Recent entries** — via `getRecentEntries(7)`. The notable items from the last week.
5. **Overdue actions** — via `getOverdueActions()`. Flag these prominently.

Add these as new sections in the system prompt:

```
## Recent Session History
[Last 7 days of session summaries]

## Open Action Items
[List with due dates and follow-up counts]
⚠️ OVERDUE: [Any overdue items flagged here]

## Persistent Memory
[High-importance entries that persist indefinitely]

## Recent Context
[Notable entries from the last 7 days]
```

**Important:** This makes the system prompt longer. Be mindful of context window. If the prompt exceeds ~8000 tokens, prioritise: goals > overdue actions > open actions > persistent entries > recent summaries > recent entries. Trim recent entries first if needed.

---

## Step 5: Enhanced Morning Brief

Update `src/brief.js` to use the expanded context.

The brief prompt should now reference actual data:

```
Generate today's morning brief. Today is ${today}.

You have access to:
- ${goals.length} active goal(s)
- ${openActions.length} open action items (${overdueActions.length} overdue)
- Session history from the last 7 days
- Persistent insights and patterns

Produce a strategic brief:

1. **Top 3 Priorities Today** — derived from active goals AND open action items. Reference specific actions by name.
2. **Open Commitments** — status of action items, especially overdue ones. Be specific: "You committed to X on [date], it's now overdue."
3. **Risks or Concerns** — patterns from recent sessions, overdue items, goal drift.
4. **Recommended Focus** — clear directive on where to spend time and energy today.

Keep it scannable. Under 3 minutes to read. Reference specific past events and commitments, not generic advice.
```

---

## Step 6: Session Commands

Add new commands to the session loop in `src/session.js`:

- `/actions` — display open action items with status and due dates
- `/complete <description or partial match>` — mark an action as completed
- `/history` — show recent session summaries (last 7 days)

These give the user visibility into what Atlas is tracking without leaving the session.

---

## Step 7: Follow-Up Logic

This implements the spec's Rule 7 (Track, Follow Up, and Escalate).

At the start of every advisory session (not just the brief), after loading context, check for items that need follow-up:

1. **Overdue actions** — if any exist, Atlas should mention them early in the session. Not as a guilt trip, as a status check: "You had [action] due on [date]. Did that happen, or should we reschedule?"
2. **High follow-up count actions** — if an action has been followed up on 2+ times with no progress, Atlas should diagnose the obstacle (per Rule 7 in the spec).
3. **Increment follow-up count** — each time Atlas mentions an open action in a session, increment its `follow_up_count` via `updateAction()`.

Implementation: after building the system prompt but before starting the conversation loop, generate a "session opening" message from Atlas if there are overdue or high-follow-up items. Display it automatically — the user doesn't need to ask for it.

---

## What "Done" Looks Like

Phase 2 is complete when:

- [ ] Sessions, entries, actions, and overrides tables exist in Supabase
- [ ] Every session is summarised automatically when it ends
- [ ] Entries are extracted with importance scores and persistence flags
- [ ] Action items are extracted and tracked with due dates
- [ ] Morning briefs reference actual session history and open actions
- [ ] The system prompt includes recent memory context (not just goals)
- [ ] Atlas follows up on overdue actions at the start of sessions
- [ ] `/actions`, `/complete`, and `/history` commands work in sessions
- [ ] Overrides are logged when the user disagrees with Atlas
- [ ] The app still returns to menu after sessions (Phase 1 Fix 6)

---

## What NOT to Build

- No vector embeddings or semantic search yet (Phase 2.5 or Phase 3)
- No Gmail or Calendar integration (Phase 3)
- No web search during sessions (Phase 3)
- No file upload or ingestion (Phase 3)
- No Electron app or GUI (Phase 4)
- No dual-AI deliberation (Phase 5)

The memory layer is the focus. Make it work reliably before adding more inputs.
