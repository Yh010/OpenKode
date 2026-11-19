begin;

-- Membership is maintained by the project owner through SQL, never by clients.
create table public.collector_operators (
    user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.collector_operators enable row level security;
revoke all on public.collector_operators from anon, authenticated;

create function public.is_collector_operator() returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.collector_operators where user_id = auth.uid());
$$;
revoke all on function public.is_collector_operator() from public, anon;
grant execute on function public.is_collector_operator() to authenticated;

alter table public.runs add constraint runs_id_user_id_unique unique(id, user_id);
create table public.telemetry_events (
    sequence bigint generated always as identity unique,
    user_id uuid not null references auth.users(id),
    event_id text not null check (length(event_id) between 1 and 200),
    run_id uuid not null,
    started_at timestamptz not null,
    received_at timestamptz not null default now(),
    payload jsonb not null,
    primary key (user_id, event_id),
    foreign key (run_id, user_id) references public.runs(id, user_id)
);
create index telemetry_events_run on public.telemetry_events(run_id, sequence);
create index telemetry_events_started on public.telemetry_events(started_at, sequence);
alter table public.telemetry_events enable row level security;
revoke all on public.telemetry_events from anon, authenticated;
grant select on public.telemetry_events to authenticated;
create policy operator_read on public.telemetry_events for select to authenticated
    using ((select public.is_collector_operator()));

-- Commit before acknowledging an upload. Repeated event IDs are harmless only
-- when the payload is identical; users cannot overwrite already accepted data.
create function public.ingest_telemetry_events(events jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
    owner_id uuid := auth.uid();
    item jsonb;
    canonical jsonb;
    started timestamptz;
begin
    if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    if jsonb_typeof(events) is distinct from 'array' then raise exception 'Invalid events'; end if;
    if jsonb_array_length(events) not between 1 and 1000 or octet_length(events::text) > 1500000 then
        raise exception 'Invalid batch size';
    end if;
    for item in select value from jsonb_array_elements(events) loop
        if jsonb_typeof(item) is distinct from 'object'
            or coalesce(item->>'eventId', '') = '' or coalesce(item->>'spanId', '') = ''
            or coalesce(item->>'name', '') = ''
            or coalesce(item->>'type', '') not in ('run','agent_step','generation','tool','error')
            or coalesce(item->>'status', '') not in ('ok','error') then
            raise exception 'Invalid event';
        end if;
        if item ? 'userId' and item->>'userId' is distinct from owner_id::text then
            raise exception 'Ownership mismatch' using errcode = '42501';
        end if;
        if not exists (select 1 from public.runs r
            join public.cli_sessions s on s.id = r.session_id and s.user_id = r.user_id
            where r.id = (item->>'runId')::uuid and r.user_id = owner_id
            and r.session_id = (item->>'sessionId')::uuid
            and s.installation_id = (item->>'installationId')::uuid
            and r.chat_id is not distinct from (item->>'chatId')::uuid) then
            raise exception 'Invalid run ownership' using errcode = '42501';
        end if;
        started := (item->>'startedAt')::timestamptz;
        if started is null or not isfinite(started) or (item->>'endedAt')::timestamptz is null
            or not isfinite((item->>'endedAt')::timestamptz) or (item->>'endedAt')::timestamptz < started then
            raise exception 'Invalid event timestamps';
        end if;
        canonical := (item - 'receivedAt' - 'durationMs') || jsonb_build_object('userId', owner_id);
        insert into public.telemetry_events(user_id, event_id, run_id, started_at, payload)
            values (owner_id, item->>'eventId', (item->>'runId')::uuid, started, canonical)
            on conflict (user_id, event_id) do nothing;
        if not exists (select 1 from public.telemetry_events e where e.user_id = owner_id
            and e.event_id = item->>'eventId' and e.payload = canonical) then
            raise exception 'Event ID conflict' using errcode = '42501';
        end if;
    end loop;
end;
$$;
revoke all on function public.ingest_telemetry_events(jsonb) from public, anon;
grant execute on function public.ingest_telemetry_events(jsonb) to authenticated;
commit;
