-- Public dashboard reads are intentionally limited to this one demo device.
-- Anyone with the project URL and publishable/anon key can still read these rows.
grant select on table public.telemetry_readings to anon;

drop policy if exists "Public dashboard can read HELMET-001 ESP32 telemetry"
  on public.telemetry_readings;

create policy "Public dashboard can read HELMET-001 ESP32 telemetry"
  on public.telemetry_readings
  for select
  to anon
  using (device_id = 'HELMET-001' and source = 'ESP32');
