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
- Database codes map to dashboard labels: `MQ4_ADC` → methane (MQ-4), `MQ7_ADC` → CO (MQ-7), and `MG811_ADC` → CO₂ (MG811). Gas concentration is presented in estimated ppm when the sensor's calibration is configured; raw ADC counts remain visible separately and are what the database stores. MQ-4/MQ-7 estimates use their configured response curves, while MG811 requires a per-unit two-point fit. Estimates and threshold screening remain unavailable until each sensor's calibration settings are complete. The dashboard displays the supplied DENR Administrative Order No. 97-30, Rule 153(a) concentration references—CO 50 ppm, CH₄ 2,500 ppm, and CO₂ 5,000 ppm. Republic Act No. 7076 provides the small-scale mining policy context; the numerical gas limits shown are from Rule 153(a). ADC zero is not treated as zero gas.
- `PULSE_BPM` maps to the dashboard's heart-rate reading in bpm. The firmware sends `0` when no recent beat is detected; the database records it with the status **No beat detected**. Nonzero values are informational only, not a medical measurement.
- The ingestion function inserts a snapshot when any submitted value changes: three gas rows and one pulse row, including `0` when no beat is detected. Identical submitted readings update `received_at` on the existing rows instead. Run `supabase/telemetry_last_seen_permission.sql` once to grant the function's service role SELECT and `received_at`-only UPDATE permissions. Redeploy the Edge Function after pulling the code change.
- History shows when a snapshot started and when it was last confirmed unchanged. Before this behavior is deployed, old rows may still contain one row for every upload.
- The Alerts page presents estimated ppm where calibration is configured, keeps raw ADC readings as supporting data, and compares only calibrated estimates with the supplied Rule 153(a) limits. The software screening band is Warning at 80% of the supplied limit and Critical at or above the limit; this Warning band is an application choice, not a quoted legal threshold. Previous alerts are reconstructed from loaded history and configured estimates, not stored notifications. The supplied limits do not by themselves establish averaging periods, sensor-specific calibration, or applicability to a particular mine.
- The supplied 60–100 bpm adult resting range is displayed as context only. Heart rate varies with age, activity, and individual health; the dashboard does not issue medical or occupational heart-rate alerts. Heart readings are informational and not medical measurements.
- The Sensor analysis page includes a one-hour linear trend estimate per sensor, based only on saved ESP32 readings from the most recent six hours. It requires at least 8 readings spanning 30 minutes; otherwise it reports insufficient data and does not synthesize a prediction. Its approximate 70% prediction interval is calculated from model residuals and is not a 70% probability that the forecast is correct. Gas forecasts are in estimated ppm and are unavailable until every plotted reading is inside its calibration range; heart-rate forecasts remain in bpm. Forecasts are not safety-risk predictions.
- Notifications are not sent, and no occupational exposure average is calculated. Battery data remains unreported. This prototype is not a certified safety system or medical device.
- Live history, charts, filtering, pagination, and CSV export use rows returned from Supabase. Data is read-only in the browser.
- If setup is incomplete, the dashboard displays the database/configuration error rather than falling back to simulated readings.

## Files

- `index.html` — dashboard shell and scripts.
- `app.css` — responsive A.R.G.O.S. theme.
- `app.js` — pages, filters, charts, and rendering.
- `gas-calibration.js` — guarded browser-side MQ-4/MQ-7 response models; does not change stored telemetry.
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

## Gas concentration estimates

The browser uses the supplied study/library power-law curves for MQ sensors:

| Sensor | Gas | Model |
|---|---|---|
| MQ-4 | Methane | `ppm = 1012.7 × (Rs/R0)^-2.786` |
| MQ-7 | Carbon monoxide | `ppm = 99.042 × (Rs/R0)^-1.518` |

`gas-calibration.js` intentionally leaves each sensor's load resistance (`loadResistanceKOhm`), warmed-up clean-air raw ADC baseline (`cleanAirRawAdc`), and output-circuit verification (`outputCircuitVerified`) unset/false. Do not enable estimates until those values are measured or the circuit is confirmed. The clean-air resistance reference is derived as `R0 = Rs_clean / cleanAirRatio`; the current normalized ratio is `Rs/R0 = cleanAirRatio × Rs_current / Rs_clean`.

The conversion assumes the firmware's 10-bit ADC reading scaled by four, a nominal 3.3 V ADC full scale, the configured 1 kΩ / 2 kΩ external divider, 5 V sensor supply, and a direct unbuffered sensor/load-resistor divider. It reverses these factors to estimate module output voltage, then calculates `Rs = RL × (Vsupply / Vout - 1)`. ESP32 ADC behavior, module circuits, resistor tolerances, sensor warm-up/aging, humidity, and temperature can make the result inaccurate; the module circuit must match this assumption. The measured RL must be the load resistance in the actual sensing circuit, not an assumed nominal value.

MQ-7 estimates additionally remain disabled until `mq7HeaterCycleVerified` is explicitly set after checking 5.0 V for about 60 seconds and 1.4–1.5 V for about 90 seconds, with measurements sampled in the CO-measurement phase. Current firmware does not control or report the heater phase; a module that handles cycling and phase timing itself must be verified.

### MG811 two-point CO₂ calibration

The cited MQ calibration study covers MQ-series sensors but does not publish an MG811 calibration coefficient. MG811 uses an output-voltage response rather than the MQ `Rs/R0` model. A public MG811 driver describes a logarithmic two-point fit and explicitly treats its default voltage values as placeholders; this project does not copy those defaults as calibration data.

For the installed MG811 module and its complete analog path, measure and enter:

- `lowReferencePpm` and `lowReferenceRawAdc`: a known lower CO₂ reference concentration and the stable averaged ADC reading at that gas.
- `highReferencePpm` and `highReferenceRawAdc`: a distinct known higher CO₂ reference concentration and the stable averaged ADC reading at that gas.
- Set `referencePointsVerified` to `true` only after confirming the reference gas values, sensor warm-up/stabilization, and readings.

The browser calculates `log10(ppm) = m × rawADC + b`, where `m = (log10(P2) - log10(P1)) / (ADC2 - ADC1)` and `b = log10(P1) - m × ADC1`. This captures the installed module, amplifier, divider, and ESP32 ADC in one fit. It only returns ppm for readings between the two reference ADC points; it will not extrapolate outside the calibration range. Use traceable CO₂ reference concentrations spanning the intended operating range (including the relevant 4,000–5,000 ppm screening region); do not assume room air is exactly 400 ppm or use a generic internet/library voltage as the unit's factor. If reference-gas measurements are unavailable, leave ppm unavailable rather than treating raw ADC as ppm.

The currently entered, user-provided points are 400 ppm at 300 ADC counts and 1,000 ppm at 1,000 ADC counts. They produce `log10(ppm) = 0.0005684857 × rawADC + 2.4315143`. This fit is valid only between 400–1,000 ppm and raw ADC 300–1,000; it does not cover the 4,000 ppm Warning or 5,000 ppm Critical bands. MG811 readings outside that calibrated interval remain unavailable for ppm screening. Before using those higher thresholds, replace the upper point with a verified reference near or above 5,000 ppm (and its stable averaged ADC reading), or collect additional reference points and fit a wider range. The provided ADC response rises between the two submitted points; verify this direction against the module output and repeat the measurements if it conflicts with your observed sensor behavior.

The project’s reference MQ paper does not cover MG811: [Calibration and standardization of air quality measurements using MQ sensors (2020)](https://revistas.ufps.edu.co/index.php/respuestas/article/download/2408/3008?inline=1). The MG811 two-point approach is consistent with the [UPM MG811 driver](https://github.com/eclipse-upm/upm/blob/eb6dd047f6024497308f9a9af24d4aa91ba63b10/src/mg811/mg811.cxx), whose comments say its example calibration voltages are placeholders to be determined for the actual environment/sensor.

Example model outputs (not readings from this hardware):

| Sensor | Example Rs/R0 | Curve output |
|---|---:|---:|
| MQ-4 | 2.2 | 112.6 ppm methane |
| MQ-4 | 4.4 | 16.3 ppm methane |
| MQ-4 | 8.8 | 2.4 ppm methane |
| MQ-7 | 13.75 | 1.9 ppm CO |
| MQ-7 | 27.5 | 0.6 ppm CO |
| MQ-7 | 55 | 0.2 ppm CO |

These are mathematical outputs of the configured MQ curves, not evidence that the site has calibrated the installed sensors. Estimates appear as ppm with raw ADC values retained separately and are calculated in the browser only; the database remains raw ADC and CSV export includes both raw values and estimated ppm where available. Do not use estimates as a substitute for reference-gas calibration or a certified safety instrument.
