# CLAUDE.md - Project Atlas

## What This Project Is

Project Atlas is a strategic adviser application with:
- a terminal interface in `src/`
- an Electron desktop app in `electron/` + `ui/`

The desktop app is the main product surface. The terminal flow still exists and is useful for debugging and fallback.

## Source Of Truth

Use these in this order:
1. The codebase itself
2. This file
3. `README.md` for GitHub-facing setup and run instructions
4. `docs/SETUP.md` for detailed local setup, Supabase schema, Google, Whisper, and packaging
5. `docs/PROJECT_ATLAS_v5.md` for product vision only

Do not treat `docs/archive/` as current implementation guidance. Those files are historical planning documents and are kept only for context.

## Current Reality

- Database: Supabase / hosted Postgres via `@supabase/supabase-js`
- Runtime: Node.js
- Desktop shell: Electron
- Renderer: vanilla HTML/CSS/JS
- AI engine layer: adapter-based with `claude` and `codex` CLI engines
- Model usage: one active engine at a time, not collaborative multi-model reasoning
- Pinned engine defaults:
  - `claude` -> `claude-opus-4-6`
  - `codex` -> `gpt-5.4`
- Engine swap contract: changing the active engine must not change Atlas behaviour, features, tools, memory handling, or UX. Only the underlying CLI/model changes.
- Voice: local Whisper path is present; no fallback is required

## Project Structure

```text
atlas/
|- CLAUDE.md
|- docs/
|  |- PROJECT_ATLAS_v5.md
|  `- archive/                  # Historical phase docs, not current truth
|- config/
|  |- agents/
|  |- engine/
|  |  `- methodology.md
|  |- credentials/
|  |- models/
|  `- user/
|- electron/
|  |- main.js
|  `- preload.js
|- ui/
|  |- index.html
|  |- css/style.css
|  `- js/app.js
|- src/
|  |- brief.js
|  |- db.js
|  |- files.js
|  |- index.js
|  |- interview.js
|  |- orchestrator.js
|  |- processor.js
|  |- search.js
|  |- session.js
|  |- setup.js
|  |- voice.js
|  |- engines/
|  `- integrations/
`- package.json
```

## Running

- Terminal: `npm start`
- Desktop app: `npm run app`

## Key Design Principles

1. One visible entity: Atlas
2. Direct, specific, non-therapeutic advice
3. Goal protection by default
4. Cross-goal awareness
5. Memory-backed continuity across sessions
6. User-maintained stable context plus auto-captured session memory

## Architecture Notes

- `src/orchestrator.js` is the core prompt/context assembly layer
- `src/db.js` is the data access layer for goals, sessions, entries, actions, overrides, files
- `src/processor.js` handles post-session summary, entry extraction, deduping, and action extraction
- `electron/main.js` is the backend bridge for the Electron app and owns the IPC surface
- `ui/js/app.js` is the main frontend application logic
- `config/user/*.md` are stable user-maintained context files
- `config/agents/*.md` are advisory perspective files
- `config/engine/methodology.md` is loaded as advisory methodology context

## AI Engine Notes

- Atlas exposes one adviser with one voice. The user talks to Atlas, not to Claude, Codex, or any provider.
- In chat, Atlas should identify itself as `Atlas` if asked what model or AI it is.
- Settings and diagnostics may show engine/provider information for debugging.
- The active engine is persisted in a runtime settings file under Electron app data and is available through the Settings screen.
- The current engine list, active engine, and pinned model are exposed through the settings IPC surface.
- Codex should inherit the user's existing CLI auth/config by default. Do not isolate `CODEX_HOME` unless explicitly configured with `CODEX_HOME` or `ATLAS_CODEX_HOME`.
- Engine adapters live in `src/engines/`. Keep Claude changes isolated from Codex changes unless the change is truly engine-agnostic.
- Model overrides are available via env vars:
  - `ATLAS_CLAUDE_MODEL`
  - `ATLAS_CODEX_MODEL`

## Prompt Contract

- Tone is calm, sharp, and precise. Directness is required; theatrical toughness is not.
- Atlas should separate known facts from inference when inference materially drives the recommendation.
- Atlas should use web search when current facts or numbers would strengthen the advice instead of guessing.
- Atlas should treat explicit build/test/setup sessions as exploratory, not as evidence of drift or missed commitments.
- Atlas should never reference internal systems, file names, perspectives, orchestration, phase plans, or implementation details in normal advisory chat.

## Recent Implementation State

- Streaming chat is wired through IPC chunk events. The intended product behaviour is streamed responses for both engines.
- The session start UX now shows immediate feedback instead of a blank wait.
- Context interview flows use real modals and event listeners rather than fragile inline handlers.
- Advisory Perspective settings use proper modals instead of `prompt()` / `confirm()`.
- Source diagnostics use `connected / available / in context` wording rather than `excluded`.
- Goal cards use clearer action hierarchy and status explanation copy.

## Important Constraints

- The code has evolved beyond the archived phase docs
- Product vision docs are useful, but they are not guaranteed to match implementation
- If code and docs disagree, trust the code
- Do not reintroduce multi-model collaborative assumptions unless explicitly requested
- Do not treat Whisper fallback as a requirement
- Do not introduce engine-specific product behaviour unless explicitly requested. If Claude and Codex differ in behaviour, treat that as an implementation gap to close.

## Working On This Project

1. Read this file first
2. Check `package.json` for actual entry points
3. Inspect `electron/main.js`, `ui/js/app.js`, and `src/orchestrator.js` before making architectural assumptions
4. Use `docs/PROJECT_ATLAS_v5.md` for intent and tone, not literal implementation status
5. Ignore `docs/archive/` unless historical context is specifically useful
