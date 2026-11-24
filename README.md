# A.R.G.O.S. | Advanced Real-Time Gas Occupational Safety

A.R.G.O.S. reads real ESP32 gas-sensor and optional pulse-sensor telemetry from Supabase and refreshes the latest rows every 10 seconds. The existing mock simulator remains in `mockSensorEngine.js` but is not loaded by the app.

## Configure the public dashboard

1. In Supabase, open **Project Settings → API** (or **API Keys**) and copy the project's **publishable key** or legacy **anon** key. These keys are intended for browser use; never use a `service_role` or secret key here.
2. Set `publishableKey` in `supabase-public-config.js` to that public key. The project URL and device ID are already configured.
3. In the Supabase SQL Editor, run `supabase/telemetry_public_read_policy.sql`. It grants anonymous `SELECT` only for `HELMET-001` rows with `source = 'ESP32'`. The telemetry table must already exist.
4. Ensure the `ingest-telemetry` Edge Function is deployed and writing to `public.telemetry_readings`. It must validate `DEVICE_INGEST_TOKEN` and use server-side credentials; those secrets do not belong in this site.
5. Redeploy the static site to Vercel. For a local check, use VS Code Live Server and open `index.html`.

**Public access warning:** anyone can read the allowed device's telemetry with the project's public key. Do not store sensitive or identifying data in these rows. To protect telemetry, switch to Supabase Auth and an authenticated-only RLS policy instead.

## Live data behavior

- The browser queries the Supabase REST API for the newest 5,000 `HELMET-001` ESP32 rows and refreshes every 10 seconds.
- Database codes map to dashboard labels: `MQ4_ADC` → methane (MQ-4), `MQ7_ADC` → CO (MQ-7), and `MG811_ADC` → CO₂ (MG811). The website displays the ESP32 gas sensor values directly using the existing ppm labels.
- `PULSE_BPM` maps to the dashboard's heart-rate reading in bpm. The firmware sends `0` when no recent beat is detected; the database records it with the status **No beat detected**. Nonzero values are informational only, not a medical measurement.
- The ingestion function inserts a snapshot when any submitted value changes: three gas rows and one pulse row, including `0` when no beat is detected. Identical submitted readings update `received_at` on the existing rows instead. Run `supabase/telemetry_last_seen_permission.sql` once to grant the function's service role SELECT and `received_at`-only UPDATE permissions. Redeploy the Edge Function after pulling the code change.
- History shows when a snapshot started and when it was last confirmed unchanged. Before this behavior is deployed, old rows may still contain one row for every upload.
- The Alerts page displays the latest ESP32 sensor readings.
- The supplied 60–100 bpm adult resting range is displayed as context only. Heart rate varies with age, activity, and individual health; the dashboard does not issue medical or occupational heart-rate alerts. Heart readings are informational and not medical measurements.
- The Sensor analysis page plots and forecasts values directly from saved ESP32 readings.
- Notifications are not sent, and no occupational exposure average is calculated. Battery data remains unreported. This prototype is not a certified safety system or medical device.
- Live history, charts, filtering, pagination, and CSV export use rows returned from Supabase. Data is read-only in the browser.
- If setup is incomplete, the dashboard displays the database/configuration error rather than falling back to simulated readings.

## Files

- `index.html` — dashboard shell and scripts.
- `app.css` — responsive A.R.G.O.S. theme.
- `app.js` — pages, filters, charts, and rendering.
- `gas-calibration.js` — calibration module retained but not loaded by the website.
- `supabase-public-config.js` — browser-safe Supabase URL and publishable/anon key.
- `supabase-provider.js` — read-only REST polling and row mapping.
- `supabase/functions/ingest-telemetry/index.ts` — device-token-authenticated ingestion function.
- `supabase/telemetry_public_read_policy.sql` — narrowly scoped public read policy for the selected device.
- `mockSensorEngine.js` — preserved simulator, currently unused by the page.
- `Pictures/webBG.jpg` — dashboard background.

## Analog pulse sensor setup

- Install **PulseSensor Playground** from Arduino IDE Library Manager.
- Connect the analog pulse sensor's signal output to ESP32 GPIO 32, VCC to 3.3V, and GND to GND. Confirm the module output never exceeds 3.3V; module wiring/voltage requirements can vary.
- The sketch uses 10-bit ADC sampling for PulseSensor Playground and scales gas ADC readings by four to preserve their existing approximate 0–4095 display range. Set `PULSE_SENSOR_THRESHOLD` to suit the sensor's signal; the default is a starting point, not a calibrated value.
- The firmware always uploads `PULSE_BPM`: the latest detected BPM when fresh, or `0` when the library cannot initialize or no recent beat is detected.
- Redeploy the updated `ingest-telemetry` Edge Function and website before expecting heart rate in Supabase/dashboard. The existing telemetry table needs no schema change; it stores the BPM in `value` and `bpm` in `unit`.

Heart-rate readings are informational and this prototype is not a medical device or certified safety system. Battery voltage/current and battery percentage are not uploaded.

## Gas readings

The website displays ESP32 gas sensor values directly using ppm labels.
