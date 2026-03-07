# Phase 4 UI Feature Map

Every terminal feature must have a UI equivalent in the Electron app. Nothing gets dropped. This document maps current functionality to UI surfaces.

Reference: PROJECT_ATLAS_v5.md Section 13.2 defines the main UI surfaces: Today, Talk to Atlas, Goals, Actions, Memory, Sessions, Files, Settings.

---

## Main Menu → Sidebar Navigation

The terminal menu (Morning brief / Advisory session / New goal / Exit) becomes persistent sidebar navigation. All screens accessible at any time without going "back to menu."

---

## Today Screen

Maps to: Morning brief (option 1 / `/brief`)

Must include:
- Full morning brief output
- Top 3 priorities (from brief generation)
- Active goals with status and priority at a glance
- Open actions count with overdue count highlighted
- Calendar events for today (if configured)
- Email highlights (scanned/read/expanded counts + summaries)
- Quick-launch button into advisory session

---

## Talk to Atlas Screen

Maps to: Advisory session (option 2)

Must include:
- Full conversation interface (text input, Atlas responses)
- Session opening with overdue/stalled action follow-ups (currently auto-generated at session start)
- Real-time search/recall/email-search indicators (currently `[Searching: ...]`, `[Recalling: ...]` console output)
- Inline action completion (replaces `/complete`)
- Session end with processing summary (entries extracted, actions tracked)
- All slash command functionality accessible through UI elements, not typed commands

---

## Goals Screen

Maps to: `/goals` command + goal interview (option 3)

Must include:
- All goals listed with status (active/paused/completed), priority, type
- Goal detail view showing the full structured goal record (all fields from the interview)
- Create new goal button (launches interview flow as a guided UI form, not terminal Q&A)
- Edit goal (modify any field)
- Change priority
- Change status (active/pause/complete)
- Goal history — when it was created, any revisions

---

## Actions Screen

Maps to: `/actions` and `/complete` commands

Must include:
- All open actions with description, due date, associated goal, follow-up count
- Overdue actions highlighted prominently
- Mark complete (single click, replaces `/complete`)
- Mark deferred or dropped
- Filter by goal
- Filter by status (open/completed/deferred/dropped)
- Sort by due date, follow-up count, goal

---

## Memory Screen

Maps to: `/context`, `/recall`, and `/history` commands

Must include:
- User context files viewer and editor (IDENTITY.md, SITUATION.md, PREFERENCES.md)
  - Clear ownership labels: "These are user-maintained files. Atlas reads them but does not edit them."
  - Edit in place with save button
  - Placeholder detection — highlight fields still showing `[To be filled in]`
- Persistent entries browser (auto-captured, high-importance items)
- Recent entries browser (last 7 days)
- Entry detail view (domain, type, content, importance, goal, tags, source)
- Search/filter entries by keyword, domain, type, goal, date range (replaces `/recall`)
- Memory source labels visible: user-maintained vs auto-captured vs AI-suggested
- Override history (from overrides table) with outcome tracking

---

## Sessions Screen

Maps to: `/history` command

Must include:
- List of past sessions with date, mode, duration, summary
- Session detail view showing full summary
- Entries extracted from each session
- Actions created from each session
- Session search/filter by date range

---

## Files Screen

Maps to: `/upload` and `/files` commands

Must include:
- List of all ingested files with filename, type, associated goal, upload date
- Upload button (file picker, replaces `/upload <filepath>`)
- Associate file with a goal on upload or after
- File preview (show content or summary)
- Delete file

---

## Email Screen

Maps to: `/emails` command + email context in sessions

Must include:
- Triage summary: how many scanned, how many deeply read, threads expanded
- Ranked email list with relevance scores visible
- Deeply-read emails with structured summaries
- Expanded thread viewer
- Manual email search (replaces `[EMAIL_SEARCH:]` marker)
- Configuration: adjust MAX_DEEP_READ, TRIAGE_WINDOW_HOURS, etc.
- Last fetched timestamp

---

## Calendar Screen (or panel within Today)

Maps to: calendar data in brief and session context

Must include:
- Today's events
- This week's events
- Imminent events highlighted
- Last fetched timestamp
- Refresh button

---

## Settings Screen

Maps to: `/context` (partial), setup flow, and config files

Must include:
- User context file editor (also accessible from Memory screen)
- Advisory preferences editor (directness level, brief detail level, protected time blocks)
- Google integration status (connected/not connected) with setup/reconnect flow
- AI engine selector (Claude / OpenAI, maps to AI_ENGINE env var)
- Email configuration (all the MAX_ constants from gmail.js, editable)
- Agent specs viewer (show which advisory perspectives are active)
- Methodology file viewer (show current methodology, read-only in UI)
- Context diagnostics panel:
  - What context sources were included in the last session
  - Approximate size/weight of each source
  - What got trimmed
  - How many emails were triaged vs deeply read
  - Current conversation context size estimate

---

## Features That Are Currently Invisible (No Terminal Command)

These exist in the codebase but have no terminal-level visibility. They must have UI presence:

- **Post-session processing results** — currently just a one-line summary. UI should show extracted entries and actions from the last session with the option to edit or delete before they're finalised.
- **Override tracking** — currently logged silently. UI should show a list of overrides with Atlas's recommendation, user's decision, reasoning, and outcome (fillable later).
- **Context trimming** — currently a console log. UI should show what was trimmed in the diagnostics panel.
- **Goal quality gate** — currently an AI loop in the terminal. UI should show the quality assessment and follow-up questions in a guided flow.
- **Session safety / emergency processing** — currently SIGINT handlers. UI should auto-save session state continuously, not just on exit.
- **Methodology** — currently a config file loaded silently. UI should make it viewable so the user understands how Atlas makes decisions.
- **Agent specs** — currently invisible config files. UI should show which advisory perspectives are active.

---

## Design Principles (from spec Section 13.1)

- Clean and calm. Not a dashboard. Not mission control.
- One voice. Atlas is the only entity visible anywhere.
- Scannable. Briefs under 3 minutes. Collapsible sections for depth.
- Voice-first. Large push-to-talk button, always visible.
- Text responses. Atlas replies in written text.
- Editable. Global memory files, goal records, preferences all editable through UI.
- File upload. Drag-and-drop for documents.
