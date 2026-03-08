# Phase 5 Build Instructions — Enhancement Layer (Final)

Read `docs/PROJECT_ATLAS_v5.md` Sections 6.2, 6.3, 10.4, 11, and 13 for context. Read `CLAUDE.md` for project structure. This is the final phase. It takes Atlas from a working product to a production-quality strategic advisory tool.

**Do not start Phase 5 until the main Phase 4 fixes and UX corrections are verified working — especially conversational goal flow, markdown rendering, actions filtering, goal editing, and the core UI parity fixes.**

This phase has two themes: **making Atlas feel alive** (voice, streaming, engine flexibility) and **making Atlas think clearly** (goal-aware context, source scoping, email compression, session stability, graceful degradation). Both matter equally.

---

## Objective

When Phase 5 is done:
1. The user can speak to Atlas via push-to-talk with local Whisper transcription
2. Atlas responses stream in real time in the chat interface
3. Atlas can run on different model backends through a shared engine adapter layer
4. Atlas assembles context per-goal rather than dumping every available source globally
5. Email context is compressed to thread-level summaries, not raw bodies
6. The user can upload PDFs, CSVs, and JSON files alongside txt/md
7. The UI clearly shows what context Atlas used and what it ignored
8. Long sessions stay stable via history windowing and summarisation
9. All features degrade gracefully when dependencies are missing
10. An end-of-day reflection flow captures what happened and what to carry forward
11. Morning briefs can be exported as PDFs
12. Override tracking includes outcome recording with lightweight calibration

---

## Build Order

Build in this order. Verify each step before moving to the next.

1. Goal-aware source configuration
2. Email prompt compression
3. Goal-aware brief and session context
4. Expanded file uploads
5. Context visibility in UI
6. Voice input
7. Streaming responses
8. Model-provider abstraction and engine swap
9. Long-session windowing
10. Graceful degradation and error handling sweep
11. PDF export for briefs
12. End-of-day reflection
13. Lightweight override calibration
14. Voice + streaming combined verification

The context and source-scoping work comes first because it fixes a structural problem that affects every session and brief. Voice and streaming come after because they are interaction-layer improvements that sit on top of a working context model.

---

## Step 1: Goal-Aware Source Configuration

Atlas currently loads every available data source (goals, emails, calendar, files, entries, sessions) into every prompt globally. This means a health goal gets recruiter emails in its context, and a job search brief gets gym schedule calendar events. The system prompt builder is source-global when it should be goal-aware.

**Add a source policy to each goal record.**

Add a `context_sources` field to `goal_data` when goals are created or edited. This field defines which data sources Atlas should include when working on this goal.

Schema:

```json
{
  "context_sources": {
    "gmail": "included",
    "calendar": "included",
    "files": "included",
    "web_search": "included",
    "memory": "included"
  }
}
```

Two states per source: `included` and `excluded`. Keep it simple. Atlas already has its own ranking and trimming logic — adding more granularity creates priority conflicts with the existing token ceiling system.

Default for new goals: all sources `included`. The user can then exclude sources that are irrelevant.

**Conversational configuration:**

When creating a goal through the conversational flow, Atlas should ask about relevant sources as part of the interview: "For this goal, should I keep an eye on your emails? What about your calendar? Are there any files I should know about?" This is natural, not a form.

When editing a goal, the user can say "stop pulling emails into my health goal" and Atlas updates the source policy.

**UI:**

On the Goals screen, each goal's detail view should show its source configuration. The user should be able to toggle sources on/off for each goal directly from the card.

**Migration:**

Existing goals without a `context_sources` field should default to all sources included. Do not break existing goal records.

---

## Step 2: Email Prompt Compression

The Gmail pipeline was rewritten to do staged retrieval (triage, rank, deep read, summarise) but the prompt formatter is still injecting raw email bodies and expanded thread content into the system prompt. This makes email disproportionately token-heavy and pulls Atlas toward email-centric advice even when email is secondary to the active goal.

**Fix `formatEmailsForPrompt()` to output only structured thread-level summaries.**

For each relevant email or thread, the prompt should contain only:

- Thread/sender identification (who, one line)
- What happened (brief narrative, 1-2 sentences)
- What is pending or requires reply (specific action if any)
- Deadline or urgency level (if apparent)
- Thread status: active conversation / waiting for user reply / waiting for other party / closed
- Why it matters to the active goal (one line connecting this email to a specific goal)

Example of what should go into the prompt:

```
## Email Context [auto-captured]
Scanned: 42 emails (last 72h) | Deeply read: 4 | Threads expanded: 1

1. Recruiter at Greenpixie — initial outreach for Front-End Developer role.
   Status: waiting for your reply. No deadline stated.
   Relevance: directly matches primary goal.

2. hackajob — 3 daily matches sent. One role matches your React + TypeScript profile.
   Status: informational, no reply needed.
   Relevance: potential leads for primary goal.

3. Indeed — application confirmation for Website Manager role.
   Status: application submitted, no response yet.
   Relevance: active application for primary goal.
```

**What must NOT go into the system prompt:**

- Raw email bodies
- Raw expanded thread message content
- Full HTML or plaintext dumps
- Marketing email content that passed through ranking

The deep-read bodies and thread content are consumed during the summarisation step and then discarded from prompt context. Only the summaries enter the system prompt.

**The summarisation should happen via Claude** — send the raw bodies/threads to Claude with a prompt asking for the structured summary format above, then use the summary output in the system prompt. This is a processing step, not a direct injection.

---

## Step 3: Goal-Aware Brief and Session Context

Teach `buildSystemPrompt()` to filter sources based on the active goal's source policy.

**How it should work:**

When building the system prompt for a brief or session:

1. Determine the dominant goal(s) for this interaction. For a brief, that's all active goals. For a session, it starts as all active goals but may narrow as the conversation focuses.
2. Check each goal's `context_sources` policy.
3. Only include a data source if at least one active goal has it set to `included`.
4. If a source is excluded by all active goals, skip it entirely — don't load it, don't rank it, don't trim it. It shouldn't exist in the prompt.

**Brief generation changes:**

The brief currently adds an Email Highlights section whenever `emailData` exists and a Schedule Awareness section whenever `calendarData` exists. Change this:

- Only add Email Highlights if at least one active goal includes gmail as a source
- Only add Schedule Awareness if at least one active goal includes calendar as a source
- The brief should lead with the dominant goal's priorities, not with whichever integration has the most data

**Cross-goal awareness is preserved.**

This is not workspace isolation. Atlas still sees all active goals simultaneously. It still surfaces cross-goal conflicts ("your side project is eating time from your job search"). But it no longer dumps irrelevant data sources into goals that don't need them.

If two goals have different source policies (job search includes gmail, health goal excludes gmail), Atlas includes gmail in the session context but knows it's relevant to the job search goal, not the health goal. The source policy is a relevance signal, not a hard firewall.

---

## Step 4: Expanded File Uploads

The current file ingestion only supports `.txt` and `.md`. This limits Atlas's ability to work with real documents — job description PDFs, financial spreadsheets, data exports, structured records.

**Add support for:**

- **PDF** — extract text content using a PDF parsing library (e.g. `pdf-parse` for Node.js). Handle multi-page documents. Truncate at the existing `MAX_CONTENT_CHARS` limit.
- **CSV** — parse into structured data. Store the raw CSV text but also extract headers and first N rows as a readable summary for prompt context. Use `papaparse` or similar.
- **JSON** — store raw content. For prompt context, extract a summary of the structure (top-level keys, array lengths, sample values) rather than dumping the full JSON.

**Goal association at upload time:**

When uploading via the UI, the user should be able to associate the file with a specific goal or mark it as global context. The file picker should show a dropdown of active goals plus a "Global" option.

**Electron file picker update:**

Update the file dialog filter to accept the new types:
```
{ name: 'Documents', extensions: ['txt', 'md', 'pdf', 'csv', 'json'] }
```

**File content in prompts:**

Files associated with a goal are only included in the prompt when that goal is active, following the source policy. Global files are included when any goal has files set to `included`.

File content in prompts should still be truncated and summarised, not dumped raw. For large files, include a summary header (filename, type, size, associated goal, first ~500 characters or structural summary) and let Atlas request the full content via a `[FILE: filename]` marker if it needs more detail during the session.

---

## Step 5: Context Visibility in UI

The user should be able to see exactly what Atlas is using and what it's ignoring. This builds trust and makes the adviser feel deliberate rather than opaque.

**Add a context panel to the Today screen and the Talk screen.**

On the Today screen, below the stats cards:

```
Context Sources
─────────────────────────
Active goals: 2 (Job Search [primary], Side Project [secondary])
Gmail: included (4 relevant threads summarised)
Calendar: included (3 events today)
Files: 2 files attached to Job Search goal
Memory: 12 persistent entries, 8 recent entries
Sessions: 5 sessions in last 7 days

Excluded by goal policy:
Gmail excluded from: Side Project
```

On the Talk screen, show a collapsible sidebar or header panel that displays:

- Which goal(s) are in scope for this session
- Which sources were loaded
- Which sources were excluded and why
- Token budget usage (approximate): "Context: ~4200/6000 tokens"
- What was trimmed, if anything

**This replaces the Settings diagnostics panel idea** — context visibility belongs where the user is working (Today and Talk), not buried in Settings. The Settings diagnostics tab can remain as a more detailed view, but the primary visibility should be inline.

After a session ends, show alongside the processing summary:

- Entries created (with types and importance)
- Actions created (with due dates)
- What was persisted vs what stays in the 7-day window

This is the "Atlas is making notes" visibility the user asked about.

---

## Step 6: Voice Input — Local Whisper

The user should be able to press and hold a button, speak, release, and have their words appear as text input to Atlas. Transcription runs locally using Whisper. No cloud voice APIs.

**Setup:**

Install `whisper-node` or a suitable Node.js binding for `whisper.cpp`. Download the small English model to start.

- Start with `small.en` (~75MB) for speed
- Offer `base.en` (~150MB) in Settings for better accuracy

Store models in `config/models/`. Add `config/models/` to `.gitignore`.

Create `src/voice.js` that handles:
- Recording audio from the microphone while push-to-talk is active
- Saving audio to a temporary WAV file or buffer
- Running Whisper transcription on the audio
- Returning the transcript text

**Electron integration:**

Audio recording must happen in the renderer process via `navigator.mediaDevices.getUserMedia`. The recorder captures audio while the push-to-talk button is held, produces a WAV blob on release, sends it to the main process via IPC where Whisper transcribes it and returns the text.

IPC flow:
- `voice:transcribe` — receives audio buffer from renderer, runs Whisper, returns transcript string

**UI integration:**

Add a large push-to-talk button to the Talk screen, next to the text input bar. The spec says "Large push-to-talk button, always visible."

- Microphone icon
- Press and hold: button changes colour (recording state), audio captures
- Release: button returns to normal, "Transcribing..." indicator shows briefly
- Transcribed text appears in the input field for review
- Auto-send on release should be configurable in Preferences — default to review-before-send so the user can correct transcription errors

Real-time transcription while speaking is not required for Phase 5 — transcribe on release is sufficient.

**Graceful degradation:**

If the Whisper model is not downloaded:
- Voice button is disabled with a tooltip explaining why
- Settings shows model status with download instructions
- Text input works normally

If microphone permission is denied:
- Clear message shown
- Text input works normally

Text chat must always remain fully usable without voice.

**Settings — Voice section:**

- Model selection: small.en / base.en (with download status for each)
- Auto-send on release: on/off
- Microphone test button
- Voice input status: enabled / disabled / model missing

---

## Step 7: Streaming Responses

Atlas should stream responses token-by-token so the user sees Atlas "typing" in real time instead of waiting for a complete block.

**Backend changes:**

Add streaming capability to the engine layer:

- `sendStreaming(prompt, systemPrompt, options, onChunk)` — calls the provided `onChunk(text)` callback each time new data arrives on stdout, instead of buffering everything
- The existing `send()` (buffered) remains for non-streaming uses: post-session processing, goal structuring, email summarisation, calibration — anything where streaming adds no value
- The conversation variant should also support streaming

**IPC changes:**

Streaming requires push events, not request-response. Use `webContents.send` from main to renderer to push chunks:

- Renderer calls `atlas.chat.send(message)` as before
- Main process starts the streaming call and immediately begins forwarding chunks via `mainWindow.webContents.send('chat:chunk', text)`
- Renderer listens for `chat:chunk` events and appends text to the current Atlas message in real time
- When generation completes, main sends `chat:done` with any metadata (markers detected, etc.)
- If markers are detected in the complete response, the refinement call happens and its response also streams

**UI changes:**

- The Atlas message bubble starts empty and grows as chunks arrive
- The typing indicator transitions smoothly into the first chunk of text
- Markdown rendering should apply once when the message is complete rather than per-chunk — this avoids rendering glitches from partial markdown
- The send button and input field should be disabled while Atlas is streaming, re-enabled on completion
- If the user navigates away from the chat screen during streaming, the response should still complete and be available when they return

**Graceful degradation:**

If streaming is unavailable for the selected engine, silently fall back to the current request-response pattern. The chat UX must never break because streaming isn't supported.

---

## Step 8: Model-Provider Abstraction and Engine Swap

Atlas should support one active engine at a time behind a shared interface. The goal is not parallel model debate — it is the ability to swap the active engine cleanly.

**Architecture:**

Create an engine adapter layer:
- `src/engines/base.js` — defines the shared interface
- `src/engines/claude.js` — Claude CLI adapter
- `src/engines/codex.js` — Codex CLI adapter

Each engine implements the same interface:
- `send(prompt, systemPrompt, options)` — buffered response
- `sendStreaming(prompt, systemPrompt, options, onChunk)` — streaming response
- `isAvailable()` — checks if the CLI is installed and responsive
- `getCapabilities()` — returns what this engine supports

Capabilities should include:
- streaming supported: yes/no
- tool use supported: yes/no
- web search supported: yes/no
- local CLI detected: yes/no

**Integration:**

Refactor all direct Claude calls in the orchestrator so Atlas talks to the active engine through the adapter interface. The orchestrator, memory system, retrieval logic, prompt assembly, UI, files, Gmail, Calendar, and sessions should not care which engine is underneath.

One active engine at a time. No parallel deliberation. No merging multiple model answers. No change to Atlas personality based on engine choice.

**Settings — AI Engine section:**

- Active engine: Claude CLI / Codex CLI / future engines
- Engine availability status (detected/not detected)
- Capability summary for the active engine
- Test connection button
- Switch engine (takes effect on next session)

**Graceful degradation:**

If the selected engine is unavailable:
- Show a clear error in Settings and chat
- Allow switching back to a working engine
- Do not crash the app

---

## Step 9: Long-Session Windowing

Atlas should stay stable during longer conversations without letting raw context balloon endlessly.

Currently every turn resends the full conversation history. For a 1-2 hour power session with many exchanges, this becomes very large and degrades response quality as important context gets pushed further from the model's attention.

**Implementation:**

Create a session-history manager that:
- Keeps the most recent 10 exchanges verbatim (user + Atlas pairs)
- When the history exceeds this threshold, summarises everything older into a concise "conversation so far" block
- The summary preserves: decisions made, commitments given, unresolved questions, important factual details, corrections the user made to Atlas's assumptions
- The summary discards: small talk, repeated information, superseded plans
- The summary is generated by calling the AI engine when the window threshold is first crossed, then updated each time more turns fall outside the window

**Prompt structure with windowing:**

```
[System prompt with context]

Conversation summary (earlier in this session):
[AI-generated summary of older turns]

Recent conversation:
[Last 10 exchanges verbatim]

User: [current message]
```

**Rules:**

- Do not blindly resend the full session history forever
- Preserve the parts most likely to affect advice quality
- Commitments, deadlines, decisions, and corrections matter more than casual exchanges
- The summary should be loss-aware: losing a commitment or correction is worse than losing a pleasantry

**Verification:**

Test with extended mock sessions (20+ exchanges) and confirm:
- Response quality remains coherent
- Prompt size stops growing linearly after the window threshold
- Recent context is preserved accurately
- Summarised context includes key decisions and commitments

---

## Step 10: Graceful Degradation and Reliability Sweep

This is a deliberate hardening pass across the whole app. Go through every feature and ensure it degrades cleanly.

**Check each of these:**

- Active AI engine missing or broken → clear error message, no crash, suggest checking installation, allow engine switch
- Supabase unreachable → clear error on startup, retry option, explain what's wrong
- Google credentials missing or expired → email/calendar skip silently with console note, Settings shows "not connected"
- Whisper model not downloaded → voice button disabled with tooltip, text input works
- Microphone permission denied → clear status message, no crash
- Network offline → local features still work (goals, actions, memory browsing), network features show "offline" state
- Streaming unavailable → silent fallback to buffered responses
- Post-session processing fails → session still saved with duration, warning shown, user can re-trigger processing
- PDF export fails → clear error, suggest alternative (copy to clipboard)
- File ingestion fails → clear error with the specific reason (unsupported type, file not found, too large, parse error)
- Goal source policy missing → default to all sources included, don't break
- Email summarisation fails → fall back to metadata-only (sender/subject/date), never crash
- Calendar fetch fails → skip calendar context, note in console, continue normally

**Toast notification system:**

Replace all raw JavaScript `alert()` calls with a styled notification/toast system:
- Errors in red — persist until dismissed
- Warnings in amber — auto-dismiss after 8 seconds
- Confirmations in green — auto-dismiss after 4 seconds
- Info in blue — auto-dismiss after 4 seconds

All user-facing errors should go through this system. No raw alerts anywhere in the app.

---

## Step 11: PDF Export for Briefs

Add an "Export PDF" button to the brief card on the Today screen.

When clicked:
- Take the rendered brief HTML (already formatted via markdown rendering)
- Wrap it in a clean PDF template with Atlas branding, date, and footer
- Use Electron's built-in `webContents.printToPDF()` — no external libraries needed
- Prompt the user for a save location via `dialog.showSaveDialog`
- Save the PDF

The PDF should look professional — clean typography, proper margins, subtle branding. Not a raw HTML dump or a screenshot.

---

## Step 12: End-of-Day Reflection

Add a structured reflection flow that helps Atlas close the loop on the day.

**Flow:**

The user clicks "End of Day" on the Today screen or from the Talk screen. Atlas opens a conversational reflection:

- Pulls today's session summaries, completed actions, new entries, open items
- Generates a reflection following the methodology's after-action review format:
  - What was supposed to happen today?
  - What actually happened?
  - What got in the way or helped?
  - What should change tomorrow?
  - What is the single most important thing for tomorrow?
- Presents the reflection conversationally — the user can respond, add context, correct assumptions, or just acknowledge

**This is a conversation, not a report dump.** Atlas presents its assessment, the user can push back or add detail, and Atlas adjusts.

**Persistence:**

Save the reflection as a session with mode `review`. Extract entries and actions the same way other sessions are processed.

**UI:**

Add an "End of Day" button on the Today screen. It can always be available, but display it more prominently after 5pm local time. Clicking it opens the Talk screen with the reflection flow pre-loaded.

---

## Step 13: Lightweight Override Calibration

Keep this modest. Do not overfit Atlas based on a tiny sample of overrides.

**Override outcome recording:**

The overrides table already has `outcome` and `outcome_date` fields. Add a UI flow to resolve them:

- On the Memory overrides tab, each unresolved override gets a "Record Outcome" button
- Clicking it opens a short conversation: "What happened? Did your decision work out, or would my recommendation have been better?"
- The user provides the outcome. Save it to the override record.
- Atlas can also prompt for outcomes during sessions: "Three weeks ago you chose to skip the networking event against my advice. How did that play out?"

**Calibration:**

Create `src/calibration.js` that analyses resolved overrides:

- Check whether enough resolved overrides exist to justify analysis (minimum 5 resolved overrides before any calibration runs)
- Identify broad patterns only: does Atlas tend to be too aggressive in one domain? Too conservative in another?
- Generate a short calibration note if warranted — one or two sentences, not a stats dump
- Regenerate the calibration note when there are 3+ new resolved overrides since the last calibration

**Integration:**

Load the calibration note in `buildSystemPrompt()` as a section after the methodology, only if one exists and is based on meaningful data. If there aren't enough overrides, don't include any calibration note — Atlas's base methodology is sufficient.

**Rules:**

- No strong behavioural shifts from tiny data
- Calibration is advisory, not prescriptive
- The note should sound like: "Based on past outcomes, you have tended to over-recommend networking when the user's instincts about company culture have been more accurate. Weight direct user impressions more heavily in culture-fit assessments."
- Not: "Your accuracy rate is 62.5%. Adjusting confidence by -12%."

---

## Step 14: Voice + Streaming Combined Verification

Once voice (Step 6) and streaming (Step 7) are both working independently, verify the complete end-to-end flow:

1. User presses and holds the push-to-talk button
2. Audio records
3. On release, Whisper transcribes locally
4. "Transcribing..." indicator shows briefly
5. Transcribed text appears in the input field
6. User reviews and sends (or auto-sends if configured)
7. Atlas's response streams token-by-token into the chat
8. Push-to-talk button is available again as soon as the response completes

This is the full interaction model the spec envisions: voice in, streaming text out. Both halves must work together smoothly, not just independently.

Test edge cases:
- User presses push-to-talk while Atlas is still streaming a previous response
- Very short recordings (under 1 second)
- Very long recordings (over 60 seconds)
- Whisper returns empty or garbled transcription
- Network drops during streaming response

---

## Success Criteria

When Phase 5 is complete:

- [ ] Push-to-talk voice input works locally with Whisper
- [ ] Atlas responses stream in real time in the chat UI
- [ ] The active AI engine can be switched in Settings
- [ ] Atlas works through a shared engine adapter layer, not hardwired Claude calls
- [ ] Goals have per-goal source configuration (included/excluded per source)
- [ ] The system prompt only includes sources relevant to active goals
- [ ] The brief is goal-aware, not integration-driven
- [ ] Email prompt content is structured thread summaries, not raw bodies
- [ ] PDF, CSV, and JSON files can be uploaded and associated with goals
- [ ] The UI shows what context Atlas used and what it ignored (Today and Talk screens)
- [ ] Long sessions do not grow raw prompt size linearly forever
- [ ] All features degrade gracefully with clear error messages
- [ ] Toast notification system replaces all raw alerts
- [ ] Brief export produces clean PDFs
- [ ] End-of-day reflection works as a conversational close-out flow
- [ ] Override outcomes can be recorded
- [ ] Calibration stays lightweight and only activates when meaningful
- [ ] Voice and streaming work together for the full voice-in, streaming-text-out flow
- [ ] Atlas feels like a production tool, not a prototype

---

## What This Phase Is NOT

- Not a redesign. The UI, architecture, and conversation model are settled.
- Not new conceptual features. Everything here makes existing features smarter, more robust, or more polished.
- Not a rewrite. Phase 5 adds layers on top of working code.
- Not dual-AI deliberation. One engine at a time, swappable, not parallel.

This is the difference between "it works" and "I use it every day and trust it."
