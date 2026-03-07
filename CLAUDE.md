# CLAUDE.md — Project Atlas

## What This Project Is

Project Atlas is a strategic adviser application with both terminal and desktop (Electron) interfaces. See `docs/PROJECT_ATLAS_v5.md` for the full vision document.

**Phases 1–4 are complete.** Foundation, memory layer, dynamic retrieval, and Electron UI are all built. UX corrections applied for conversation-first interaction model.

---

## Project Structure

```
atlas/
├── CLAUDE.md                    # This file
├── docs/                        # Build specs and planning documents (reference only)
├── config/
│   ├── agents/                  # Subagent spec files
│   ├── engine/
│   │   └── methodology.md       # Advisory methodology
│   ├── credentials/             # Google OAuth credentials (not committed)
│   └── user/
│       ├── IDENTITY.md          # User's stable identity context
│       ├── SITUATION.md         # User's current situation
│       └── PREFERENCES.md       # User's advisory preferences
├── electron/
│   ├── main.js                  # Electron main process + IPC handlers
│   └── preload.js               # Context bridge for renderer
├── ui/
│   ├── index.html               # Single-page app shell
│   ├── css/style.css            # UI styles
│   └── js/app.js                # Frontend application logic
├── src/
│   ├── index.js                 # Terminal entry point and menu
│   ├── interview.js             # Goal-definition interview
│   ├── brief.js                 # Morning brief generation
│   ├── session.js               # Advisory session manager (terminal)
│   ├── processor.js             # Post-session processing
│   ├── search.js                # Web search wrapper
│   ├── files.js                 # File ingestion
│   ├── db.js                    # Supabase client and queries
│   ├── orchestrator.js          # System prompt builder and AI engine
│   ├── setup.js                 # Google OAuth setup flow
│   └── integrations/
│       ├── calendar.js          # Google Calendar integration
│       └── gmail.js             # Gmail integration (6-layer pipeline)
├── .env                         # Supabase URL, anon key, AI_ENGINE (not committed)
└── package.json
```

---

## Running

- **Terminal:** `npm start` — original terminal interface
- **Desktop app:** `npm run app` — Electron UI

---

## Key Design Principles

1. **One visible entity.** The user talks to Atlas. Subagents are invisible.
2. **Conversation-first.** Goal creation, editing, and context updates happen through natural conversation, not forms.
3. **Direct over exploratory.** Default to a clear recommendation with reasoning.
4. **Specific over generic.** Ground everything in the user's actual data and goals.
5. **Goal protection by default.** Protect declared goals. Push back on drift.
6. **Concise.** No walls of text. Briefs scannable in under 3 minutes.
7. **Cross-goal awareness.** See connections between goals.

---

## Tech Stack

- **Runtime:** Node.js
- **Desktop:** Electron
- **Database:** Supabase (hosted PostgreSQL) via `@supabase/supabase-js`
- **AI:** Claude Code CLI (spawned as child process with `--tools ''` to prevent project context leaking)
- **Integrations:** Google Calendar, Gmail (optional, OAuth setup via terminal)

---

## Architecture Notes

- **IPC flow:** `electron/main.js` handles all IPC between renderer and Node.js backend
- **AI calls:** `src/orchestrator.js` spawns Claude CLI as child process. System prompt assembled with deterministic trimming (6000 token ceiling)
- **Context ranking:** Email > Calendar > Recent entries > Sessions > Persistent memory (by priority)
- **Markers:** Atlas can output `[SEARCH: query]`, `[RECALL: topic]`, `[EMAIL_SEARCH: query]` during chat — main.js intercepts and fulfills these
- **Goal interview:** Conversational flow via `interview:start` → `interview:send` → `interview:complete` IPC chain
- **Context interview:** Conversational context file updates via `context:interview` IPC handler
- **Markdown rendering:** All Atlas output rendered as formatted HTML via `renderMarkdown()` in app.js
- **Diagnostics:** `getLastDiagnostics()` in orchestrator.js tracks context assembly stats

## How to Work on This Project

1. Read this file first.
2. Check `docs/` for build specs if you need historical context.
3. Reference `config/agents/*.md` for subagent perspectives.
4. Reference `config/user/*.md` for user context.
5. Reference `config/engine/methodology.md` for advisory methodology.
6. `electron/main.js` contains all IPC handlers bridging UI to backend.
7. `ui/js/app.js` is the main frontend logic.
8. All Atlas output surfaces must use `renderMarkdown()` — never `textContent` for Atlas responses.
