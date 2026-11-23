(function () {
  "use strict";

  const engine = window.MinewatchProvider;
  const app = document.querySelector("#app");
  const nav = document.querySelector("#nav");
  const clock = document.querySelector("#clock");
  const periods = {
    "5m": { label: "5m", duration: 5 * 60 * 1000 },
    "1h": { label: "1hr", duration: 60 * 60 * 1000 },
    "24h": { label: "24hrs", duration: 24 * 60 * 60 * 1000 },
    "7d": { label: "7days", duration: 7 * 24 * 60 * 60 * 1000 },
    "1mo": { label: "1month", duration: 30 * 24 * 60 * 60 * 1000 }
  };
  const gasLimits = [
    { code: "CH4", title: "MQ-4 · Methane (CH₄)", limit: 2500, percent: "0.25%" },
    { code: "CO", title: "MQ-7 · Carbon monoxide (CO)", limit: 50, percent: "0.005%" },
    { code: "CO2", title: "MG811 · Carbon dioxide (CO₂)", limit: 5000, percent: "0.50%" }
  ];
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
  function snapshotRange() {
    const s = state();
    return s.stableSince && s.lastHeartbeat
      ? time(s.stableSince) + " – " + time(s.lastHeartbeat)
      : "Waiting for first complete snapshot";
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
    const duration = (periods[period || ui.period] || periods["5m"]).duration;
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
      '</h3><span class="sensor-code">' + escapeHtml(sensor.short || sensor.code) + ' · ' + escapeHtml(sensor.code) + '</span></div>' + badge(item.status) +
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
      metric("Safety alerts", "Inactive", "Gas calibration required") +
      metric("Telemetry rows loaded", String(s.packets), "Most recent records from Supabase") + "</section>";
  }
  function metric(label, value, sub) {
    return '<article class="metric"><div class="metric-label">' + label + '</div><div class="metric-value">' + value +
      '</div><div class="metric-sub">' + escapeHtml(sub) + "</div></article>";
  }


  function gasReferencePanel() {
    return '<section class="panel reference-panel"><div class="panel-head"><h2>Gas concentration limits</h2><span>DENR DAO No. 97-30 · Rule 153(a)</span></div>' +
      '<div class="panel-body"><p class="reference-warning">The supplied Rule 153(a) limits are concentration values, not ADC thresholds or calibration factors. Live gas measurements remain raw ADC counts; no ppm conversion or gas-limit alert is made until each sensor is calibrated and validated.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Sensor / gas</th><th>Rule 153(a) limit</th><th>Equivalent concentration</th><th>Current dashboard use</th></tr></thead><tbody>' +
      gasLimits.map(function (gas) {
        return "<tr><td>" + escapeHtml(gas.title) + "</td><td>Not more than " + escapeHtml(gas.percent) + "</td><td>" +
          fmt(gas.limit) + " ppm</td><td>Reference only · calibration required</td></tr>";
      }).join("") +
      '</tbody></table></div><p class="small-meta">The Republic Act No. 7076 reference provides the small-scale mining policy context; the numerical gas limits shown here are from DENR Administrative Order No. 97-30, Rule 153(a), using the values supplied for this project. A zero ADC count is not evidence of zero gas. Confirm the rule’s applicability and averaging requirements with the responsible mine safety authority.</p></div></section>';
  }

  function alertChecks() {
    const s = state();
    const available = function (code) {
      const item = s.readings[code];
      return item && item.value != null && s.deviceOnline;
    };
    const heart = s.readings.HEART;
    return [
      {
        code: "HEART",
        title: "Pulse sensor · heart rate",
        value: heart && heart.value != null ? heart.value === 0 ? "No beat detected" : fmt(heart.value) + " bpm" : "No current reading",
        status: !available("HEART") ? "No data" : heart.value === 0 ? "No beat detected" : "Reference only",
        threshold: "Adult resting reference: 60–100 bpm.",
        basis: "This range is a resting reference, not an occupational or medical alert limit. Age, activity, sensor accuracy, and clinical context are not established by this dashboard."
      },
      ].concat(gasLimits.map(function (gas) {
        const item = s.readings[gas.code];
        const hasReading = available(gas.code);
        return {
          code: gas.code,
          title: gas.title,
          value: hasReading ? fmt(item.value) + " ADC counts" : "No current reading",
          status: hasReading ? "Calibration required" : "No data",
          threshold: "Rule 153(a) reference: not more than " + fmt(gas.limit) + " ppm (" + gas.percent + ").",
          basis: "The current value is raw ADC counts and cannot be compared directly with a ppm limit. No concentration alert is generated without sensor-specific calibration and validation."
        };
      }));
  }

  function alertSources() {
    const sources = [
      {
        code: "HEART",
        title: "Heart-rate reference",
        summary: "The supplied adult resting reference is 60–100 bpm. It is context only, not a medical assessment or work-safety threshold; heart rate changes with age, activity, and individual health."
      },
      {
        title: "Mine-air gas limits",
        summary: "The Rule 153(a) values supplied for this study are: carbon monoxide not more than 50 ppm, methane not more than 2,500 ppm, and carbon dioxide not more than 5,000 ppm. These concentration limits cannot be applied to raw ADC counts."
      }
    ];
    return '<section class="alert-source-section"><div class="toolbar"><h2 class="section-title">Threshold references and interpretation</h2></div><div class="alert-source-grid">' +
      sources.map(function (source) {
        return '<article class="panel alert-source"><div class="panel-head"><h2>' + escapeHtml(source.title) + '</h2></div><div class="panel-body"><p>' +
          escapeHtml(source.summary) + '</p></div></article>';
      }).join("") + '</div></section>';
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
    return header("Overview", "Live ESP32 gas and heart-rate telemetry from Supabase. The dashboard checks for new readings every " + s.intervalMs / 1000 + " seconds.") +
      '<div class="toolbar"><h2 class="section-title">System snapshot</h2><span class="demo-label">LIVE DATA – ESP32</span></div>' +
      metrics() + '<div class="content-grid"><section class="panel"><div class="panel-head"><h2>Latest telemetry</h2><span>' + escapeHtml(time(s.lastTelemetry)) + '</span></div>' +
      '<div class="panel-body sensor-grid">' + liveSensors().map(function (sensor) { return sensorCard(sensor, false); }).join("") + '</div></section>' +
      '<section class="panel"><div class="panel-head"><h2>Connection status</h2><span>HELMET-001</span></div>' +
      '<div class="status-line"><span>Database connection</span>' + badge(s.connectionStatus === "connected" ? "Connected" : s.connectionStatus) + '</div>' +
      '<div class="status-line"><span>Telemetry freshness</span>' + badge(s.deviceOnline ? "Recent" : "Stale / none") + '</div>' +
      '<div class="status-line"><span>Last telemetry received</span><span>' + escapeHtml(time(s.lastHeartbeat)) + '</span></div>' +
      '<div class="status-line"><span>Current values unchanged</span><span>' + escapeHtml(snapshotRange()) + '</span></div>' +
      '<div class="status-line"><span>Data source</span><span>ESP32 · Supabase</span></div>' +
      '<div class="status-line"><span>Battery readings</span><span>Not sent by current firmware</span></div>' +
      '<div class="status-line"><span>Safety alerts</span><span>Gas calibration required before ppm alerting</span></div></section></div>' + gasReferencePanel() +
      '<div class="split">' + liveControls() + '<section class="panel"><div class="panel-head"><h2>Helmet details</h2><span>A.R.G.O.S. Helmet 001</span></div>' +
      '<div class="status-line"><span>Helmet ID</span><span>HELMET-001</span></div>' +
      '<div class="status-line"><span>Participant</span><span>MINER-001 · anonymized</span></div>' +
      '<div class="status-line"><span>Connection / firmware</span><span>Wi-Fi · firmware not reported</span></div>' +
      '<div class="status-line"><span>ADC</span><span>ESP32 built-in ADC · raw counts</span></div>' +
      '<div class="status-line"><span>Heart rate</span><span>' + reading("HEART") + '</span></div>' +
      '<p class="disclaimer">Gas readings are raw ADC counts, not calibrated concentrations. Heart-rate values are informational only, not medical measurements. This is not a certified safety system.</p></section></div>';
  }

  function monitoring() {
    const config = engine.config();
    const s = state();
    return header("Live monitoring", "ESP32 gas and heart-rate readings retrieved from Supabase. Gas values are raw, uncalibrated measurements.") +
      '<div class="toolbar"><h2 class="section-title">Environmental and biometric monitoring</h2><span class="demo-label">LIVE DATA – ESP32</span></div>' +
      '<div class="sensor-grid">' + config.map(function (sensor) { return sensorCard(sensor, true); }).join("") + '</div>' +
      gasReferencePanel() +
      '<div class="toolbar" style="margin-top:22px"><h2 class="section-title">Other telemetry</h2></div>' +
      '<section class="panel"><div class="status-line"><span>Heart rate</span><span>Shown above when a recent pulse is detected</span></div>' +
      '<div class="status-line"><span>Battery voltage / current / charge</span><span>Not sent by current ESP32 firmware</span></div>' +
      '<div class="status-line"><span>ADS1115</span><span>Not used; these pins use the ESP32 built-in ADC</span></div></section>' +
      '<section class="panel" style="margin-top:14px"><div class="panel-head"><h2>Combined historical trend</h2><span>Last ' + escapeHtml(ui.period) + '</span></div><div class="panel-body">' +
      '<div class="form-row"><div class="tab-row">' + Object.keys(periods).map(function (period) {
        return '<button class="button ' + (ui.period === period ? "selected" : "") + '" data-period="' + period + '">' + periods[period].label + '</button>';
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
      '<div class="status-line"><span>Heart rate</span><span>Pulse sensor · GPIO 32 · bpm when detected</span></div>' +
      '<p class="disclaimer">Gas modules require calibration before interpreting readings as concentration. Pulse readings are informational only, not medical measurements.</p></section></div>';
  }

  function devices() {
    const s = state();
    const components = [
      ["MQ-4", "Methane sensor · raw ADC counts", "CH4"], ["MQ-7", "Carbon monoxide sensor · raw ADC counts", "CO"],
      ["MG811", "Carbon dioxide sensor · raw ADC counts", "CO2"],
      ["Pulse sensor", "Heart rate · GPIO 32", "HEART"], ["ADS1115", "Not used; ESP32 built-in ADC is used", null],
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
          (item ? '<div class="small-meta">' + reading(component[2]) + '</div>' + badge(item.status) : '<div class="small-meta">No live reading configured</div>') + '</article>';
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
        badge(s.deviceOnline ? "Recent" : "Stale / none") + '</td><td>' + escapeHtml(time(s.lastHeartbeat)) + '</td><td>' + reading("HEART") + '</td><td>Not reported</td></tr></tbody></table></div>' :
        '<div class="empty">No anonymized participant matches this search.</div>') + '</section>' +
      '<p class="disclaimer">MINER-001 is an anonymized demo label. Heart-rate values are informational only, not medical measurements; battery telemetry is not uploaded.</p>';
  }

  function alerts() {
    const s = state();
    return header("Alerts", "Sensor readings, Rule 153(a) concentration references, and calibration status.") +
      '<section class="panel"><div class="panel-head"><h2>Current sensor status</h2><span>Checked ' + escapeHtml(time(s.lastCheckedAt)) + '</span></div>' +
      '<div class="alert-check-grid">' + alertChecks().map(function (item) {
        return '<article class="alert-check"><div class="alert-check-head"><div><h3>' + escapeHtml(item.title) + '</h3><span>' + escapeHtml(item.value) + '</span></div>' +
          badge(item.status) + '</div><p><strong>Criteria:</strong> ' + escapeHtml(item.threshold) + '</p><p class="small-meta">' +
          escapeHtml(item.basis) + '</p></article>';
      }).join("") + '</div></section>' + previousAlerts() + alertSources() +
      '<p class="disclaimer"></p>';
  }

  function previousAlerts() {
    return '<section class="panel ml-history"><div class="panel-head"><h2>Previous alerts</h2><span>Validated records only</span></div>' +
      '<div class="table-wrap"><table class="ml-history-table"><thead><tr><th>Date and time</th><th>Sensor</th><th>Measured concentration</th><th>Applicable limit</th><th>Event</th></tr></thead><tbody>' +
      '<tr><td colspan="5"><div class="empty">No validated gas-alert records are available. Historical gas data contains raw ADC counts, which cannot be compared with the ppm limits until sensor-specific calibration is completed.</div></td></tr>' +
      '</tbody></table></div></section>';
  }

  function forecastForSensor(sensor) {
    const records = state().history.filter(function (record) {
      return record.sensorCode === sensor.code &&
        record.source === "ESP32" &&
        Number.isFinite(Number(record.value)) &&
        !Number.isNaN(Date.parse(record.timestamp));
    }).map(function (record) {
      return { timestamp: Date.parse(record.timestamp), value: Number(record.value) };
    }).sort(function (a, b) { return a.timestamp - b.timestamp; });
    if (!records.length) return { reason: "No saved ESP32 readings are available." };

    const latestTime = records[records.length - 1].timestamp;
    const windowStart = latestTime - 6 * 60 * 60 * 1000;
    const samples = records.filter(function (record) { return record.timestamp >= windowStart; }).slice(-180);
    const spanMs = samples[samples.length - 1].timestamp - samples[0].timestamp;
    if (samples.length < 8 || spanMs < 30 * 60 * 1000) {
      return {
        reason: "A forecast needs at least 8 real readings spanning 30 minutes; " +
          samples.length + " readings across " + Math.floor(spanMs / 60000) + " minutes are available.",
        count: samples.length
      };
    }

    const origin = samples[0].timestamp;
    const points = samples.map(function (sample) {
      return { x: (sample.timestamp - origin) / 3600000, y: sample.value };
    });
    const meanX = points.reduce(function (sum, point) { return sum + point.x; }, 0) / points.length;
    const meanY = points.reduce(function (sum, point) { return sum + point.y; }, 0) / points.length;
    const sxx = points.reduce(function (sum, point) { return sum + Math.pow(point.x - meanX, 2); }, 0);
    if (sxx === 0) return { reason: "The saved readings do not span enough time to fit a trend.", count: samples.length };

    const slope = points.reduce(function (sum, point) {
      return sum + (point.x - meanX) * (point.y - meanY);
    }, 0) / sxx;
    const intercept = meanY - slope * meanX;
    const residualSumSquares = points.reduce(function (sum, point) {
      return sum + Math.pow(point.y - (intercept + slope * point.x), 2);
    }, 0);
    const residualError = Math.sqrt(residualSumSquares / (points.length - 2));
    const resolution = sensor.code === "HEART" ? 1 : 4;
    const standardError = Math.max(residualError, resolution);
    const degreesFreedom = points.length - 2;
    const z70 = 1.036433389;
    const t70 = z70 +
      (Math.pow(z70, 3) + z70) / (4 * degreesFreedom) +
      (5 * Math.pow(z70, 5) + 16 * Math.pow(z70, 3) + 3 * z70) / (96 * Math.pow(degreesFreedom, 2)) +
      (3 * Math.pow(z70, 7) + 19 * Math.pow(z70, 5) + 17 * Math.pow(z70, 3) - 15 * z70) /
        (384 * Math.pow(degreesFreedom, 3));
    const forecastPoints = [];
    for (let minute = 0; minute <= 60; minute += 15) {
      const x = (latestTime + minute * 60000 - origin) / 3600000;
      const leverage = Math.sqrt(1 + 1 / points.length + Math.pow(x - meanX, 2) / sxx);
      const predicted = intercept + slope * x;
      const margin = t70 * standardError * leverage;
      forecastPoints.push({
        timestamp: latestTime + minute * 60000,
        value: predicted,
        lower: predicted - margin,
        upper: predicted + margin
      });
    }

    return {
      samples: samples,
      points: points,
      forecastPoints: forecastPoints,
      latestTime: latestTime,
      count: samples.length,
      spanMinutes: Math.round(spanMs / 60000),
      unit: sensor.code === "HEART" ? "bpm" : "ADC counts",
      dataSource: state().deviceOnline && state().readings[sensor.code] &&
        state().readings[sensor.code].value != null
        ? "Recent ESP32 readings"
        : "Most recent saved ESP32 readings"
    };
  }

  function forecastChart(sensor, forecast) {
    if (!forecast.forecastPoints) {
      return '<div class="empty forecast-empty">' + escapeHtml(forecast.reason) + '</div>';
    }

    const width = 620;
    const height = 220;
    const left = 58;
    const right = 602;
    const top = 18;
    const bottom = 174;
    const firstTime = forecast.samples[0].timestamp;
    const lastTime = forecast.latestTime + 60 * 60 * 1000;
    const values = forecast.points.map(function (point) { return point.y; }).concat(
      forecast.forecastPoints.reduce(function (all, point) {
        all.push(point.lower, point.upper);
        return all;
      }, [])
    );
    const minValue = Math.min.apply(null, values);
    const maxValue = Math.max.apply(null, values);
    const padding = Math.max((maxValue - minValue) * .1, sensor.code === "HEART" ? 2 : 8);
    const min = minValue - padding;
    const max = maxValue + padding;
    const x = function (timestamp) {
      return left + (timestamp - firstTime) / (lastTime - firstTime) * (right - left);
    };
    const y = function (value) {
      return bottom - (value - min) / (max - min) * (bottom - top);
    };
    const historicalPath = "M " + forecast.points.map(function (point) {
      return x(firstTime + point.x * 3600000).toFixed(1) + " " + y(point.y).toFixed(1);
    }).join(" L ");
    const upperPath = forecast.forecastPoints.map(function (point) {
      return x(point.timestamp).toFixed(1) + " " + y(point.upper).toFixed(1);
    });
    const lowerPath = forecast.forecastPoints.slice().reverse().map(function (point) {
      return x(point.timestamp).toFixed(1) + " " + y(point.lower).toFixed(1);
    });
    const predictionPath = "M " + forecast.forecastPoints.map(function (point) {
      return x(point.timestamp).toFixed(1) + " " + y(point.value).toFixed(1);
    }).join(" L ");
    const bandPath = "M " + upperPath.concat(lowerPath).join(" L ") + " Z";
    const latestX = x(forecast.latestTime).toFixed(1);
    const endX = x(lastTime).toFixed(1);

    return '<svg class="forecast-chart" viewBox="0 0 ' + width + " " + height +
      '" role="img" aria-label="One-hour ' + escapeHtml(sensor.name) + ' trend forecast with an approximate 70 percent prediction interval">' +
      '<path class="forecast-gridlines" d="M' + left + " " + top + "H" + right + " M" + left + " " +
      ((top + bottom) / 2) + "H" + right + " M" + left + " " + bottom + "H" + right + '"></path>' +
      '<path class="forecast-band" d="' + bandPath + '"></path>' +
      '<path class="forecast-history-line" d="' + historicalPath + '"></path>' +
      '<path class="forecast-line" d="' + predictionPath + '"></path>' +
      '<path class="forecast-now" d="M' + latestX + " " + top + "V" + bottom + '"></path>' +
      '<text class="forecast-axis-label" x="' + left + '" y="196">' + escapeHtml(shortTime(firstTime)) + '</text>' +
      '<text class="forecast-axis-label" x="' + latestX + '" y="196" text-anchor="middle">Latest</text>' +
      '<text class="forecast-axis-label" x="' + endX + '" y="196" text-anchor="end">+1 hour</text>' +
      '<text class="forecast-value-label" x="4" y="' + (top + 4) + '">' + escapeHtml(fmt(maxValue, 1)) + '</text>' +
      '<text class="forecast-value-label" x="4" y="' + bottom + '">' + escapeHtml(fmt(minValue, 1)) + '</text></svg>';
  }

  function predictionForecastPanel() {
    const sensors = liveSensors();
    return '<section class="panel prediction-forecast"><div class="panel-head"><h2>One-hour sensor trend forecast</h2><span>70% prediction interval · real ESP32 data only</span></div>' +
      '<div class="panel-body"><p class="small-meta forecast-explainer">Dashed line separates history from a linear trend estimate; the shaded band is an approximate 70% prediction interval under a residual-error model. This interval is not a 70% probability that the forecast is correct. Gas charts show raw ADC counts, not ppm or safety classifications. When live data is unavailable, the forecast uses the latest saved ESP32 readings only.</p>' +
      '<div class="forecast-grid">' + sensors.map(function (sensor) {
        const forecast = forecastForSensor(sensor);
        return '<article class="forecast-card"><div class="forecast-card-head"><strong>' + escapeHtml(sensor.name) +
          '</strong><span>' + (forecast.forecastPoints
            ? escapeHtml(forecast.count + " real readings · " + forecast.spanMinutes + " min span · " + forecast.dataSource)
            : "Forecast unavailable") + '</span></div>' + forecastChart(sensor, forecast) +
          (forecast.forecastPoints ? '<div class="forecast-legend"><span class="legend-history">Observed</span><span class="legend-prediction">Forecast</span><span class="legend-interval">70% interval</span></div>' : "") +
          '</article>';
      }).join("") + '</div></div></section>';
  }

  function sensorAnalysis() {
    const s = state();
    const definitions = liveSensors();
    const rows = definitions.map(function (sensor) {
      const current = s.readings[sensor.code];
      const records = s.history.filter(function (record) {
        return record.sensorCode === sensor.code && Number.isFinite(Number(record.value));
      }).slice().sort(function (a, b) { return Date.parse(b.timestamp) - Date.parse(a.timestamp); });
      const latest = current && current.value != null
        ? Number(current.value)
        : records.length ? Number(records[0].value) : null;
      const previous = records.length > 1 ? Number(records[1].value) : null;
      const unit = sensor.code === "HEART" ? "bpm" : "ADC counts";
      const interpretation = sensor.code === "HEART"
        ? "Informational; adult resting reference is 60–100 bpm"
        : "Raw signal; concentration calibration required";
      const change = latest == null || previous == null ? "Not available" :
        (latest - previous > 0 ? "+" : "") + fmt(latest - previous) + " " + unit;
      return "<tr><td>" + escapeHtml(sensor.name) + "</td><td>" +
        (previous == null ? "Not available" : fmt(previous) + " " + unit) + "</td><td>" +
        (latest == null ? "No reading" : fmt(latest) + " " + unit) + "</td><td>" +
        escapeHtml(change) + "</td><td>" + escapeHtml(interpretation) + "</td></tr>";
    }).join("");

    return header("Sensor analysis", "Historical sensor trends and one-hour estimates based on recorded telemetry.") +
      '<div class="notice ml-notice"><strong>Measurement status:</strong> Gas channels are raw ADC counts. The Rule 153(a) limits are in ppm and cannot be evaluated until the MQ-4, MQ-7, and MG811 are calibrated and validated individually. Heart-rate values are informational only.</div>' +
      '<section class="panel ml-data-panel"><div class="panel-head"><h2>Latest sensor readings</h2><span>From ESP32 telemetry</span></div>' +
      '<div class="table-wrap"><table class="ml-table"><thead><tr><th>Sensor</th><th>Previous saved reading</th><th>Latest loaded reading</th><th>Change</th><th>Interpretation</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5">No sensor channels are configured.</td></tr>') + '</tbody></table></div></section>' +
      predictionForecastPanel() +
      '<section class="panel ml-history"><div class="panel-head"><h2>Warning-to-critical history</h2><span>Validated alert events only</span></div>' +
      '<div class="table-wrap"><table class="ml-history-table"><thead><tr><th>Date and time</th><th>Sensor</th><th>Measured value</th><th>Status change</th><th>Source</th></tr></thead><tbody>' +
      '<tr><td colspan="5"><div class="empty">No validated warning-to-critical events are available. Historical gas readings are raw ADC counts and cannot be classified against ppm limits.</div></td></tr>' +
      '</tbody></table></div></section>' +
      '<section class="panel ml-explainer"><div class="panel-head"><h2>Calibration requirements</h2><span>Before concentration alerting</span></div><div class="panel-body">' +
      '<p>For each gas sensor, document the exact sensor/module, load resistance, supply and ADC settings, calculate sensor resistance and Rs/R0 from measured voltage, and fit or validate a sensor-specific response against known reference concentrations. MQ-7 heater operation and the MG811 response require their own verification.</p>' +
      '<p>Only validated concentration readings should be compared with the Rule 153(a) limits. Existing ADC history must not be relabeled as ppm.</p></div></section>';
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
        escapeHtml(time(item.lastSeenAt || item.timestamp)) + "</td><td>" +
        escapeHtml(item.deviceId) + "</td><td>" + escapeHtml(item.sensorCode) + "</td><td>" + escapeHtml(fmt(item.value, 2)) +
        "</td><td>" + escapeHtml(item.unit) + "</td><td>" + badge(item.status) + '</td><td class="demo-label">' + item.source + "</td></tr>";
    }).join("");
    return header("Historical data", "ESP32 sensor records queried from Supabase. Each refresh loads the newest records available to this public dashboard.") +
      '<section class="panel"><div class="panel-head"><h2>Telemetry records</h2><span>' + filtered.length + ' matching of the newest 5,000 rows loaded from Supabase</span></div>' +
      '<div class="panel-body"><div class="form-row"><label class="field">Sensor<select id="history-sensor"><option value="all">All sensors</option>' +
      engine.config().map(function (sensor) { return '<option value="' + sensor.code + '"' + (f.sensor === sensor.code ? " selected" : "") + '>' + escapeHtml(sensor.name) + '</option>'; }).join("") +
      '</select></label><label class="field">Status<select id="history-status"><option value="all">All statuses</option>' +
      ["not calibrated", "measured", "no beat detected", "stale", "no data"].map(function (status) { return '<option value="' + status + '"' + (f.status === status ? " selected" : "") + '>' + status + '</option>'; }).join("") +
      '</select></label><label class="field">Device<select id="history-device"><option value="all">All devices</option><option value="HELMET-001"' + (f.device === "HELMET-001" ? " selected" : "") + '>HELMET-001</option></select></label>' +
      '<label class="field">Date<input id="history-date" type="date" value="' + escapeHtml(f.date) + '"></label>' +
      '<label class="field">Time<input id="history-time" type="time" value="' + escapeHtml(f.time) + '"></label>' +
      '<button class="button" data-action="clear-history-filters">Clear filters</button><button class="button primary" data-action="export">Export CSV</button></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Record ID</th><th>Snapshot started</th><th>Last confirmed unchanged</th><th>Device</th><th>Sensor</th><th>Value</th><th>Unit</th><th>Status</th><th>Source</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="9">No telemetry matches the selected filters.</td></tr>') + '</tbody></table></div>' +
      '<div class="pagination"><span>Page ' + (ui.historyPage + 1) + ' of ' + pages + '</span><div class="controls"><button class="button" data-action="history-prev" ' +
      (ui.historyPage === 0 ? "disabled" : "") + '>Previous</button><button class="button" data-action="history-next" ' +
      (ui.historyPage >= pages - 1 ? "disabled" : "") + '>Next</button></div></div></section>' +
      '<section class="panel" style="margin-top:12px"><div class="panel-head"><h2>Historical sensor trend</h2><span>Last ' + ui.period + '</span></div><div class="panel-body">' +
      '<div class="tab-row">' + Object.keys(periods).map(function (period) { return '<button class="button ' + (ui.period === period ? "selected" : "") + '" data-period="' + period + '">' + periods[period].label + '</button>'; }).join("") + '</div>' +
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
    const pages = { overview: overview, monitoring: monitoring, devices: devices, miners: miners, alerts: alerts, "ml-predictions": sensorAnalysis, history: history };
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
    const headers = ["Record ID", "Device ID", "Sensor code", "Value", "Unit", "Status", "Snapshot started", "Last confirmed unchanged", "Data source"];
    const csv = [headers].concat(rows.map(function (r) {
      return [r.id, r.deviceId, r.sensorCode, r.value, r.unit, r.status, r.timestamp, r.lastSeenAt || r.timestamp, r.source];
    })).map(function (row) {
      return row.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "argos-esp32-telemetry.csv";
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
