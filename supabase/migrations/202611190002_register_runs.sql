begin;
-- The caller's verified Supabase JWT determines ownership. No service key is needed.
create function public.register_telemetry_runs(registrations jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
    owner_id uuid := auth.uid();
    item jsonb;
    run_id uuid;
    launch_id uuid;
    conversation_id uuid;
begin
    if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    if jsonb_typeof(registrations) <> 'array' or jsonb_array_length(registrations) not between 1 and 1000 then
        raise exception 'Invalid run registrations';
    end if;
    for item in select value from jsonb_array_elements(registrations) loop
        run_id := (item ->> 'id')::uuid;
        launch_id := (item ->> 'session_id')::uuid;
        conversation_id := (item ->> 'chat_id')::uuid;
        if not exists (select 1 from public.cli_sessions s
            where s.id = launch_id and s.user_id = owner_id
            and s.installation_id = (item ->> 'installation_id')::uuid) then
            raise exception 'Invalid session ownership' using errcode = '42501';
        end if;
        insert into public.runs(id, user_id, session_id, chat_id)
            values (run_id, owner_id, launch_id, conversation_id) on conflict (id) do nothing;
        if not exists (select 1 from public.runs r where r.id = run_id and r.user_id = owner_id
            and r.session_id = launch_id and r.chat_id is not distinct from conversation_id) then
            raise exception 'Run ownership conflict' using errcode = '42501';
        end if;
    end loop;
end;
$$;
revoke all on function public.register_telemetry_runs(jsonb) from public, anon;
grant execute on function public.register_telemetry_runs(jsonb) to authenticated;
commit;
