(function () {
  "use strict";

  const engine = window.MinewatchProvider;
  const app = document.querySelector("#app");
  const nav = document.querySelector("#nav");
  const clock = document.querySelector("#clock");
  const periods = { "1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000, "1h": 3600000 };
  const ui = {
    period: "5m",
    selectedSeries: ["CH4", "CO"],
    historyPage: 0,
    historyFilter: { sensor: "all", status: "all", date: "", time: "", device: "all" },
    alertFilter: { severity: "all", sensor: "all", date: "", time: "", device: "all" },
    minerSearch: "",
    deviceDetails: false,
    thresholdSensor: "CH4"
  };

  function state() { return engine.getState(); }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }
  function fmt(value, digits) {
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits == null ? 0 : digits, minimumFractionDigits: digits || 0 });
  }
  function time(value) {
    return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "--";
  }
  function shortTime(value) {
    return value ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "--";
  }
  function localDateKey(value) {
    const date = new Date(value);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }
  function localTimeKey(value) {
    const date = new Date(value);
    return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  }
  function statusClass(status) { return String(status || "System").toLowerCase().replace(/[^a-z0-9-]+/g, "-"); }
  function badge(status) { return '<span class="status ' + statusClass(status) + '">' + escapeHtml(status) + "</span>"; }
  function reading(code, digits) {
    const item = state().readings[code];
    return item && item.value != null
      ? fmt(item.value, digits) + " <small>" + escapeHtml(item.unit) + "</small>"
      : '-- <small>' + escapeHtml(item ? item.unit : "") + "</small>";
  }
  function liveSensors() { return engine.config(); }
  function sensorByCode(code) { return engine.config().find(function (sensor) { return sensor.code === code; }); }

  function chart(code, period) {
    const duration = periods[period || ui.period] || periods["5m"];
    const cutoff = Date.now() - duration;
    const records = state().history.filter(function (record) {
      return record.sensorCode === code && new Date(record.timestamp).getTime() >= cutoff;
    }).slice().reverse().slice(-60);
    if (!records.length) return '<div class="empty">Waiting for ESP32 telemetry</div>';
    const values = records.map(function (item) { return Number(item.value); });
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const spread = Math.max(max - min, Math.abs(max) * .03, .1);
    const coords = values.map(function (value, index) {
      const x = values.length === 1 ? 50 : 2 + index * 96 / (values.length - 1);
      const y = 55 - (value - (min - spread * .1)) / (spread * 1.2) * 50;
      return [x.toFixed(1), y.toFixed(1)];
    });
    const path = "M " + coords.map(function (point) { return point.join(" "); }).join(" L ");
    return '<svg class="chart" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="Recent ' + escapeHtml(code) + ' trend">' +
      '<path class="chart-grid" d="M0 10H100 M0 30H100 M0 50H100"></path><path class="chart-line" d="' + path + '"></path></svg>';
  }

  function sensorCard(sensor, includeChart) {
    const item = state().readings[sensor.code];
    return '<article class="sensor-card"><div class="sensor-top"><div><h3 class="sensor-name">' + escapeHtml(sensor.name) +
      '</h3><span class="sensor-code">' + escapeHtml(sensor.short || sensor.code) + ' · ' + escapeHtml(sensor.code) + '</span></div>' + badge(item.available ? item.status : "No data") +
      '</div><div class="reading">' + reading(sensor.code, sensor.code === "BATTERY" || sensor.code === "CURRENT" ? 2 : 0) +
      '</div><div class="small-meta">Updated ' + escapeHtml(shortTime(item.updatedAt)) + '</div>' +
      (includeChart ? chart(sensor.code) : "") + "</article>";
  }

  function header(title, description) {
    return '<p class="eyebrow">Operations / ' + escapeHtml(title) + '</p><h1>' + escapeHtml(title) + '</h1><p class="intro">' +
      escapeHtml(description) + '</p>';
  }

  function metrics() {
    const s = state();
    const online = s.deviceOnline ? 1 : 0;
    return '<section class="metrics" aria-label="System summary">' +
      metric("Registered helmets", "1", "HELMET-001 · ESP32") +
      metric("Recently reporting", String(online), online ? "Telemetry received recently" : "No recent telemetry") +
      metric("Active alerts", "--", "No alert table configured") +
      metric("Telemetry rows loaded", String(s.packets), "Most recent records from Supabase") + "</section>";
  }
  function metric(label, value, sub) {
    return '<article class="metric"><div class="metric-label">' + label + '</div><div class="metric-value">' + value +
      '</div><div class="metric-sub">' + escapeHtml(sub) + "</div></article>";
  }

  function gasReferencePanel() {
    const references = [
      ["MQ-4 · Methane (CH₄)", "0.25% / 2,500 ppm", "Not specified", "Reference as supplied; verify against the authoritative rule text."],
      ["MQ-6 · LPG / combustible gas", "10% LEL warning reference", "Not specified", "Not confirmed as a legal limit; depends on target gas and calibration."],
      ["MQ-7 · Carbon monoxide (CO)", "0.005% / 50 ppm", "Not specified", "Reference as supplied; verify against the authoritative rule text."],
      ["MG811 · Carbon dioxide (CO₂)", "0.50% / 5,000 ppm", "Not specified", "Reference as supplied; verify against the authoritative rule text."]
    ];
    return '<section class="panel reference-panel"><div class="panel-head"><h2>Gas concentration references</h2><span>Informational only · not applied to ratings</span></div>' +
      '<div class="panel-body"><p class="reference-warning">User-provided references attributed to Philippine DENR DAO 97-30, Rule 153; not independently verified here. Sensors are not calibrated and the firmware sends raw ADC counts, so the dashboard does not compare readings with these references or classify conditions.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Sensor / gas</th><th>Reference provided</th><th>Averaging period</th><th>Use in dashboard</th></tr></thead><tbody>' +
      references.map(function (row) {
        return "<tr><td>" + escapeHtml(row[0]) + "</td><td>" + escapeHtml(row[1]) + "</td><td>" + escapeHtml(row[2]) + "</td><td>" + escapeHtml(row[3]) + "</td></tr>";
      }).join("") +
      '</tbody></table></div><p class="small-meta">All live readings remain raw ADC counts and are marked NOT CALIBRATED. ADC = 0 does not mean zero gas. Real-time readings are not occupational exposure averages.</p></div></section>';
  }

  function liveControls() {
    const s = state();
    return '<section class="panel"><div class="panel-head"><h2>Database connection</h2><span class="demo-label">LIVE · ESP32</span></div><div class="panel-body">' +
      '<div class="status-line"><span>Supabase REST API</span>' + badge(s.connectionStatus === "connected" ? "Connected" : s.connectionStatus) + '</div>' +
      '<div class="status-line"><span>Refresh interval</span><span>' + s.intervalMs / 1000 + ' seconds</span></div>' +
      '<div class="status-line"><span>ESP32 telemetry rows loaded</span><span>' + s.packets + '</span></div>' +
      '<div class="status-line"><span>Latest telemetry</span><span>' + escapeHtml(time(s.lastTelemetry)) + '</span></div>' +
      '<div class="status-line"><span>Last database check</span><span>' + escapeHtml(shortTime(s.lastCheckedAt)) + '</span></div>' +
      (s.error ? '<p class="error-message" role="alert">' + escapeHtml(s.error) + '</p>' : "") +
      '<div class="panel-body"><button class="button primary" data-action="refresh">Refresh now</button>' +
      '<p class="small-meta">Read-only public access is limited by Supabase RLS to HELMET-001 ESP32 telemetry. Values are raw, uncalibrated sensor readings.</p></div></div></section>';
  }

  function overview() {
    const s = state();
    return header("Overview", "Live ESP32 telemetry from Supabase. The dashboard checks for new readings every " + s.intervalMs / 1000 + " seconds.") +
      '<div class="toolbar"><h2 class="section-title">System snapshot</h2><span class="demo-label">LIVE DATA – ESP32</span></div>' +
      metrics() + '<div class="content-grid"><section class="panel"><div class="panel-head"><h2>Latest telemetry</h2><span>' + escapeHtml(time(s.lastTelemetry)) + '</span></div>' +
      '<div class="panel-body sensor-grid">' + liveSensors().map(function (sensor) { return sensorCard(sensor, false); }).join("") + '</div></section>' +
      '<section class="panel"><div class="panel-head"><h2>Connection status</h2><span>HELMET-001</span></div>' +
      '<div class="status-line"><span>Database connection</span>' + badge(s.connectionStatus === "connected" ? "Connected" : s.connectionStatus) + '</div>' +
      '<div class="status-line"><span>Telemetry freshness</span>' + badge(s.deviceOnline ? "Recent" : "Stale / none") + '</div>' +
      '<div class="status-line"><span>Last telemetry received</span><span>' + escapeHtml(time(s.lastHeartbeat)) + '</span></div>' +
      '<div class="status-line"><span>Data source</span><span>ESP32 · Supabase</span></div>' +
      '<div class="status-line"><span>Battery readings</span><span>Not sent by current firmware</span></div>' +
      '<div class="status-line"><span>Alerts</span><span>Not configured for live data</span></div></section></div>' + gasReferencePanel() +
      '<div class="split">' + liveControls() + '<section class="panel"><div class="panel-head"><h2>Helmet details</h2><span>Minewatch Helmet 001</span></div>' +
      '<div class="status-line"><span>Helmet ID</span><span>HELMET-001</span></div>' +
      '<div class="status-line"><span>Participant</span><span>MINER-001 · anonymized</span></div>' +
      '<div class="status-line"><span>Connection / firmware</span><span>Wi-Fi · firmware not reported</span></div>' +
      '<div class="status-line"><span>ADC</span><span>ESP32 built-in ADC · raw counts</span></div>' +
      '<div class="status-line"><span>Power / heart rate</span><span>Not reported by current firmware</span></div>' +
      '<p class="disclaimer">Gas readings are raw ADC counts, not calibrated gas concentrations. This is not a certified safety system.</p></section></div>';
  }

  function monitoring() {
    const config = engine.config();
    const s = state();
    return header("Live monitoring", "ESP32 environmental sensor readings retrieved from Supabase. Values are raw, uncalibrated measurements.") +
      '<div class="toolbar"><h2 class="section-title">Environmental monitoring</h2><span class="demo-label">LIVE DATA – ESP32</span></div>' +
      '<div class="sensor-grid">' + config.map(function (sensor) { return sensorCard(sensor, true); }).join("") + '</div>' +
      gasReferencePanel() +
      '<div class="toolbar" style="margin-top:22px"><h2 class="section-title">Other telemetry</h2></div>' +
      '<section class="panel"><div class="status-line"><span>Heart rate</span><span>Not sent by current ESP32 firmware</span></div>' +
      '<div class="status-line"><span>Battery voltage / current / charge</span><span>Not sent by current ESP32 firmware</span></div>' +
      '<div class="status-line"><span>ADS1115</span><span>Not used; these pins use the ESP32 built-in ADC</span></div></section>' +
      '<section class="panel" style="margin-top:14px"><div class="panel-head"><h2>Combined historical trend</h2><span>Last ' + escapeHtml(ui.period) + '</span></div><div class="panel-body">' +
      '<div class="form-row"><div class="tab-row">' + Object.keys(periods).map(function (period) {
        return '<button class="button ' + (ui.period === period ? "selected" : "") + '" data-period="' + period + '">' + period + '</button>';
      }).join("") + '</div><div class="tab-row">' + config.map(function (sensor) {
        return '<button class="button ' + (ui.selectedSeries.includes(sensor.code) ? "selected" : "") + '" data-series="' + sensor.code + '">' + escapeHtml(sensor.code) + '</button>';
      }).join("") + '</div></div>' +
      '<div class="sensor-grid" style="margin-top:12px">' + ui.selectedSeries.map(function (code) {
        const sensor = sensorByCode(code);
        return sensor ? '<div class="hardware"><strong>' + escapeHtml(sensor.name) + ' · ' + escapeHtml(sensor.unit) + '</strong>' + chart(code, ui.period) + '</div>' : "";
      }).join("") + '</div></div></section>' +
      '<div class="split">' + liveControls() + '<section class="panel"><div class="panel-head"><h2>Hardware and data notes</h2><span>HELMET-001</span></div>' +
      '<div class="status-line"><span>Analog acquisition</span><span>ESP32 built-in ADC · four channels</span></div>' +
      '<div class="status-line"><span>MQ-4</span><span>Methane module · raw ADC counts</span></div>' +
      '<div class="status-line"><span>MG811</span><span>Raw ADC counts (not ppm)</span></div>' +
      '<div class="status-line"><span>Battery / heart rate</span><span>Not included in current uploads</span></div>' +
      '<p class="disclaimer">Sensor modules require suitable calibration before interpreting readings as gas concentration.</p></section></div>';
  }

  function devices() {
    const s = state();
    const components = [
      ["MQ-4", "Methane sensor · raw ADC counts", "CH4"], ["MQ-7", "Carbon monoxide sensor · raw ADC counts", "CO"],
      ["MQ-6", "LPG / combustible gas sensor · raw ADC counts", "LPG"], ["MG811", "Carbon dioxide sensor · raw ADC counts", "CO2"],
      ["Ear-clip sensor", "Heart-rate sensor · not sent", null], ["ADS1115", "Not used; ESP32 built-in ADC is used", null],
      ["Battery module", "Voltage/current · not sent", null]
    ];
    return header("Helmet devices", "Inspect the anonymized helmet record and the hardware currently represented in live telemetry.") +
      '<div class="toolbar"><h2 class="section-title">Registered device</h2><span class="demo-label">LIVE · ESP32</span></div>' +
      '<section class="panel"><div class="table-wrap"><table><thead><tr><th>Helmet ID</th><th>Assigned miner</th><th>Telemetry</th><th>Battery</th><th>Last received</th><th>Firmware</th><th>Mode</th></tr></thead><tbody><tr>' +
      '<td>HELMET-001</td><td>MINER-001</td><td>' + badge(s.deviceOnline ? "Recent" : "Stale / none") + '</td><td>Not reported</td>' +
      '<td>' + escapeHtml(time(s.lastHeartbeat)) + '</td><td>Not reported</td><td>ESP32 · LIVE</td></tr></tbody></table></div>' +
      '<div class="panel-body"><div class="controls"><button class="button" data-action="toggle-details">' +
      (ui.deviceDetails ? "Hide details" : "Show device details") + '</button><button class="button primary" data-action="refresh">Refresh telemetry</button></div>' +
      (ui.deviceDetails ? '<div class="hardware-grid" style="margin-top:14px">' + components.map(function (component) {
        const item = component[2] ? s.readings[component[2]] : null;
        return '<article class="hardware"><strong>' + component[0] + '</strong><span>' + component[1] + '</span>' +
          (item ? '<div class="small-meta">' + reading(component[2]) + '</div>' + badge(item.available ? item.status : "No data") : '<div class="small-meta">No live reading configured</div>') + '</article>';
      }).join("") + '</div><p class="small-meta">Latest telemetry received: ' + escapeHtml(time(s.lastTelemetry)) + '</p>' : "") +
      '</div></section><p class="disclaimer">Device connectivity is inferred from recent database telemetry; no direct Wi-Fi status or firmware information is uploaded.</p>';
  }

  function miners() {
    const s = state();
    const query = ui.minerSearch.trim().toLowerCase();
    const matches = ["MINER-001", "HELMET-001", "active"].some(function (word) { return word.toLowerCase().includes(query); });
    return header("Miners", "Anonymized participant roster associated with the live telemetry device.") +
      '<section class="panel"><div class="panel-head"><h2>Demo participants</h2><span>1 anonymized record</span></div><div class="panel-body">' +
      '<label class="field">Search participants<input id="miner-search" class="search" type="search" placeholder="Search ID, helmet, or status" value="' + escapeHtml(ui.minerSearch) + '"></label></div>' +
      (matches ? '<div class="table-wrap"><table><thead><tr><th>Participant ID</th><th>Assigned helmet</th><th>Monitoring status</th><th>Last communication</th><th>Latest heart rate</th><th>Battery</th></tr></thead><tbody><tr><td>MINER-001</td><td>HELMET-001</td><td>' +
        badge(s.deviceOnline ? "Recent" : "Stale / none") + '</td><td>' + escapeHtml(time(s.lastHeartbeat)) + '</td><td>Not reported</td><td>Not reported</td></tr></tbody></table></div>' :
        '<div class="empty">No anonymized participant matches this search.</div>') + '</section>' +
      '<p class="disclaimer">MINER-001 is an anonymized demo label. Heart rate and battery telemetry are not currently uploaded.</p>';
  }

  function alerts() {
    const s = state();
    return header("Alerts", "The current Supabase telemetry table stores sensor readings, not alert records or calibrated thresholds.") +
      '<section class="panel"><div class="panel-head"><h2>Live alert status</h2><span>Not configured</span></div>' +
      '<div class="empty"><div class="empty-inner"><h3>No live alert stream is configured</h3>' +
      '<p>Raw ADC counts are not calibrated concentrations, so the dashboard does not infer warning or critical gas levels. Add a validated alert pipeline and policy before displaying operational alerts.</p>' +
      '</div></div><div class="status-line"><span>Latest database check</span><span>' + escapeHtml(time(s.lastCheckedAt)) + '</span></div></section>' +
      '<p class="disclaimer">Do not use this prototype as a certified safety system.</p>';
  }

  function history() {
    const s = state();
    const f = ui.historyFilter;
    const filtered = s.history.filter(function (record) {
      return (f.sensor === "all" || record.sensorCode === f.sensor) &&
        (f.status === "all" || record.status.toLowerCase() === f.status) &&
        (!f.date || localDateKey(record.timestamp) === f.date) &&
        (!f.time || localTimeKey(record.timestamp) === f.time) &&
        (f.device === "all" || record.deviceId === f.device);
    });
    const pageSize = 20;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    ui.historyPage = Math.min(ui.historyPage, pages - 1);
    const pageRows = filtered.slice(ui.historyPage * pageSize, (ui.historyPage + 1) * pageSize);
    const rows = pageRows.map(function (item) {
      return "<tr><td>" + escapeHtml(item.id) + "</td><td>" + escapeHtml(time(item.timestamp)) + "</td><td>" +
        escapeHtml(item.deviceId) + "</td><td>" + escapeHtml(item.sensorCode) + "</td><td>" + escapeHtml(fmt(item.value, 2)) +
        "</td><td>" + escapeHtml(item.unit) + "</td><td>" + badge(item.status) + '</td><td class="demo-label">' + item.source + "</td></tr>";
    }).join("");
    return header("Historical data", "ESP32 sensor records queried from Supabase. Each refresh loads the newest records available to this public dashboard.") +
      '<section class="panel"><div class="panel-head"><h2>Telemetry records</h2><span>' + filtered.length + ' matching of the newest 5,000 rows loaded from Supabase</span></div>' +
      '<div class="panel-body"><div class="form-row"><label class="field">Sensor<select id="history-sensor"><option value="all">All sensors</option>' +
      engine.config().map(function (sensor) { return '<option value="' + sensor.code + '"' + (f.sensor === sensor.code ? " selected" : "") + '>' + escapeHtml(sensor.name) + '</option>'; }).join("") +
      '</select></label><label class="field">Status<select id="history-status"><option value="all">All statuses</option>' +
      ["not calibrated", "no data"].map(function (status) { return '<option value="' + status + '"' + (f.status === status ? " selected" : "") + '>' + status + '</option>'; }).join("") +
      '</select></label><label class="field">Device<select id="history-device"><option value="all">All devices</option><option value="HELMET-001"' + (f.device === "HELMET-001" ? " selected" : "") + '>HELMET-001</option></select></label>' +
      '<label class="field">Date<input id="history-date" type="date" value="' + escapeHtml(f.date) + '"></label>' +
      '<label class="field">Time<input id="history-time" type="time" value="' + escapeHtml(f.time) + '"></label>' +
      '<button class="button" data-action="clear-history-filters">Clear filters</button><button class="button primary" data-action="export">Export CSV</button></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Record ID</th><th>Timestamp</th><th>Device</th><th>Sensor</th><th>Value</th><th>Unit</th><th>Status</th><th>Source</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8">No telemetry matches the selected filters.</td></tr>') + '</tbody></table></div>' +
      '<div class="pagination"><span>Page ' + (ui.historyPage + 1) + ' of ' + pages + '</span><div class="controls"><button class="button" data-action="history-prev" ' +
      (ui.historyPage === 0 ? "disabled" : "") + '>Previous</button><button class="button" data-action="history-next" ' +
      (ui.historyPage >= pages - 1 ? "disabled" : "") + '>Next</button></div></div></section>' +
      '<section class="panel" style="margin-top:12px"><div class="panel-head"><h2>Historical sensor trend</h2><span>Last ' + ui.period + '</span></div><div class="panel-body">' +
      '<div class="tab-row">' + Object.keys(periods).map(function (period) { return '<button class="button ' + (ui.period === period ? "selected" : "") + '" data-period="' + period + '">' + period + '</button>'; }).join("") + '</div>' +
      '<div class="sensor-grid" style="margin-top:12px">' + ui.selectedSeries.slice(0, 3).map(function (code) {
        return '<div class="hardware"><strong>' + escapeHtml(code) + '</strong>' + chart(code, ui.period) + '</div>';
      }).join("") + '</div></div></section>';
  }

  function render(preserveCharts) {
    const oldCharts = preserveCharts ? Array.from(app.querySelectorAll("svg.chart")) : [];
    const focused = preserveCharts && app.contains(document.activeElement) ? document.activeElement : null;
    const focusedId = focused && focused.id;
    const focusedValue = focused && focused.value;
    const selectionStart = focused && typeof focused.selectionStart === "number" ? focused.selectionStart : null;
    const selectionEnd = focused && typeof focused.selectionEnd === "number" ? focused.selectionEnd : null;
    const route = location.hash.replace(/^#/, "") || "overview";
    const pages = { overview: overview, monitoring: monitoring, devices: devices, miners: miners, alerts: alerts, history: history };
    const page = pages[route] || pages.overview;
    nav.querySelectorAll("a[data-route]").forEach(function (link) {
      if (link.dataset.route === (pages[route] ? route : "overview")) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    const active = state().alerts.filter(function (alert) { return !alert.resolved; }).length;
    document.querySelector("#nav-alert-count").textContent = active ? String(active) : "";
    const connected = state().connectionStatus === "connected";
    document.querySelector("#connection-text").textContent = connected ? "Database connected" :
      state().connectionStatus === "checking" ? "Checking database" : "Database unavailable";
    document.querySelector(".dot").classList.toggle("offline", !connected);
    document.querySelector("#source-pill").textContent = "LIVE DATA · ESP32";
    app.innerHTML = page();
    if (preserveCharts) {
      const newCharts = Array.from(app.querySelectorAll("svg.chart"));
      newCharts.forEach(function (newChart, index) {
        const oldChart = oldCharts[index];
        if (!oldChart) return;
        const oldLine = oldChart.querySelector(".chart-line");
        const newLine = newChart.querySelector(".chart-line");
        if (oldLine && newLine) oldLine.setAttribute("d", newLine.getAttribute("d"));
        oldChart.setAttribute("aria-label", newChart.getAttribute("aria-label"));
        newChart.replaceWith(oldChart);
      });
    }
    if (focusedId) {
      const replacement = document.getElementById(focusedId);
      if (replacement) {
        replacement.value = focusedValue;
        replacement.focus({ preventScroll: true });
        if (selectionStart !== null && typeof replacement.setSelectionRange === "function") {
          replacement.setSelectionRange(selectionStart, selectionEnd);
        }
      }
    }
  }

  function downloadCsv() {
    const f = ui.historyFilter;
    const rows = state().history.filter(function (record) {
      return (f.sensor === "all" || record.sensorCode === f.sensor) &&
        (f.status === "all" || record.status.toLowerCase() === f.status) &&
        (!f.date || localDateKey(record.timestamp) === f.date) &&
        (!f.time || localTimeKey(record.timestamp) === f.time) &&
        (f.device === "all" || record.deviceId === f.device);
    });
    const headers = ["Record ID", "Device ID", "Sensor code", "Value", "Unit", "Status", "Timestamp", "Data source"];
    const csv = [headers].concat(rows.map(function (r) {
      return [r.id, r.deviceId, r.sensorCode, r.value, r.unit, r.status, r.timestamp, r.source];
    })).map(function (row) {
      return row.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "minewatch-esp32-telemetry.csv";
    link.click();
    window.setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  function toast(message, error) {
    const previous = document.querySelector(".toast");
    if (previous) previous.remove();
    const element = document.createElement("div");
    element.className = "toast" + (error ? " error" : "");
    element.setAttribute("role", error ? "alert" : "status");
    element.textContent = message;
    document.body.appendChild(element);
    window.setTimeout(function () { element.remove(); }, 3200);
  }

  app.addEventListener("click", function (event) {
    const periodButton = event.target.closest("[data-period]");
    if (periodButton) { ui.period = periodButton.dataset.period; render(); return; }
    const seriesButton = event.target.closest("[data-series]");
    if (seriesButton) {
      const code = seriesButton.dataset.series;
      ui.selectedSeries = ui.selectedSeries.includes(code) ? ui.selectedSeries.filter(function (item) { return item !== code; }) : ui.selectedSeries.concat(code);
      if (!ui.selectedSeries.length) ui.selectedSeries = ["CH4"];
      render();
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    try {
      if (action === "refresh") engine.refresh();
      else if (action === "toggle-details") { ui.deviceDetails = !ui.deviceDetails; render(); }
      else if (action === "clear-history-filters") {
        ui.historyFilter = { sensor: "all", status: "all", date: "", time: "", device: "all" }; ui.historyPage = 0; render();
      } else if (action === "export") downloadCsv();
      else if (action === "history-prev") { ui.historyPage = Math.max(0, ui.historyPage - 1); render(); }
      else if (action === "history-next") { ui.historyPage += 1; render(); }
    } catch (error) {
      toast(error.message || "Unable to complete that action.", true);
    }
  });

  app.addEventListener("change", function (event) {
    const target = event.target;
    if (target.id === "history-sensor") ui.historyFilter.sensor = target.value;
    else if (target.id === "history-status") ui.historyFilter.status = target.value;
    else if (target.id === "history-date") ui.historyFilter.date = target.value;
    else if (target.id === "history-time") ui.historyFilter.time = target.value;
    else if (target.id === "history-device") ui.historyFilter.device = target.value;
    else if (target.id === "alert-severity") ui.alertFilter.severity = target.value;
    else if (target.id === "alert-sensor") ui.alertFilter.sensor = target.value;
    else if (target.id === "alert-date") ui.alertFilter.date = target.value;
    else if (target.id === "alert-time") ui.alertFilter.time = target.value;
    else if (target.id === "alert-device") ui.alertFilter.device = target.value;
    else if (target.id === "threshold-sensor") { ui.thresholdSensor = target.value; render(); return; }
    else if (target.id === "miner-search") { ui.minerSearch = target.value; render(); return; }
    else return;
    ui.historyPage = 0;
    render();
  });

  window.addEventListener("hashchange", render);
  window.addEventListener("minewatch:update", function () { render(true); });
  function updateClock() {
    clock.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date());
  }
  updateClock();
  window.setInterval(updateClock, 30000);
  if (!location.hash) location.hash = "#overview";
  render();
})();
