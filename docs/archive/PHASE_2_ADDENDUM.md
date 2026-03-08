# Phase 2 Addendum — Read This Alongside PHASE_2_BUILD.md

These are additional implementation requirements for Phase 2. Apply them as you build. They are not optional.

---

## 1. Deduplicate Extracted Entries and Actions

After Claude extracts entries and actions from a conversation, do not save them immediately. First, pass the extracted list back through Claude with a short prompt asking it to identify and remove duplicates or near-duplicates. Two entries that describe the same insight in different words should be merged into one. An action that restates an entry's commitment should not create a redundant entry — the action is the trackable version, the entry is the memory note. Only save the deduplicated list.

Also compare against existing open actions before saving. If Claude extracts an action that matches an already-open action in the database, do not create a duplicate. Skip it or update the existing one.

---

## 2. Clear Rule for Overrides Table vs Entry Type

Every time the user disagrees with an Atlas recommendation, create BOTH:
- A row in the `overrides` table with the structured fields (recommendation, user decision, reasoning). This is the trackable record that gets revisited later when the outcome is known.
- An entry in the `entries` table with `entry_type: 'override'` and a concise content summary. This is what surfaces in pre-session context loading so Atlas remembers the disagreement happened.

The `overrides` table is for structured outcome tracking. The `entries` table is for memory context. They serve different purposes. Always write both.

---

## 3. Deterministic Prompt Trimming

Do not rely on vague instructions like "trim if needed." Implement a concrete trimming strategy:

- After assembling the full system prompt, estimate its token count. A rough estimate is fine — character count divided by 4 is close enough for English text.
- Set a hard ceiling of 6000 tokens for the system prompt.
- If the prompt exceeds the ceiling, trim in this order: recent entries first, then recent session summaries, then persistent entries. Never trim goals, open actions, overdue actions, or user context files — those are always included in full.
- When trimming a category, remove the oldest items first.
- Log a warning to the console if trimming occurs so the user knows context was reduced.

---

## 4. Robust /complete Command

When the user types `/complete` followed by text, search open actions for matches. Three cases to handle:

- **One match:** complete it, confirm to the user what was completed.
- **Multiple matches:** display the matching actions with numbers and ask the user to pick one. Do not auto-complete an ambiguous match.
- **No matches:** tell the user no matching action was found and show the list of open actions so they can try again.

Match against the action description using case-insensitive substring matching. Partial text like `/complete follow up` should match an action containing "follow up with Company X."

---

## 5. Session Safety on Unexpected Exit

Do not rely solely on `/quit` to trigger post-session processing. The user might close the terminal, hit Ctrl+C, or the process might crash.

- Register handlers for `SIGINT`, `SIGTERM`, and `beforeExit` on the process. When triggered during an active session, run the post-session processor with whatever conversation history exists at that point.
- Additionally, create the session record in the database at the START of the session (with a null summary). Update it with the summary when the session ends. This way, even if processing fails on exit, there is at least a session record showing a session happened.
- If the conversation history has fewer than 2 exchanges when the exit signal fires, skip extraction — there is not enough content to summarise meaningfully. Just update the session duration and close.

---

## 6. SQL First

Before writing any application code for the new tables, output the full SQL block from PHASE_2_BUILD.md Step 1 and tell the user to run it in the Supabase SQL Editor. Verify the tables exist by querying them (same pattern as the initDB connection check) before proceeding with the application code. Do not attempt to create tables from application code.
