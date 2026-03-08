# Atlas

Atlas is a desktop strategic adviser. It runs as an Electron app with a local CLI AI backend, Supabase for persistence, optional Google Calendar/Gmail context, and optional local Whisper voice input.

## What Atlas Uses

- Electron desktop app for the main product surface
- Supabase/Postgres for goals, sessions, memory, actions, overrides, and files
- One active local AI CLI at a time:
  - Claude CLI pinned to `claude-opus-4-6`
  - Codex CLI pinned to `gpt-5.4`
- Optional Google Calendar + Gmail integration
- Optional local Whisper transcription via `whisper-cpp-node`

## Quick Start

1. Install dependencies:

```powershell
npm install
```

2. Copy the example environment file:

```powershell
Copy-Item .env.example .env
```

3. Fill in `.env` with your Supabase project values.

4. Run the Supabase SQL from [docs/SETUP.md](docs/SETUP.md).

5. Install and authenticate at least one supported AI CLI:
   - Claude CLI
   - Codex CLI

6. Launch the desktop app:

```powershell
npm run app
```

## Setup Guides

- Full local setup: [docs/SETUP.md](docs/SETUP.md)
- Current implementation notes: [CLAUDE.md](CLAUDE.md)
- Product vision: [docs/PROJECT_ATLAS_v5.md](docs/PROJECT_ATLAS_v5.md)

## Environment Variables

Atlas currently requires:

```env
AI_ENGINE=claude
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

Optional engine model overrides:

```env
ATLAS_CLAUDE_MODEL=claude-opus-4-6
ATLAS_CODEX_MODEL=gpt-5.4
```

## Run Modes

Desktop app:

```powershell
npm run app
```

Terminal interface:

```powershell
npm start
```

Goal interview only:

```powershell
npm run interview
```

Morning brief only:

```powershell
npm run brief
```

Windows build:

```powershell
npm run dist:win
```

## Notes

- The desktop app is the main surface.
- Engine choice should not change Atlas behaviour. It only swaps the underlying CLI/model.
- Voice buttons only appear when the Whisper package loads and the local model file exists.
- Google integration is optional. Atlas still works without it.

## GitHub Workflow

Typical update flow:

```powershell
git status
git add .
git commit -m "Describe the change"
git push origin master
```

Do not commit:
- `.env`
- anything under `config/credentials/`
- local generated `files/`
- packaged output under `dist/`

Those paths are already ignored by `.gitignore`.
