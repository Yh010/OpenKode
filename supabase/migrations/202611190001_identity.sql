-- Account and ownership metadata only. No prompts, source code, or provider keys.
begin;

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text check (char_length(display_name) <= 200),
    created_at timestamptz not null default now()
);

create table public.installations (
    id uuid primary key,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (id, user_id)
);

create table public.chats (
    id uuid primary key,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (id, user_id)
);

-- CLI launches, separate from Supabase authentication sessions.
create table public.cli_sessions (
    id uuid primary key,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    installation_id uuid not null,
    created_at timestamptz not null default now(),
    unique (id, user_id),
    foreign key (installation_id, user_id) references public.installations(id, user_id)
);

-- The collector registers runs after validating the user's token.
-- Detailed span/event payloads remain in the collector's trace store.
create table public.runs (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    session_id uuid not null,
    chat_id uuid,
    created_at timestamptz not null default now(),
    foreign key (session_id, user_id) references public.cli_sessions(id, user_id),
    foreign key (chat_id, user_id) references public.chats(id, user_id)
);

create index installations_user_id_idx on public.installations(user_id);
create index chats_user_id_idx on public.chats(user_id);
create index cli_sessions_user_id_idx on public.cli_sessions(user_id);
create index cli_sessions_installation_idx on public.cli_sessions(installation_id, user_id);
create index runs_user_id_idx on public.runs(user_id);
create index runs_session_idx on public.runs(session_id, user_id);
create index runs_chat_idx on public.runs(chat_id, user_id);

alter table public.profiles enable row level security;
alter table public.installations enable row level security;
alter table public.chats enable row level security;
alter table public.cli_sessions enable row level security;
alter table public.runs enable row level security;

revoke all on public.profiles, public.installations, public.chats,
    public.cli_sessions, public.runs from anon, authenticated;

grant select on public.profiles, public.installations, public.chats,
    public.cli_sessions, public.runs to authenticated;
grant insert (id, display_name) on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant insert (id, user_id) on public.installations, public.chats to authenticated;
grant insert (id, user_id, installation_id) on public.cli_sessions to authenticated;
grant all on public.profiles, public.installations, public.chats,
    public.cli_sessions, public.runs to service_role;

create policy profiles_select_own on public.profiles
    for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles
    for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
    for update to authenticated using ((select auth.uid()) = id)
    with check ((select auth.uid()) = id);

create policy installations_select_own on public.installations
    for select to authenticated using ((select auth.uid()) = user_id);
create policy installations_insert_own on public.installations
    for insert to authenticated with check ((select auth.uid()) = user_id);
create policy chats_select_own on public.chats
    for select to authenticated using ((select auth.uid()) = user_id);
create policy chats_insert_own on public.chats
    for insert to authenticated with check ((select auth.uid()) = user_id);
create policy cli_sessions_select_own on public.cli_sessions
    for select to authenticated using ((select auth.uid()) = user_id);
create policy cli_sessions_insert_own on public.cli_sessions
    for insert to authenticated with check ((select auth.uid()) = user_id);
create policy runs_select_own on public.runs
    for select to authenticated using ((select auth.uid()) = user_id);

commit;
