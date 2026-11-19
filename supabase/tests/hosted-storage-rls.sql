begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
do $$
begin
    if exists(select 1 from public.telemetry_events) then
        raise exception 'Non-operator read leaked telemetry';
    end if;
    begin
        insert into public.collector_operators(user_id) values(auth.uid());
        raise exception 'Operator self-grant unexpectedly succeeded';
    exception when insufficient_privilege then null;
    end;
    begin
        perform public.ingest_telemetry_events('[{"eventId":"forged","spanId":"forged","name":"test","type":"run","status":"ok","userId":"22222222-2222-4222-8222-222222222222"}]'::jsonb);
        raise exception 'Foreign owner unexpectedly accepted';
    exception when insufficient_privilege then null;
    end;
    if has_function_privilege('anon','public.ingest_telemetry_events(jsonb)','execute') then
        raise exception 'Anonymous ingestion unexpectedly permitted';
    end if;
end;
$$;
rollback;
