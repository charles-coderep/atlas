# Phase 1 Build Instructions — Foundation

## Objective

Build a working strategic advisory session via terminal. Single AI. Text-based. The user can define goals through a structured interview, and Atlas can generate a morning brief and conduct advisory conversations — all from the command line.

**When this phase is done, the user can:**
1. Run `npm start` and talk to Atlas in the terminal
2. Go through a goal-definition interview that produces a structured goal record
3. Receive a morning brief with today's priorities
4. Have an advisory conversation where Atlas gives specific, tactical advice
5. Have Atlas remember their goals across sessions (via Supabase)

---

## Step 1: Project Setup

Initialise the project with `npm init`. Install dependencies:

```bash
npm install @supabase/supabase-js dotenv readline
```

Create a `.env` file in the project root with your Supabase credentials:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

Add `.env` to `.gitignore`. Never commit credentials.

Create the folder structure defined in `CLAUDE.md`. Create all config files as empty or placeholder files so the structure exists from day one.

---

## Step 2: Database — Goals Table Only

For Phase 1, implement ONLY the goals table. The full schema (entries, actions, overrides, sessions) comes in Phase 2.

**Create this table in your Supabase dashboard (SQL Editor):**

```sql
CREATE TABLE goals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT,
    priority TEXT CHECK(priority IN ('primary', 'secondary', 'supporting')),
    goal_data JSONB NOT NULL,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER goals_updated_at
    BEFORE UPDATE ON goals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Enable Row Level Security (optional for single-user, but good practice)
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated and anon users (single-user app)
CREATE POLICY "Allow all operations" ON goals
    FOR ALL
    USING (true)
    WITH CHECK (true);
```

Note: `goal_data` is `JSONB` instead of `TEXT` — Supabase/PostgreSQL supports native JSON, so you get queryable structured data for free. No need to `JSON.parse()` on read.

Implement in `src/db.js`:
- `initDB()` — create Supabase client using env vars, verify connection
- `saveGoal(goal)` — upsert a goal record (insert or update on conflict)
- `getActiveGoals()` — return all goals with status 'active'
- `getGoal(id)` — return a single goal by ID
- `updateGoalStatus(id, status)` — change goal status

Example Supabase client setup:

```javascript
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

export async function saveGoal(goal) {
    const { data, error } = await supabase
        .from('goals')
        .upsert(goal, { onConflict: 'id' });
    if (error) throw error;
    return data;
}

export async function getActiveGoals() {
    const { data, error } = await supabase
        .from('goals')
        .select('*')
        .eq('status', 'active');
    if (error) throw error;
    return data;
}
```

All database calls are now async. Ensure `interview.js`, `brief.js`, `session.js`, and `index.js` use `await` when calling db functions.

---

## Step 3: User Context Files

Create the three user-editable markdown files in `config/user/`:

### `IDENTITY.md`
```markdown
# Identity

- **Name:** [User's name]
- **Location:** Glasgow, Scotland
- **Background:** [To be filled in during first session]
- **Communication style:** Direct, no fluff
```

### `SITUATION.md`
```markdown
# Current Situation

- **Employment:** [To be filled in]
- **Financial overview:** [To be filled in]
- **Living situation:** [To be filled in]
- **Key context:** [To be filled in]
```

### `PREFERENCES.md`
```markdown
# Preferences

- **Directness level:** High — challenge me, don't soften bad news
- **Working style:** [To be filled in]
- **Protected time blocks:** [To be filled in]
- **Brief detail level:** Concise — scannable in under 3 minutes
```

These are loaded into every session as global context. The user edits them manually for now (UI editing comes in Phase 4).

---

## Step 4: Subagent Spec Files

Create spec files in `config/agents/`. Each file defines the role, focus, and output format for one internal subagent. These are used by the orchestrator when generating briefs and advice.

### `config/agents/job-search.md`
```markdown
# Job Search Strategist

## Role
Analyse job listings, match against user's CV and skills, draft applications, track follow-ups, and advise on job search strategy.

## Focus Areas
- Application volume and velocity
- Skill-to-role matching
- Interview preparation
- Follow-up tracking
- Market intelligence (what employers are looking for)

## Output Format
Concise bullet points. Lead with the most actionable item. Flag risks or missed opportunities.
```

### `config/agents/financial.md`
```markdown
# Financial Analyst

## Role
Process verbal financial updates from the user, track spending trends, calculate runway, and flag financial risks.

## Focus Areas
- Financial runway (weeks/months of expenses covered)
- Spending patterns and anomalies
- Income sources and timing
- Financial constraints on other goals

## Output Format
Key numbers first, then implications. Always state runway in weeks. Flag any change that affects strategic decisions.
```

### `config/agents/day-planner.md`
```markdown
# Day Planner

## Role
Produce time-blocked daily schedules, respect protected time, prioritise tasks by leverage, and defer overflow intelligently.

## Focus Areas
- Today's top 3 priorities (aligned with active goals)
- Time allocation across goals
- Protected time enforcement
- Overflow and deferral recommendations

## Output Format
Time-blocked schedule with clear priorities. No more than 5 blocks. Flag any goal that's getting zero time today.
```

### `config/agents/learning.md`
```markdown
# Learning Strategist

## Role
Align study and skill development with active goals, identify skill gaps, recommend focus areas, and track learning progress.

## Focus Areas
- Skill gaps relative to goal requirements
- Learning priorities (what closes the biggest gap fastest)
- Course/resource recommendations
- Progress tracking

## Output Format
Current priority skill, recommended action, estimated time investment. Flag if learning is displacing higher-leverage activities.
```

### `config/agents/meta-analyst.md`
```markdown
# Meta-Analyst

## Role
Read all other subagent outputs, spot cross-domain patterns, identify leverage points and risks, and flag conflicts between goals.

## Focus Areas
- Cross-goal conflicts and synergies
- Resource allocation across goals
- Pattern detection (drift, avoidance, momentum)
- Strategic risks and opportunities

## Output Format
2-3 key observations that no single domain would surface. Focus on connections, conflicts, and leverage points.
```

---

## Step 5: Goal-Definition Interview

Implement in `src/interview.js`.

The interview is a conversational flow in the terminal. Atlas asks questions one at a time, waits for the user's response, and adapts follow-up questions based on answers.

**Required questions (ask all of these):**
1. What do you want to achieve?
2. Why does this matter right now?
3. What would success actually look like? (specific, measurable)
4. What's your target timeframe?
5. What's your current baseline?
6. What constraints must I respect?
7. What usually derails you here?
8. What kind of support do you want from me?
9. How direct should I be when I think you're drifting?

**Recommended questions (ask if relevant based on answers):**
- What must NOT happen? (anti-goals)
- What tradeoffs are you willing to accept?
- What have you tried before that didn't work?

**Goal Quality Gate:** Don't accept vague goals. If the user says something underspecified like "make more money" or "get fit," ask clarifying questions until the goal is sharp enough to produce a structured record with specific success criteria and a target date.

**Output:** A structured JSON goal record (see ATLAS_SPEC.md Section 3.3) saved to the database via `db.saveGoal()`.

**Implementation approach:** For Phase 1, implement this as a scripted conversation flow using Node.js `readline`. The questions are predefined. The user's answers are collected and assembled into the goal record. Atlas can use Claude Code CLI to refine the goal record from raw answers into a properly structured JSON object — this is a good use of the AI.

---

## Step 6: Morning Brief Generation

Implement in `src/brief.js`.

The morning brief assembles context and generates a short strategic overview. In Phase 1, "context" means:
- Active goals from the database
- User context files (IDENTITY.md, SITUATION.md, PREFERENCES.md)

**Brief structure:**
1. Top 3 priorities today (derived from active goals)
2. Open questions or decisions pending
3. Risks or concerns
4. Recommended focus for the day

**Implementation:** Load the context, construct a prompt, send it to Claude Code CLI, display the result.

The prompt should include:
- All active goal records (full JSON)
- Contents of the three user context files
- The subagent specs (so Claude can reason from each perspective)
- Instruction to produce a brief following the format above, scannable in under 3 minutes

---

## Step 7: Advisory Session

Implement in `src/session.js`.

This is the core conversation loop. The user types, Atlas responds. The session continues until the user exits.

**Session flow:**
1. Load context (same as brief: active goals, user files, subagent specs)
2. Optionally generate a morning brief first (if it's the start of the day)
3. Enter conversation loop:
   - User types a message
   - Message + full context sent to Claude Code CLI
   - Response displayed
   - Loop continues

**Context passed to Claude Code CLI on every message:**
- System prompt defining Atlas's personality and behavioural rules (derived from ATLAS_SPEC.md Sections 1, 2, and 6)
- Active goal records
- User context files
- Conversation history (this session only, kept in memory)

**System prompt for Atlas:** Write a concise system prompt that captures the core personality: direct strategic adviser, not a life coach, specific over generic, protects goals, challenges drift, exercises strategic free will. Reference the behavioural rules in Section 6 of the spec but distill them — don't dump the entire spec into the system prompt.

---

## Step 8: Orchestrator

Implement in `src/orchestrator.js`.

The orchestrator is the hidden layer that coordinates subagent reasoning. In Phase 1, this is simple: it constructs prompts that include the relevant subagent specs and asks Claude to reason from each perspective before synthesising.

**Phase 1 orchestration approach:**
- Single Claude Code CLI call per interaction
- The prompt includes all subagent specs as context
- Claude is instructed to consider each perspective internally and produce a single unified response
- The user never sees subagent names or knows multiple perspectives were considered

This is "poor man's orchestration" — one model, multiple perspectives via prompting. It works surprisingly well. True multi-call orchestration (spawning separate subagent calls and merging) comes later if needed.

---

## Step 9: Entry Point

Create `src/index.js` as the main entry point.

**Flow:**
1. Initialise database
2. Check if any active goals exist
   - If no goals: run the goal-definition interview first
   - If goals exist: proceed to session
3. Ask user: "Morning brief, or jump straight to a session?"
4. Run the appropriate flow
5. On exit: save any state needed (Phase 1: just ensure goals are saved; session summaries come in Phase 2)

---

## What "Done" Looks Like

Phase 1 is complete when:

- [ ] `npm start` launches Atlas in the terminal
- [ ] A new user goes through the goal-definition interview
- [ ] The interview produces a structured goal record saved to Supabase
- [ ] Atlas generates a morning brief based on active goals and user context
- [ ] The user can have a back-and-forth advisory conversation
- [ ] Atlas's responses are direct, specific, and grounded in the user's goal data
- [ ] Subagent perspectives are incorporated invisibly (single voice)
- [ ] Goals persist across sessions (restart the app, goals are still there)
- [ ] The folder structure and all config files exist

---

## What NOT to Build

Do not build any of these in Phase 1. They are listed here so you know the boundaries:

- No Electron app or GUI (Phase 4)
- No entries/actions/overrides database tables (Phase 2)
- No post-session summarisation or persistence scoring (Phase 2)
- No vector embeddings or semantic search (Phase 2)
- No email or calendar integration (Phase 3)
- No web search during sessions (Phase 3)
- No file upload handling (Phase 3)
- No voice input (added later, not core to Phase 1 proof of concept)
- No dual-AI deliberation (Phase 5)

Keep it tight. A working terminal advisory session with goal management is the deliverable.
