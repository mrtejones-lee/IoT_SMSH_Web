# Minewatch | Helmet Monitoring

Minewatch is a vanilla HTML/CSS/JavaScript demo dashboard for helmet telemetry. It preserves the industrial dark theme and mining background and runs locally without a build step, framework, or dependency install.

## Run locally

- Open `index.html` directly in a modern browser, or
- Open this folder in VS Code, install the **Live Server** extension, then right-click `index.html` and choose **Open with Live Server**.

The simulation runs in either mode. Live Server is convenient for development and avoids browser restrictions that can apply to local files.

## Demo behavior

- The initial data source is clearly labeled **DEMO MODE – SIMULATED SENSOR DATA**.
- Environmental (MQ-136/H2S, MQ-7/CO, MQ-6/LPG, MG811/CO2), heart-rate, and battery voltage/current readings use a shared random-walk simulator.
- Readings and historical telemetry update every 10 seconds by default. History is session-only and capped at 5,000 records.
- Navigation uses page fragments (`#overview`, `#monitoring`, `#devices`, `#miners`, `#alerts`, and `#history`) without reloading the document.
- The overview and live monitoring pages provide simulation controls. Alerts provides threshold configuration, acknowledgment, and resolution. History supports filtering, pagination, and CSV export.
- Gas sensor measurements are raw ADC counts except for the explicitly simulated CO2 ppm value. ADS1115 is shown as an ADC, not a sensor. All thresholds and measurements are demonstrations, not safety or medical guidance.

## Code structure

- `index.html` contains the shared shell and navigation.
- `app.css` contains the responsive industrial theme.
- `mockSensorEngine.js` owns the shared readings, interval, threshold checks, alerts, and bounded telemetry history.
- `app.js` renders the client-side pages and connects controls to the provider.
- `Pictures/webBG.jpg` is the dashboard background.

`mockSensorEngine.js` exposes `window.MinewatchMockProvider` and selects it as `window.MinewatchProvider`. The UI listens for the `minewatch:update` event and consumes the provider's state/configuration and control methods. A future live adapter can implement the same contract and publish that event; it should use a separate data source and must not mix live readings with simulated records.

## Safety note

This is a research/demo interface, not a certified safety system. Sensor values, thresholds, battery behavior, and heart-rate measurements are simulated and must not be used for operational or medical decisions.
