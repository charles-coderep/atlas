# Phase 3 Build Instructions — Dynamic Retrieval & External Inputs

Read `PROJECT_ATLAS_v5.md` Sections 5, 7, and 9 for the full context on session flow, memory retrieval, and external inputs. Read `CLAUDE.md` for project principles. This document tells you exactly what to build for Phase 3.

**Do not start Phase 3 until Phase 2 is verified working — sessions are being summarised, entries extracted, actions tracked, and briefs reference real history.**

---

## Objective

Give Atlas the ability to deepen context mid-conversation and connect to the outside world. When Phase 3 is done, Atlas can search the web for current information during sessions, pull calendar and email context on startup, accept uploaded files, and retrieve deeper memory when the conversation goes somewhere unexpected.

**When this phase is done:**
1. Atlas can search the web during sessions when current information is needed
2. Gmail summaries are pulled on app launch and included in context
3. Google Calendar events are pulled on app launch and included in context
4. The user can upload files (job descriptions, CVs, documents) and Atlas can reference them
5. Atlas can retrieve older memory entries mid-session when a past topic resurfaces
6. The morning brief includes calendar events and email highlights for the day

---

## Step 1: Web Search During Sessions

This is the highest-value addition in Phase 3. Atlas currently gives advice based on its training data and the user's stored context. Adding web search means it can verify claims, check current job listings, look up companies, and find real-time information.

**Implementation approach:**

Create a new file `src/search.js` that wraps a web search capability. There are two practical options for a terminal app:

- **Option A:** Use the Claude CLI's built-in tool use. If the Claude CLI supports tool use with web search, configure the call to enable it. This is the simplest path — Claude decides when to search and handles it internally.
- **Option B:** Use a search API directly (e.g. Tavily, SerpAPI, or Brave Search API). The orchestrator detects when a search would be useful (or Claude requests one), calls the API, and injects the results back into the conversation context.

Check which approach works with the current Claude CLI setup. Option A is strongly preferred if available because it keeps the search decision inside Claude's reasoning rather than requiring external detection logic.

**Integration with sessions:**

In `src/session.js`, if using Option B, add a `/search <query>` command that lets the user explicitly trigger a search. Also update the system prompt to tell Atlas it can request a search by outputting a specific marker (e.g. `[SEARCH: query]`) which the session loop detects, executes, and feeds back.

If using Option A with native tool use, no session changes are needed — just enable the tools on the CLI call.

**System prompt addition:**

Add to the system prompt in `src/orchestrator.js`: "You have access to web search. Use it when you need current information — job listings, company details, market data, news, or any factual claim you are not certain about. Do not guess at statistics or current facts when you could search instead. When you search, cite what you found."

---

## Step 2: Google Calendar Integration

Atlas should know what's on the user's calendar today and this week. This context makes the day planner subagent perspective actually useful and lets Atlas give time-aware advice.

**Setup:**

Create `src/integrations/calendar.js`. Use the Google Calendar API with OAuth2. The user will need to:
1. Create a Google Cloud project and enable the Calendar API
2. Create OAuth2 credentials (desktop application type)
3. Download the credentials JSON and save it to `config/credentials/google_credentials.json`
4. On first run, go through the OAuth flow to get a refresh token, saved to `config/credentials/google_token.json`

Add `config/credentials/` to `.gitignore`.

**What to fetch:**

- Today's events (start time, end time, title, location if any)
- This week's events (next 7 days, same fields)
- Any event happening in the next 2 hours (flagged as imminent)

**When to fetch:**

On app startup, before the menu appears. Cache the results in memory for the session. Do not re-fetch during the session unless the user asks for a calendar refresh.

**Integration:**

Pass the calendar data to `buildSystemPrompt()` in `src/orchestrator.js` as a new section:

```
## Today's Calendar
[events with times]

## This Week
[upcoming events]
```

Update `src/brief.js` to reference calendar data in the morning brief prompt. Atlas should factor in scheduled events when recommending how to spend the day — "You have an interview at 2pm, so front-load applications this morning" is the kind of advice this enables.

**Graceful degradation:**

If credentials are not set up, or the API call fails, skip calendar context silently. Log a note to the console: "Calendar integration not configured — skipping." Atlas should still work without it. Never crash on a missing integration.

---

## Step 3: Gmail Integration

Atlas should know about relevant recent emails — recruiter responses, interview invitations, important notifications. This is not a full email client. It's a summary layer.

**Setup:**

Create `src/integrations/gmail.js`. Use the Gmail API with the same OAuth2 credentials and token as Calendar (same Google Cloud project, just enable the Gmail API too).

**What to fetch:**

- Unread emails from the last 24 hours (sender, subject, snippet — not full body)
- Emails matching certain labels or keywords if configured (e.g. "interview", "offer", "application")
- Count of unread emails total

**Privacy constraint:**

Do NOT send full email bodies to the AI. Send only sender, subject, and the first 100 characters of the snippet. The user's full email content should not leave their machine or enter the AI context unless they explicitly ask Atlas to read a specific email.

**When to fetch:**

On app startup, same as calendar. Cache in memory.

**Integration:**

Add to the system prompt as a new section:

```
## Recent Emails (last 24 hours)
[sender, subject, snippet for each]
```

Update the morning brief to reference email highlights. Atlas should flag anything that looks time-sensitive or relevant to active goals — "You have an email from [Company X] with subject 'Interview Scheduling' — you should read and respond to that before anything else today."

**Graceful degradation:**

Same as calendar — if not configured, skip silently and log to console.

---

## Step 4: File Upload and Ingestion

The user should be able to give Atlas documents — job descriptions, their CV, course materials, company research — and have Atlas reference them in conversation.

**Implementation:**

Create `src/files.js` that handles file ingestion. Create a `files/` directory in the project root for stored uploads.

**Supported file types for Phase 3:**
- Plain text (.txt)
- Markdown (.md)
- PDF (.pdf) — extract text content using a PDF parsing library

**Ingestion flow:**

Add a `/upload <filepath>` command to the session. When triggered:
1. Read the file from the provided path
2. Extract text content (plain read for txt/md, parse for PDF)
3. Save a record to a new `files` table in Supabase: filename, file_type, content (the extracted text), uploaded_at, and an optional goal_id association
4. Confirm to the user: "File ingested: [filename]. I can now reference it in our conversations."

**New Supabase table:**

```
files table: id (UUID), filename (TEXT), file_type (TEXT), content (TEXT), goal_id (TEXT nullable, references goals), uploaded_at (TIMESTAMPTZ)
```

Provide the SQL to the user to run in Supabase before building the code. Same workflow as previous phases.

**Integration with sessions:**

Add a `/files` command that lists all ingested files. When a file is relevant to the conversation (e.g. the user mentions a company and Atlas has that company's job description on file), the orchestrator should include the file content in the prompt context.

Do not load all file contents into every prompt — that will blow the context window. Only load files that are relevant to the current conversation topic. Relevance can be determined by:
- The user explicitly referencing a file ("check the JD I uploaded for Company X")
- Keyword matching between the conversation topic and file names
- Goal association (files linked to the goal being discussed)

**Context window management:**

File contents can be large. If a file exceeds 2000 tokens (roughly 8000 characters), truncate it and note in the prompt that the file was truncated. Prioritise the beginning of the document as it usually contains the most relevant information.

---

## Step 5: Mid-Session Memory Retrieval

Phase 2 loads recent memory into the system prompt at session start. But conversations drift into unexpected territory — the user might mention something from three weeks ago that's in the archive but wasn't loaded.

**Implementation:**

Create a retrieval function in `src/db.js` that searches entries by keyword. For Phase 3, this is simple text matching — full semantic search with embeddings comes later.

Function: `searchEntries(keywords, limit)` — search the `content` field of entries for any of the provided keywords, return the top N matches ordered by importance descending then date descending.

**Integration with sessions:**

Add a `/recall <topic>` command to the session. When triggered, search entries for the topic, and inject any matches into the conversation context for the next message.

Also update the system prompt to tell Atlas it can request a memory retrieval by outputting a marker like `[RECALL: topic]`. The session loop detects this, runs the search, and feeds results back — same pattern as the search integration.

This is a stopgap until vector search is added. It works for explicit recalls but won't catch implicit connections. That's fine for Phase 3.

---

## Step 6: Enhanced Morning Brief

The morning brief should now incorporate all available context sources. Update `src/brief.js` to assemble:

- Active goals (existing)
- User context files (existing)
- Recent session summaries (Phase 2)
- Open and overdue actions (Phase 2)
- Persistent entries (Phase 2)
- Today's calendar events (Phase 3 — if available)
- Recent email highlights (Phase 3 — if available)
- Ingested files relevant to today's priorities (Phase 3 — if any)

The brief prompt should instruct Atlas to synthesise all of these into a single coherent briefing. Calendar events should influence time recommendations. Emails should surface anything requiring urgent response. File context should inform preparation advice (e.g. "Review the JD for Company X before your 2pm interview").

Apply the same token trimming rules from the Phase 2 addendum. Calendar and email data get trimmed before entries and actions if the prompt is too long.

---

## Step 7: Integration Setup Flow

Since Phase 3 introduces Google API credentials, add a setup flow.

Create `src/setup.js` that handles first-time configuration for Google integrations. On app startup in `src/index.js`, check whether credentials exist. If not, and the user hasn't previously declined, ask once: "Would you like to connect Google Calendar and Gmail? This enables calendar-aware scheduling and email highlights in your briefs. You can set this up later in Settings."

If yes, walk through the OAuth flow. If no, skip and never ask again (save the preference).

This keeps the app usable without Google integrations while making setup easy for users who want them.

---

## What "Done" Looks Like

Phase 3 is complete when:

- [ ] Atlas can search the web during advisory sessions
- [ ] Google Calendar events appear in the morning brief and session context (when configured)
- [ ] Gmail highlights appear in the morning brief and session context (when configured)
- [ ] The user can upload files via `/upload` and Atlas references them in conversation
- [ ] `/files` lists ingested files
- [ ] `/recall <topic>` searches past entries and injects them into context
- [ ] The morning brief incorporates all available context sources
- [ ] All integrations degrade gracefully — the app works without any of them
- [ ] The app still works exactly as before if no integrations are configured

---

## What NOT to Build

- No vector embeddings or semantic search (Phase 3.5 or later)
- No Electron app or GUI (Phase 4)
- No dual-AI deliberation (Phase 5)
- No voice input (separate workstream)
- No full email body reading by default (privacy constraint)
- No automatic calendar event creation (read-only for now)
- No real-time notifications or polling (fetch once on startup)

Focus on making each integration reliable and well-scoped. One good data source is worth more than five flaky ones.
