# Docs

This folder contains:

- `SETUP.md`: installation, Supabase schema, Google/Whisper setup, and GitHub workflow
- `PROJECT_ATLAS_v5.md`: product vision and behavioural intent
- `archive/`: historical phase/build planning docs
- `../CLAUDE.md`: current implementation and handoff guide

## Important

The files in `archive/` are outdated implementation plans. They are kept only for context and should not be treated as the current source of truth.

If documentation and code disagree:
1. trust the codebase
2. use `CLAUDE.md` for the current project guide
3. use `SETUP.md` for current installation and environment setup
4. use `PROJECT_ATLAS_v5.md` for product direction, voice, and intent

## Current Implementation Snapshot

- Storage is Supabase, not SQLite/local-first storage.
- The main product surface is the Electron app.
- Atlas supports two interchangeable CLI backends:
  - `claude` pinned to `claude-opus-4-6`
  - `codex` pinned to `gpt-5.4`
- One engine is active at a time.
- Engine choice should not change user-facing behaviour. Tool access, streaming, memory, and advisory flow are intended to work the same regardless of backend.
- Atlas should present one adviser voice only. In chat, it is `Atlas`, not a provider/model name.
- The methodology and prompt tone were recently tightened to stay direct without dramatic phrasing.
- Explicit test/build/setup sessions should be treated as exploratory, not as evidence of drift.

## For The Next Agent

- Read `CLAUDE.md` first.
- Treat `PROJECT_ATLAS_v5.md` as vision, not literal implementation status.
- Do not infer engine limitations from older docs. If Claude and Codex differ in behaviour, that is an implementation gap unless the user explicitly wants divergence.
