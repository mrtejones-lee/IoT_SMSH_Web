# Minewatch | Helmet Monitoring

Minewatch reads real ESP32 gas-sensor telemetry from Supabase and refreshes the latest rows every 10 seconds. The existing mock simulator remains in `mockSensorEngine.js` but is not loaded by the app.

## Configure the public dashboard

1. In Supabase, open **Project Settings → API** (or **API Keys**) and copy the project's **publishable key** or legacy **anon** key. These keys are intended for browser use; never use a `service_role` or secret key here.
2. Set `publishableKey` in `supabase-public-config.js` to that public key. The project URL and device ID are already configured.
3. In the Supabase SQL Editor, run `supabase/telemetry_public_read_policy.sql`. It grants anonymous `SELECT` only for `HELMET-001` rows with `source = 'ESP32'`. The telemetry table must already exist.
4. Ensure the `ingest-telemetry` Edge Function is deployed and writing to `public.telemetry_readings`. It must validate `DEVICE_INGEST_TOKEN` and use server-side credentials; those secrets do not belong in this site.
5. Redeploy the static site to Vercel. For a local check, use VS Code Live Server and open `index.html`.

**Public access warning:** anyone can read the allowed device's telemetry with the project's public key. Do not store sensitive or identifying data in these rows. To protect telemetry, switch to Supabase Auth and an authenticated-only RLS policy instead.

## Live data behavior

- The browser queries the Supabase REST API for the newest 5,000 `HELMET-001` ESP32 rows and refreshes every 10 seconds.
- Database codes map to dashboard labels: `MQ4_ADC` → methane (MQ-4), `MQ7_ADC` → CO (MQ-7), `MQ6_ADC` → LPG (MQ-6), and `MG811_ADC` → CO₂ (MG811). Values stay labeled **ADC counts**; the UI does not infer a gas concentration or safety status.
- Live telemetry renders through the existing dashboard pages and visual styling. Battery, heart-rate, and alert data are shown as not reported/not configured until firmware and backend support them.
- Live history, charts, filtering, pagination, and CSV export use rows returned from Supabase. Data is read-only in the browser.
- If setup is incomplete, the dashboard displays the database/configuration error rather than falling back to simulated readings.

## Files

- `index.html` — dashboard shell and scripts.
- `app.css` — responsive Minewatch theme.
- `app.js` — pages, filters, charts, and rendering.
- `supabase-public-config.js` — browser-safe Supabase URL and publishable/anon key.
- `supabase-provider.js` — read-only REST polling and row mapping.
- `supabase/functions/ingest-telemetry/index.ts` — device-token-authenticated ingestion function.
- `supabase/telemetry_public_read_policy.sql` — narrowly scoped public read policy for the selected device.
- `mockSensorEngine.js` — preserved mock implementation, currently unused by the page.
- `Pictures/webBG.jpg` — dashboard background.

The ESP32 currently uploads only raw gas-module ADC readings. Add separate hardware and firmware support before expecting battery voltage/current, battery percentage, or heart rate in the live dashboard. This prototype is not a certified safety system.
