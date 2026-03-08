# Local Setup

This is the current setup path for Atlas as the codebase works today.

## 1. Prerequisites

Required:
- Node.js 20+ recommended
- npm
- A Supabase project
- At least one local AI CLI installed and authenticated:
  - Claude CLI
  - Codex CLI

Optional:
- Google Cloud OAuth credentials for Gmail and Calendar
- Local Whisper model for push-to-talk voice input

## 2. Install Dependencies

```powershell
npm install
```

If `whisper-cpp-node` fails to build on Windows, install the required Visual Studio C++ build tools and rerun `npm install`.

## 3. Environment File

Create `.env` from the example:

```powershell
Copy-Item .env.example .env
```

Fill in:

```env
AI_ENGINE=claude
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

Optional model overrides:

```env
ATLAS_CLAUDE_MODEL=claude-opus-4-6
ATLAS_CODEX_MODEL=gpt-5.4
```

Notes:
- `AI_ENGINE` chooses the starting engine. The active engine can also be changed later in Settings.
- Atlas persists the selected engine and adviser style in a runtime settings file under the Electron app data directory.

## 4. Supabase Setup

Create a new Supabase project, then open the SQL Editor and run this schema.

```sql
create extension if not exists pgcrypto;

create table if not exists goals (
    id text primary key,
    title text not null,
    type text,
    priority text check (priority in ('primary', 'secondary', 'supporting')),
    goal_data jsonb not null default '{}'::jsonb,
    status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists sessions (
    id uuid primary key default gen_random_uuid(),
    date date not null default current_date,
    brief text,
    summary text,
    duration_minutes integer,
    mode text check (mode in ('brief', 'advisory', 'review', 'mixed')),
    created_at timestamptz not null default now()
);

create table if not exists entries (
    id uuid primary key default gen_random_uuid(),
    session_id uuid references sessions(id) on delete set null,
    goal_id text references goals(id) on delete set null,
    date date not null default current_date,
    domain text not null,
    entry_type text not null,
    content text not null,
    importance integer check (importance between 1 and 5),
    is_persistent boolean not null default false,
    source text not null default 'session',
    tags jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists actions (
    id uuid primary key default gen_random_uuid(),
    entry_id uuid references entries(id) on delete set null,
    goal_id text references goals(id) on delete set null,
    description text not null,
    due_date date,
    status text not null default 'open' check (status in ('open', 'completed', 'deferred', 'dropped')),
    follow_up_count integer not null default 0,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create table if not exists overrides (
    id uuid primary key default gen_random_uuid(),
    session_id uuid references sessions(id) on delete set null,
    goal_id text references goals(id) on delete set null,
    atlas_recommendation text not null,
    user_decision text not null,
    user_reasoning text,
    outcome text,
    outcome_date date,
    created_at timestamptz not null default now()
);

create table if not exists files (
    id uuid primary key default gen_random_uuid(),
    filename text not null,
    file_type text not null,
    content text not null,
    goal_id text references goals(id) on delete set null,
    uploaded_at timestamptz not null default now()
);

create index if not exists idx_goals_status on goals(status);
create index if not exists idx_sessions_date on sessions(date desc);
create index if not exists idx_entries_goal_id on entries(goal_id);
create index if not exists idx_entries_session_id on entries(session_id);
create index if not exists idx_entries_date on entries(date desc);
create index if not exists idx_actions_goal_id on actions(goal_id);
create index if not exists idx_actions_status on actions(status);
create index if not exists idx_actions_due_date on actions(due_date);
create index if not exists idx_overrides_goal_id on overrides(goal_id);
create index if not exists idx_files_goal_id on files(goal_id);
create index if not exists idx_files_uploaded_at on files(uploaded_at desc);

create or replace function set_timestamp_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create or replace function set_actions_completed_at()
returns trigger as $$
begin
    if new.status = 'completed' and old.status is distinct from 'completed' then
        new.completed_at = now();
    elsif new.status is distinct from 'completed' then
        new.completed_at = null;
    end if;
    return new;
end;
$$ language plpgsql;

drop trigger if exists goals_set_updated_at on goals;
create trigger goals_set_updated_at
before update on goals
for each row
execute function set_timestamp_updated_at();

drop trigger if exists actions_set_completed_at on actions;
create trigger actions_set_completed_at
before update on actions
for each row
execute function set_actions_completed_at();

alter table goals enable row level security;
alter table sessions enable row level security;
alter table entries enable row level security;
alter table actions enable row level security;
alter table overrides enable row level security;
alter table files enable row level security;

do $$
begin
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'goals' and policyname = 'Allow all') then
        create policy "Allow all" on goals for all using (true) with check (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sessions' and policyname = 'Allow all') then
        create policy "Allow all" on sessions for all using (true) with check (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'entries' and policyname = 'Allow all') then
        create policy "Allow all" on entries for all using (true) with check (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'actions' and policyname = 'Allow all') then
        create policy "Allow all" on actions for all using (true) with check (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'overrides' and policyname = 'Allow all') then
        create policy "Allow all" on overrides for all using (true) with check (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'files' and policyname = 'Allow all') then
        create policy "Allow all" on files for all using (true) with check (true);
    end if;
end $$;
```

Why this schema:
- `goal_data` is `jsonb` because the app reads and writes structured goal objects directly.
- `files` is part of the live app and required for uploads and context loading.
- `archived` is a valid goal status in the current UI and deletion flow.

## 5. AI CLI Setup

Atlas uses one local AI CLI at a time.

### Claude CLI

Install and authenticate Claude CLI in the way you normally use it in your shell.

Atlas expects the CLI to be available on `PATH`.

### Codex CLI

Install and authenticate Codex CLI in the way you normally use it in your shell.

Atlas inherits your existing Codex auth by default. It does not isolate `CODEX_HOME` unless you explicitly set `CODEX_HOME` or `ATLAS_CODEX_HOME`.

## 6. Google Calendar and Gmail Setup

This is optional.

Atlas expects:
- `config/credentials/google_credentials.json`
- `config/credentials/google_token.json`

Setup flow:
1. Go to Google Cloud Console.
2. Create a project.
3. Enable Gmail API and Google Calendar API.
4. Create OAuth credentials for a Desktop application.
5. Save the downloaded JSON as `config/credentials/google_credentials.json`.
6. Run Atlas from the terminal once:

```powershell
npm start
```

7. When prompted, approve Google setup and paste back the authorization code.

Atlas will store the token as `config/credentials/google_token.json`.

## 7. Whisper Voice Setup

This is optional. The mic buttons are hidden unless Whisper is available.

Atlas checks for:
- the `whisper-cpp-node` package
- the model file at `config/models/ggml-small.en.bin`

To enable voice:
1. Make sure dependencies are installed with `npm install`.
2. Download a compatible Whisper model file.
3. Save it exactly here:

```text
config/models/ggml-small.en.bin
```

4. Launch the app with `npm run app`.

If Whisper is available, mic buttons appear in:
- main chat
- goal interview
- context interview

## 8. Run Atlas

Desktop app:

```powershell
npm run app
```

Terminal app:

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

## 9. Build a Windows Installer

```powershell
npm run dist:win
```

Output goes to `dist/`.

## 10. Push to GitHub

Standard flow:

```powershell
git status
git add .
git commit -m "Describe the change"
git push origin master
```

Do not commit secrets or machine-local data:
- `.env`
- `config/credentials/`
- `files/`
- `dist/`

Those are already ignored in `.gitignore`.

## 11. First Run Checklist

- [ ] `npm install` completed
- [ ] `.env` created and filled in
- [ ] Supabase SQL applied successfully
- [ ] Claude CLI or Codex CLI installed and authenticated
- [ ] `npm run app` opens the Electron app
- [ ] You can create a goal
- [ ] You can start a session
- [ ] Optional: Google credentials configured
- [ ] Optional: Whisper model placed in `config/models/ggml-small.en.bin`
