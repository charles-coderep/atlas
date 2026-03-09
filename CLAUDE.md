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

- `src/orchestrator.js` is the core prompt/context assembly layer. Loads daily digests (not raw sessions) into the system prompt for token efficiency.
- `src/db.js` is the data access layer for goals, sessions, entries, actions, overrides, files, daily digests
- `src/processor.js` handles the full post-session pipeline: extraction → intra-session dedup → cross-session dedup → save → daily digest generation. Also runs periodic background tasks (staleness checks).
- `electron/main.js` is the backend bridge for the Electron app, owns the IPC surface, and handles emergency session save on quit via `before-quit` handler
- `ui/js/app.js` is the main frontend application logic (vanilla JS — a React migration exists on the `react-migration` branch but is not production-ready)
- `src/integrations/gmail.js` is a 6-layer email pipeline: triage → goal-aware ranking → deep read → thread expansion → summarisation → prompt injection. Ranking is goal-derived (no hardcoded keywords).
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
- The session start UX now shows immediate feedback instead of a blank wait. Typing indicator uses glowing dots with rotating status text.
- Context interview flows use real modals and event listeners rather than fragile inline handlers.
- Advisory Perspective settings use proper modals instead of `prompt()` / `confirm()`.
- Source diagnostics use `connected / available / in context` wording rather than `excluded`.
- Goal cards use clearer action hierarchy and status explanation copy.
- Session processing threshold is 2 messages (not 4) — even a single exchange is worth processing.
- Emergency session save on app close via `before-quit` handler with 30-second timeout and fallback.
- Email fetch failures surface as toast warnings in the UI and as context in the system prompt opener.
- Email ranking is fully goal-derived — no hardcoded keyword lists. STATUS_CHANGE_KEYWORDS remain for universal urgency signals.
- Daily digest system compresses all sessions from a day into one entry. The system prompt loads digests (max 7) instead of individual session summaries (could be 30+).
- Cross-session dedup prevents saving entries that duplicate information already in the database.
- Staleness check runs every 5 sessions to demote persistent entries that are no longer accurate.
- Markdown rendering supports tables (pipe syntax → HTML tables).

## Important Constraints

- The code has evolved beyond the archived phase docs
- Product vision docs are useful, but they are not guaranteed to match implementation
- If code and docs disagree, trust the code
- Do not reintroduce multi-model collaborative assumptions unless explicitly requested
- Do not treat Whisper fallback as a requirement
- Do not introduce engine-specific product behaviour unless explicitly requested. If Claude and Codex differ in behaviour, treat that as an implementation gap to close.

## Prompt & Instruction Governance

Atlas's advisory quality is a direct function of prompt clarity. Every file, prompt string, and markdown document that gives the AI direction has a direct impact on the end user. Treat these surfaces with the same discipline as production code.

### Before editing any AI-facing instruction:

1. **Search first.** Run `grep -rn "keyword" electron/ src/ config/` to find every place the topic is already addressed. If the rule exists — even in different words — do not add it again.
2. **Edit, don't append.** If something contradicts, rewrite it in place. If something is incomplete, amend where it logically belongs. Never blindly append to the bottom of a file or prompt string.
3. **Read the whole file first.** Understand the structure, flow, and what has already been said before changing any part of it.
4. **Re-read after editing.** Verify nothing now clashes or repeats.
5. **One rule, one location.** If a rule needs to exist, it lives in exactly one place. Other files reference or defer to it — they do not restate it.

### Prompt hierarchy — single source of truth:

| Concern | Authority | Other files should... |
|---|---|---|
| Atlas personality & core behaviour | `buildSystemPrompt()` in `orchestrator.js` | ...not restate personality rules |
| Advisory methodology | `config/engine/methodology.md` | ...not duplicate methodology guidance |
| Tone/style | `config/tone/*.md` | ...not include tone instructions |
| Goal interview behaviour | `buildGoalInterviewPrompt()` in `main.js` | ...not have separate interview rules |
| Context file editing | `buildContextInterviewPrompt()` in `main.js` | ...not have separate context rules |
| Perspective specs | `config/agents/*.md` | ...not describe perspectives elsewhere |
| Output format markers | The specific handler that needs them | ...not leak format markers into personality prompts |

### What counts as an AI-facing instruction:

- System prompt strings in JS (orchestrator, main.js handlers)
- Markdown files loaded into prompts (methodology, tone, agent specs)
- contextFileGuidance objects
- Task-specific prompts (extraction, search, brief generation)
- Any string that will be read by the AI engine as part of its instructions

### Red flags that indicate a governance violation:

- The same rule appears in two files in different words
- A new rule is appended to the bottom of a long prompt without checking what's above it
- A task-specific prompt restates Atlas's identity from scratch
- A tone instruction appears outside of `config/tone/*.md`
- Format/protocol markers (GOAL_READY, CONTEXT_READY) appear in personality sections

## Working On This Project

1. Read this file first
2. Check `package.json` for actual entry points
3. Inspect `electron/main.js`, `ui/js/app.js`, and `src/orchestrator.js` before making architectural assumptions
4. Use `docs/PROJECT_ATLAS_v5.md` for intent and tone, not literal implementation status
5. Ignore `docs/archive/` unless historical context is specifically useful
