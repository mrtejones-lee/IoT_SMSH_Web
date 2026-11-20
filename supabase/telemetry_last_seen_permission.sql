-- The ingestion function updates received_at when a reading snapshot is unchanged.
-- This does not grant UPDATE access to anon or authenticated dashboard clients.
grant select on table public.telemetry_readings to service_role;
grant update (received_at) on table public.telemetry_readings to service_role;
