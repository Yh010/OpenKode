begin;
-- Clients can call the checked ingestion RPC directly. Validate the stored JSON
-- shape too, so malformed metadata cannot poison another user's dashboard view.
create function public.valid_telemetry_payload(item jsonb) returns boolean
language sql immutable set search_path = '' as $$
select jsonb_typeof(item) = 'object'
and not exists (
    select 1 from unnest(array['eventId','runId','spanId','name','startedAt','endedAt','userId','sessionId','installationId']) field
    where jsonb_typeof(item->field) is distinct from 'string' or length(item->>field) = 0
)
and (not item ? 'parentSpanId' or jsonb_typeof(item->'parentSpanId') = 'string')
and (not item ? 'chatId' or jsonb_typeof(item->'chatId') = 'string')
and (not item ? 'metadata' or jsonb_typeof(item->'metadata') = 'object')
and (not item ? 'llm' or (
    jsonb_typeof(item->'llm') = 'object'
    and not exists (select 1 from unnest(array['provider','model']) field
        where item->'llm' ? field and jsonb_typeof(item->'llm'->field) is distinct from 'string')
    and not exists (select 1 from unnest(array['inputTokens','outputTokens','totalDurationNs','promptEvalDurationNs','evalDurationNs']) field
        where item->'llm' ? field and (jsonb_typeof(item->'llm'->field) is distinct from 'number'
            or (item->'llm'->field) < '0'::jsonb))
));
$$;
revoke all on function public.valid_telemetry_payload(jsonb) from public, anon;
grant execute on function public.valid_telemetry_payload(jsonb) to authenticated;
alter table public.telemetry_events add constraint telemetry_payload_shape
    check (public.valid_telemetry_payload(payload) is true);
commit;
