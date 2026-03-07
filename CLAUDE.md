# CLAUDE.md — Project Atlas

## What This Project Is

Project Atlas is a local-first Electron desktop application that serves as a strategic adviser. Read `ATLAS_SPEC.md` for the full vision document. That file is your reference for design philosophy, behavioural rules, memory architecture, and the complete product definition.

**Do not try to build the whole spec at once.** Atlas is built in phases. Each phase is independently valuable. Check the current build phase below and scope your work accordingly.

---

## Current Build Phase: Phase 1 — Foundation

See `PHASE_1_BUILD.md` for the detailed build instruction for this phase.

**Phase 1 scope — build ONLY these things:**
- Project folder structure and config files
- Goal-definition interview (text-based, conversational)
- Supabase (PostgreSQL) database with goals table
- Morning brief generation using Claude Code CLI with subagents
- Basic terminal interface for advisory sessions
- Text input/output (voice input deferred to later in Phase 1 or Phase 2)

**Phase 1 explicitly excludes:**
- Electron app (Phase 4)
- Full memory layer with entries/actions/overrides tables (Phase 2)
- Vector embeddings and semantic search (Phase 2)
- Post-session processing and persistence scoring (Phase 2)
- Gmail/Calendar API integration (Phase 3)
- Web search during sessions (Phase 3)
- Dual-AI deliberation (Phase 5)
- Any UI beyond terminal output

---

## Project Structure

```
project-atlas/
├── CLAUDE.md                    # This file — you read it automatically
├── ATLAS_SPEC.md                # Full vision document (reference only)
├── PHASE_1_BUILD.md             # Current phase build instructions
├── config/
│   ├── agents/                  # Subagent spec files
│   │   ├── job-search.md
│   │   ├── financial.md
│   │   ├── day-planner.md
│   │   ├── learning.md
│   │   └── meta-analyst.md
│   ├── engine/
│   │   └── methodology.md       # Advisory methodology (placeholder, parallel workstream)
│   └── user/
│       ├── IDENTITY.md          # User's stable identity context
│       ├── SITUATION.md         # User's current situation
│       └── PREFERENCES.md       # User's advisory preferences
├── src/
│   ├── interview.js             # Goal-definition interview logic
│   ├── brief.js                 # Morning brief generation
│   ├── session.js               # Advisory session manager
│   ├── db.js                    # Supabase client setup and queries
│   └── orchestrator.js          # Subagent orchestration (hidden layer)
├── .env                         # Supabase URL and anon key (not committed)
└── package.json
```

---

## Key Design Principles (Always Follow These)

1. **One visible entity.** The user talks to Atlas. Subagents are invisible. Never expose agent names, orchestration details, or multi-model internals to the user.

2. **Direct over exploratory.** Default to giving a clear recommendation with reasoning. Don't ask "what do you think?" when you have enough data to advise. See ATLAS_SPEC.md Section 6.1, Rule 3.

3. **Specific over generic.** Never give advice that could apply to anyone. Ground everything in the user's actual data, goals, and situation. See ATLAS_SPEC.md Section 6.1, Rule 4.

4. **Goal protection by default.** Protect declared goals. Push back on drift. But revise when genuine evidence warrants it. See ATLAS_SPEC.md Section 6.2.

5. **Concise.** No walls of text. Briefs scannable in under 3 minutes. Responses conversational and practical.

6. **Cross-goal awareness.** Never isolate goals into separate contexts. The best advice comes from seeing connections between goals.

---

## Tech Stack (Phase 1)

- **Runtime:** Node.js
- **Database:** Supabase (hosted PostgreSQL) via `@supabase/supabase-js`
- **AI:** Claude Code CLI (spawned as child process)
- **Interface:** Terminal (text in, text out)
- **Voice:** Deferred (Web Speech API or Whisper local, added later in Phase 1 or Phase 2)

---

## How to Work on This Project

1. Read this file first (you're doing that now).
2. Read `PHASE_1_BUILD.md` for your current build instructions.
3. Reference `ATLAS_SPEC.md` when you need design context, behavioural rules, or architecture details.
4. Reference `config/agents/*.md` when implementing subagent orchestration.
5. Reference `config/user/*.md` when you need the user's context for generating briefs or advice.
6. Stay within Phase 1 scope. If you think something from a later phase is needed, flag it — don't build it.
