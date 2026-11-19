(function () {
  "use strict";

  const engine = window.MinewatchProvider;
  const app = document.querySelector("#app");
  const nav = document.querySelector("#nav");
  const clock = document.querySelector("#clock");
  const periods = { "1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000, "1h": 3600000 };
  const ui = {
    period: "5m",
    selectedSeries: ["HR", "CO"],
    historyPage: 0,
    historyFilter: { sensor: "all", status: "all", date: "", time: "", device: "all" },
    alertFilter: { severity: "all", sensor: "all", date: "", time: "", device: "all" },
    minerSearch: "",
    deviceDetails: false,
    thresholdSensor: "H2S"
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
  function statusClass(status) { return String(status || "System").toLowerCase(); }
  function badge(status) { return '<span class="status ' + statusClass(status) + '">' + escapeHtml(status) + "</span>"; }
  function reading(code, digits) {
    const item = state().readings[code];
    return item ? fmt(item.value, digits) + " <small>" + escapeHtml(item.unit) + "</small>" : "--";
  }
  function liveSensors() { return engine.config().filter(function (sensor) { return ["H2S", "CO", "LPG", "CO2", "HR"].includes(sensor.code); }); }
  function sensorByCode(code) { return engine.config().find(function (sensor) { return sensor.code === code; }); }

  function chart(code, period) {
    const duration = periods[period || ui.period] || periods["5m"];
    const cutoff = Date.now() - duration;
    const records = state().history.filter(function (record) {
      return record.sensorCode === code && new Date(record.timestamp).getTime() >= cutoff;
    }).slice().reverse().slice(-60);
    if (!records.length) return '<div class="empty">Waiting for simulated samples</div>';
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
      '</h3><span class="sensor-code">' + escapeHtml(sensor.code) + '</span></div>' + badge(item.available ? item.status : "Offline") +
      '</div><div class="reading">' + reading(sensor.code, sensor.code === "BATTERY" || sensor.code === "CURRENT" ? 2 : 0) +
      '</div><div class="small-meta">Updated ' + escapeHtml(shortTime(item.updatedAt)) + '</div>' +
      (includeChart ? chart(sensor.code) : "") + "</article>";
  }

  function header(title, description) {
    return '<p class="eyebrow">Operations / ' + escapeHtml(title) + '</p><h1>' + escapeHtml(title) + '</h1><p class="intro">' +
      escapeHtml(description) + '</p>';
  }

  function metrics() {
    const online = state().deviceOnline ? 1 : 0;
    const activeAlerts = state().alerts.filter(function (alert) { return !alert.resolved; }).length;
    return '<section class="metrics" aria-label="System summary">' +
      metric("Registered helmets", "1", "HELMET-001 · demo device") +
      metric("Online helmets", String(online), online ? "Connected over simulated Wi-Fi" : "Device offline") +
      metric("Active alerts", String(activeAlerts), activeAlerts ? "Requires review" : "No active conditions") +
      metric("Registered participants", "1", "Anonymized demo record") + "</section>";
  }
  function metric(label, value, sub) {
    return '<article class="metric"><div class="metric-label">' + label + '</div><div class="metric-value">' + value +
      '</div><div class="metric-sub">' + escapeHtml(sub) + "</div></article>";
  }

  function demoControls() {
    const s = state();
    return '<section class="panel"><div class="panel-head"><h2>Demo controls</h2><span class="demo-label">SIMULATION ONLY</span></div><div class="panel-body">' +
      '<div class="status-line"><span>Simulation</span>' + badge(s.running ? "Normal" : "Offline") + '</div>' +
      '<div class="status-line"><span>Update interval</span><span>' + s.intervalMs / 1000 + ' seconds</span></div>' +
      '<div class="status-line"><span>Generated telemetry packets</span><span>' + s.packets + '</span></div>' +
      '<div class="status-line"><span>Last generated reading</span><span>' + escapeHtml(shortTime(s.lastTelemetry)) + '</span></div>' +
      '<div class="panel-body"><div class="controls">' +
      '<button class="button primary" data-action="' + (s.running ? "pause" : "start") + '">' + (s.running ? "Pause simulation" : "Resume simulation") + '</button>' +
      '<button class="button" data-action="reset">Reset</button><button class="button" data-action="warning">Generate warning</button>' +
      '<button class="button danger" data-action="critical">Generate critical</button></div>' +
      '<div class="form-row" style="margin-top:12px"><label class="field">Update interval (seconds)<input id="interval" type="number" min="1" max="60" value="' + s.intervalMs / 1000 + '"></label>' +
      '<button class="button" data-action="interval">Apply interval</button>' +
      '<label class="field">Demo sensor<select id="demo-sensor">' + liveSensors().map(function (sensor) { return '<option value="' + sensor.code + '">' + escapeHtml(sensor.name) + '</option>'; }).join("") + '</select></label>' +
      '</div><p class="small-meta">Values are simulated demonstration data, not certified safety or medical measurements.</p></div></div></section>';
  }

  function overview() {
    const s = state();
    return header("Overview", "Operational snapshot for the simulated Minewatch helmet. Demo readings update every " + s.intervalMs / 1000 + " seconds.") +
      '<div class="toolbar"><h2 class="section-title">System snapshot</h2><span class="demo-label">DEMO DATA – SIMULATED</span></div>' +
      metrics() + '<div class="content-grid"><section class="panel"><div class="panel-head"><h2>Latest telemetry</h2><span>' + escapeHtml(time(s.lastTelemetry)) + '</span></div>' +
      '<div class="panel-body sensor-grid">' + liveSensors().map(function (sensor) { return sensorCard(sensor, false); }).join("") + '</div></section>' +
      '<section class="panel"><div class="panel-head"><h2>Connection status</h2><span>HELMET-001</span></div>' +
      '<div class="status-line"><span>Device connection</span>' + badge(s.deviceOnline ? "Normal" : "Offline") + '</div>' +
      '<div class="status-line"><span>Wi-Fi / operating mode</span><span>Wi-Fi · DEMO</span></div>' +
      '<div class="status-line"><span>Last device heartbeat</span><span>' + escapeHtml(time(s.lastHeartbeat)) + '</span></div>' +
      '<div class="status-line"><span>Battery condition</span>' + badge(s.readings.BATTERY_PERCENT.value <= 20 ? "Warning" : "Normal") + '</div>' +
      '<div class="status-line"><span>Battery level</span><span>' + fmt(s.readings.BATTERY_PERCENT.value, 1) + '%</span></div>' +
      '<div class="status-line"><span>Latest alert</span><span>' + escapeHtml(s.alerts[0] ? s.alerts[0].severity + " · " + s.alerts[0].sensor : "None") + '</span></div></section></div>' +
      '<div class="split">' + demoControls() + '<section class="panel"><div class="panel-head"><h2>Helmet details</h2><span>Minewatch Helmet 001</span></div>' +
      '<div class="status-line"><span>Helmet / miner ID</span><span>HELMET-001 / MINER-001</span></div>' +
      '<div class="status-line"><span>Connection / firmware</span><span>Wi-Fi / DEMO-1.0</span></div>' +
      '<div class="status-line"><span>ADS1115 ADC</span><span>16-bit · analog acquisition</span></div>' +
      '<div class="status-line"><span>Power</span><span>' + fmt(s.readings.BATTERY.value, 2) + ' V · ' + fmt(s.readings.CURRENT.value, 2) + ' A · ' + fmt(s.readings.BATTERY.value * s.readings.CURRENT.value, 2) + ' W</span></div>' +
      '<p class="disclaimer">Simulation thresholds are configurable demonstration parameters, not official mining limits or medical guidance.</p></section></div>' +
      '<p class="disclaimer">Research prototype only. This dashboard is not a certified safety system and does not guarantee miner safety.</p>';
  }

  function monitoring() {
    const config = engine.config();
    const env = config.filter(function (sensor) { return ["H2S", "CO", "LPG", "CO2"].includes(sensor.code); });
    const power = config.filter(function (sensor) { return ["BATTERY", "CURRENT"].includes(sensor.code); });
    const s = state();
    return header("Live monitoring", "Simulated environmental, physiological, and power telemetry. Measurements are for demonstration only.") +
      '<div class="toolbar"><h2 class="section-title">Environmental monitoring</h2><span class="demo-label">DEMO DATA – SIMULATED</span></div>' +
      '<div class="sensor-grid">' + env.map(function (sensor) { return sensorCard(sensor, true); }).join("") + '</div>' +
      '<div class="toolbar" style="margin-top:22px"><h2 class="section-title">Physiological monitoring</h2></div>' +
      '<div class="sensor-grid">' + sensorCard(sensorByCode("HR"), true) + '</div>' +
      '<div class="toolbar" style="margin-top:22px"><h2 class="section-title">Battery and power monitoring</h2></div>' +
      '<div class="sensor-grid">' + power.map(function (sensor) { return sensorCard(sensor, false); }).join("") +
      '<article class="sensor-card"><div class="sensor-name">Estimated battery</div><div class="reading">' + fmt(s.readings.BATTERY_PERCENT.value, 1) +
      ' <small>%</small></div><div class="small-meta">Power ' + fmt(s.readings.BATTERY.value * s.readings.CURRENT.value, 2) + ' W · simulated</div>' +
      badge(s.readings.BATTERY_PERCENT.value <= 20 ? "Warning" : "Normal") + '</article></div>' +
      '<section class="panel" style="margin-top:14px"><div class="panel-head"><h2>Combined historical trend</h2><span>Last ' + escapeHtml(ui.period) + '</span></div><div class="panel-body">' +
      '<div class="form-row"><div class="tab-row">' + Object.keys(periods).map(function (period) {
        return '<button class="button ' + (ui.period === period ? "selected" : "") + '" data-period="' + period + '">' + period + '</button>';
      }).join("") + '</div><div class="tab-row">' + config.filter(function (sensor) { return sensor.code !== "BATTERY_PERCENT"; }).map(function (sensor) {
        return '<button class="button ' + (ui.selectedSeries.includes(sensor.code) ? "selected" : "") + '" data-series="' + sensor.code + '">' + escapeHtml(sensor.code) + '</button>';
      }).join("") + '</div></div>' +
      '<div class="sensor-grid" style="margin-top:12px">' + ui.selectedSeries.map(function (code) {
        const sensor = sensorByCode(code);
        return sensor ? '<div class="hardware"><strong>' + escapeHtml(sensor.name) + ' · ' + escapeHtml(sensor.unit) + '</strong>' + chart(code, ui.period) + '</div>' : "";
      }).join("") + '</div></div></section>' +
      '<div class="split">' + demoControls() + '<section class="panel"><div class="panel-head"><h2>Supporting hardware</h2><span>Not an additional sensor</span></div><div class="panel-body hardware-grid">' +
      '<div class="hardware"><strong>ADS1115</strong><span>16-bit ADC · analog-to-digital conversion</span></div>' +
      '<div class="hardware"><strong>Active analog channels</strong><span>' + (s.deviceOnline ? "4 simulated sensor channels" : "Unavailable while device is offline") + '</span></div>' +
      '<div class="hardware"><strong>Acquisition status</strong><span>' + (s.deviceOnline ? "Simulated acquisition active" : "Device offline") + '</span></div>' +
      '<div class="hardware"><strong>Battery module</strong><span>Voltage and current monitoring</span></div>' +
      '</div></section></div>';
  }

  function devices() {
    const s = state();
    const components = [
      ["MQ-136", "H₂S environmental sensor", "H2S"], ["MQ-7", "CO environmental sensor", "CO"],
      ["MQ-6", "LPG / combustible gas sensor", "LPG"], ["MG811", "CO₂ demonstration measurement", "CO2"],
      ["Ear-clip sensor", "Heart-rate sensor", "HR"], ["ADS1115", "16-bit ADC · supports analog acquisition", null],
      ["Battery module", "Voltage / current monitoring", "BATTERY"]
    ];
    return header("Helmet devices", "Inspect the anonymized demo helmet, its connection, telemetry, and supporting hardware.") +
      '<div class="toolbar"><h2 class="section-title">Registered device</h2><span class="demo-label">DEMO DEVICE</span></div>' +
      '<section class="panel"><div class="table-wrap"><table><thead><tr><th>Helmet ID</th><th>Assigned miner</th><th>Connection</th><th>Battery</th><th>Last heartbeat</th><th>Firmware</th><th>Mode</th></tr></thead><tbody><tr>' +
      '<td>HELMET-001</td><td>MINER-001</td><td>' + badge(s.deviceOnline ? "Normal" : "Offline") + '</td><td>' + fmt(s.readings.BATTERY_PERCENT.value, 1) +
      '%</td><td>' + escapeHtml(time(s.lastHeartbeat)) + '</td><td>DEMO-1.0</td><td>SIMULATED</td></tr></tbody></table></div>' +
      '<div class="panel-body"><div class="controls"><button class="button ' + (s.deviceOnline ? "danger" : "primary") + '" data-action="device-toggle">' +
      (s.deviceOnline ? "Simulate helmet disconnect" : "Restore device connection") + '</button><button class="button" data-action="toggle-details">' +
      (ui.deviceDetails ? "Hide details" : "Show device details") + '</button></div>' +
      (ui.deviceDetails ? '<div class="hardware-grid" style="margin-top:14px">' + components.map(function (component) {
        const item = component[2] ? s.readings[component[2]] : null;
        const control = component[2] && component[2] !== "BATTERY" ?
          '<button class="button" data-action="sensor-toggle" data-sensor="' + component[2] + '">' + (item.available ? "Disconnect" : "Reconnect") + '</button>' : "";
        return '<article class="hardware"><strong>' + component[0] + '</strong><span>' + component[1] + '</span>' +
          (item ? '<div class="small-meta">' + (item.available ? fmt(item.value, 1) + " " + escapeHtml(item.unit) : "No signal") + " · " + escapeHtml(item.status) + '</div>' : "") +
          '<div class="table-actions" style="margin-top:8px">' + (item ? badge(item.available ? item.status : "Offline") : '<span class="status system">Supporting component</span>') + control + '</div></article>';
      }).join("") + '</div><p class="small-meta">Last telemetry received: ' + escapeHtml(time(s.lastTelemetry)) + '</p>' +
      '<div class="status-line"><span>Battery condition</span><span>' + fmt(s.readings.BATTERY_PERCENT.value, 1) + '% · ' +
      fmt(s.readings.BATTERY.value, 2) + ' V · ' + fmt(s.readings.CURRENT.value, 2) + ' A · ' +
      fmt(s.readings.BATTERY.value * s.readings.CURRENT.value, 2) + ' W</span></div>' : "") +
      '</div></section><p class="disclaimer">All device status and readings on this page are simulated. No hardware connection is claimed.</p>';
  }

  function miners() {
    const s = state();
    const query = ui.minerSearch.trim().toLowerCase();
    const matches = ["MINER-001", "HELMET-001", "active"].some(function (word) { return word.toLowerCase().includes(query); });
    return header("Miners", "Anonymized participant roster for the simulated monitoring session.") +
      '<section class="panel"><div class="panel-head"><h2>Demo participants</h2><span>1 anonymized record</span></div><div class="panel-body">' +
      '<label class="field">Search participants<input id="miner-search" class="search" type="search" placeholder="Search ID, helmet, or status" value="' + escapeHtml(ui.minerSearch) + '"></label></div>' +
      (matches ? '<div class="table-wrap"><table><thead><tr><th>Participant ID</th><th>Assigned helmet</th><th>Monitoring status</th><th>Last communication</th><th>Latest heart rate</th><th>Battery</th></tr></thead><tbody><tr><td>MINER-001</td><td>HELMET-001</td><td>' +
        badge(s.deviceOnline ? "Normal" : "Offline") + '</td><td>' + escapeHtml(time(s.lastHeartbeat)) + '</td><td>' + reading("HR") + '</td><td>' + fmt(s.readings.BATTERY_PERCENT.value, 1) + '%</td></tr></tbody></table></div>' :
        '<div class="empty">No anonymized participant matches this search.</div>') + '</section>' +
      '<p class="disclaimer">Demo data only. No real personal or participant records are stored.</p>';
  }

  function alerts() {
    const s = state();
    const filtered = s.alerts.filter(function (item) {
      const f = ui.alertFilter;
      return (f.severity === "all" || item.severity.toLowerCase() === f.severity) &&
        (f.sensor === "all" || item.code === f.sensor) &&
        (!f.date || localDateKey(item.timestamp) === f.date) &&
        (!f.time || localTimeKey(item.timestamp) === f.time) &&
        (f.device === "all" || item.deviceId === f.device);
    });
    const sensorOptions = '<option value="all">All sensors</option>' + engine.config().map(function (sensor) {
      return '<option value="' + sensor.code + '"' + (ui.alertFilter.sensor === sensor.code ? " selected" : "") + '>' + escapeHtml(sensor.name) + '</option>';
    }).join("");
    const rows = filtered.map(function (item) {
      return '<div class="alert-row"><div>' + badge(item.severity) + '<div class="small-meta">' + escapeHtml(item.id) + '</div></div>' +
        '<div><strong>' + escapeHtml(item.sensor) + '</strong><div class="alert-detail">' + escapeHtml(item.description) + '</div>' +
        '<div class="alert-detail">' + escapeHtml(item.deviceId) + ' · ' + escapeHtml((typeof item.reading === "number" ? fmt(item.reading, 1) : item.reading) + " " + item.unit) +
        ' · threshold ' + escapeHtml(item.threshold) + ' · ' + escapeHtml(time(item.timestamp)) + '</div></div>' +
        '<div class="table-actions"><span class="status ' + (item.resolved ? "system" : item.acknowledged ? "normal" : "warning") + '">' +
        (item.resolved ? "Resolved" : item.acknowledged ? "Acknowledged" : "Unacknowledged") + '</span>' +
        (!item.acknowledged ? '<button class="button" data-action="ack" data-id="' + escapeHtml(item.id) + '">Acknowledge</button>' : "") +
        (!item.resolved ? '<button class="button" data-action="resolve" data-id="' + escapeHtml(item.id) + '">Resolve</button>' : "") + '</div></div>';
    }).join("");
    return header("Alerts", "Review simulated threshold and connectivity events. Thresholds are configurable demo parameters, not official exposure or medical limits.") +
      '<section class="panel"><div class="panel-head"><h2>Alert history</h2><span>' + filtered.length + ' matching · ' + s.alerts.filter(function (a) { return !a.resolved; }).length + ' active</span></div>' +
      '<div class="panel-body"><div class="form-row"><label class="field">Severity<select id="alert-severity"><option value="all">All severities</option>' +
      ["warning", "critical"].map(function (level) { return '<option value="' + level + '"' + (ui.alertFilter.severity === level ? " selected" : "") + '>' + level + '</option>'; }).join("") +
      '</select></label><label class="field">Sensor<select id="alert-sensor">' + sensorOptions + '</select></label>' +
      '<label class="field">Device<select id="alert-device"><option value="all">All devices</option><option value="HELMET-001"' + (ui.alertFilter.device === "HELMET-001" ? " selected" : "") + '>HELMET-001</option></select></label>' +
      '<label class="field">Date<input id="alert-date" type="date" value="' + escapeHtml(ui.alertFilter.date) + '"></label>' +
      '<label class="field">Time<input id="alert-time" type="time" value="' + escapeHtml(ui.alertFilter.time) + '"></label>' +
      '<button class="button" data-action="clear-alert-filters">Clear filters</button></div><div class="form-row" style="margin-top:14px">' +
      '<label class="field">Configure demo thresholds<select id="threshold-sensor">' + engine.config().filter(function (sensor) {
        return !["BATTERY", "CURRENT"].includes(sensor.code);
      }).map(function (sensor) {
        return '<option value="' + sensor.code + '"' + (ui.thresholdSensor === sensor.code ? " selected" : "") + '>' + escapeHtml(sensor.name) + '</option>';
      }).join("") + '</select></label>' +
      (function () {
        const selected = sensorByCode(ui.thresholdSensor) || sensorByCode("H2S");
        return '<label class="field">Warning (' + escapeHtml(selected.unit) + ')<input id="warning-threshold" type="number" step="any" value="' + selected.warning + '"></label>' +
          '<label class="field">Critical (' + escapeHtml(selected.unit) + ')<input id="critical-threshold" type="number" step="any" value="' + selected.critical + '"></label>';
      })() + '<button class="button" data-action="apply-threshold">Apply thresholds</button><span class="small-meta">Demonstration parameters only.</span></div></div>' +
      (rows || '<div class="empty">' + (s.alerts.length ? "No alerts match those filters." : "No alerts yet. Use demo controls to generate a warning or critical example.") + '</div>') +
      '</section><p class="disclaimer">Alert status reflects simulated data only. Do not use for real-world safety decisions.</p>';
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
    return header("Historical data", "Session telemetry generated by the mock sensor provider. Records remain available while this page session is open.") +
      '<section class="panel"><div class="panel-head"><h2>Telemetry records</h2><span>' + filtered.length + ' matching records · capped at 5,000</span></div>' +
      '<div class="panel-body"><div class="form-row"><label class="field">Sensor<select id="history-sensor"><option value="all">All sensors</option>' +
      engine.config().map(function (sensor) { return '<option value="' + sensor.code + '"' + (f.sensor === sensor.code ? " selected" : "") + '>' + escapeHtml(sensor.name) + '</option>'; }).join("") +
      '</select></label><label class="field">Status<select id="history-status"><option value="all">All statuses</option>' +
      ["normal", "warning", "critical", "offline"].map(function (status) { return '<option value="' + status + '"' + (f.status === status ? " selected" : "") + '>' + status + '</option>'; }).join("") +
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
    document.querySelector("#connection-text").textContent = state().deviceOnline ? "Device online" : "Device offline";
    document.querySelector(".dot").classList.toggle("offline", !state().deviceOnline);
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
    link.download = "minewatch-simulated-telemetry.csv";
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
      if (!ui.selectedSeries.length) ui.selectedSeries = ["HR"];
      render();
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    try {
      if (action === "pause") engine.pause();
      else if (action === "start") engine.start();
      else if (action === "reset") { engine.reset(); toast("Demo simulation reset."); }
      else if (action === "warning" || action === "critical") {
        const select = document.querySelector("#demo-sensor");
        engine.simulateAbnormal(action === "warning" ? "Warning" : "Critical", select ? select.value : "CO");
        toast("Simulated " + action + " reading generated.");
      } else if (action === "interval") {
        const input = document.querySelector("#interval");
        engine.setIntervalMs(Number(input.value) * 1000);
        toast("Simulation interval updated.");
      } else if (action === "device-toggle") engine.setDeviceOnline(!state().deviceOnline);
      else if (action === "toggle-details") { ui.deviceDetails = !ui.deviceDetails; render(); }
      else if (action === "sensor-toggle") {
        const code = button.dataset.sensor;
        engine.setSensorAvailable(code, !state().readings[code].available);
      } else if (action === "ack") engine.acknowledge(button.dataset.id);
      else if (action === "resolve") engine.resolve(button.dataset.id);
      else if (action === "apply-threshold") {
        engine.setThreshold(ui.thresholdSensor, document.querySelector("#warning-threshold").value, document.querySelector("#critical-threshold").value);
        toast("Demo thresholds updated.");
      }
      else if (action === "clear-alert-filters") {
        ui.alertFilter = { severity: "all", sensor: "all", date: "", time: "", device: "all" }; render();
      } else if (action === "clear-history-filters") {
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
