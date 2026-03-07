# CLAUDE.md — Project Atlas

## What This Project Is

Project Atlas is a strategic adviser application with both terminal and desktop (Electron) interfaces. See `docs/PROJECT_ATLAS_v5.md` for the full vision document.

**Phases 1–5 are complete.** Foundation, memory layer, dynamic retrieval, Electron UI, and enhancement layer are all built.

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
│   ├── files.js                 # File ingestion (txt, md, pdf, csv, json)
│   ├── db.js                    # Supabase client and queries
│   ├── orchestrator.js          # System prompt builder, engine management, AI calls
│   ├── setup.js                 # Google OAuth setup flow
│   ├── engines/
│   │   ├── base.js              # Base engine interface
│   │   └── claude.js            # Claude CLI engine adapter
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
- **AI:** Claude Code CLI via engine abstraction layer (`src/engines/`)
- **Integrations:** Google Calendar, Gmail (optional, OAuth setup via terminal)
- **File parsing:** pdf-parse, papaparse (PDF, CSV support)

---

## Architecture Notes

- **Engine abstraction:** `src/engines/base.js` defines the interface; `claude.js` implements it. `orchestrator.js` uses `getEngine()` to route all AI calls through the active engine. Supports `send()` and `sendStreaming()`.
- **IPC flow:** `electron/main.js` handles all IPC between renderer and Node.js backend
- **AI calls:** `src/orchestrator.js` manages system prompt assembly with deterministic trimming (6000 token ceiling)
- **Context ranking:** Email > Calendar > Recent entries > Sessions > Persistent memory (by priority)
- **Source policies:** Per-goal `context_sources` field controls which data sources Atlas includes. Merged across active goals (included if ANY goal includes it).
- **Session windowing:** Chat history auto-trims at 40 messages, keeping first 2 + last 20 with a trim marker.
- **Markers:** Atlas can output `[SEARCH: query]`, `[RECALL: topic]`, `[EMAIL_SEARCH: query]` during chat — main.js intercepts and fulfills these
- **Goal interview:** Conversational flow via `interview:start` → `interview:send` → `interview:complete` IPC chain. Manual "Save Goal" button as fallback.
- **Context interview:** Conversational context file updates via `context:interview` IPC handler
- **Markdown rendering:** All Atlas output rendered as formatted HTML via `renderMarkdown()` in app.js
- **Toast system:** `showToast(message, type)` for non-blocking error/success/info notifications
- **PDF export:** Electron's `printToPDF` generates styled PDF from brief/reflection content
- **Override calibration:** Users can mark overrides as `user_right`, `atlas_right`, or `mixed` for decision tracking
- **Streaming responses:** `chat:sendStreaming` IPC pushes chunks via `webContents.send('chat:stream-chunk')` events. Renderer progressively renders markdown with a blinking cursor. Falls back to buffered `chat:send` if needed.
- **Voice input:** Push-to-talk mic button using Web Speech API (Chromium built-in). Local Whisper fallback via `src/voice.js` if a whisper-cli binary is placed in `config/models/`. Audio captured in renderer, transcribed text inserted into input box.
- **Diagnostics:** `getLastDiagnostics()` in orchestrator.js tracks context assembly stats including source policies

## How to Work on This Project

1. Read this file first.
2. Check `docs/` for build specs if you need historical context.
3. Reference `config/agents/*.md` for subagent perspectives.
4. Reference `config/user/*.md` for user context.
5. Reference `config/engine/methodology.md` for advisory methodology.
6. `electron/main.js` contains all IPC handlers bridging UI to backend.
7. `ui/js/app.js` is the main frontend logic.
8. All Atlas output surfaces must use `renderMarkdown()` — never `textContent` for Atlas responses.
9. New engines go in `src/engines/` and get registered in `orchestrator.js`.
