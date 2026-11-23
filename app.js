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
      metric("Active alerts", "--", "Latest checks only; not stored") +
      metric("Telemetry rows loaded", String(s.packets), "Most recent records from Supabase") + "</section>";
  }
  function metric(label, value, sub) {
    return '<article class="metric"><div class="metric-label">' + label + '</div><div class="metric-value">' + value +
      '</div><div class="metric-sub">' + escapeHtml(sub) + "</div></article>";
  }


  function gasReferencePanel() {
    const references = [
      ["MQ-4 · Methane (CH₄)", "1.0% / 10,000 ppm (20% LEL)", "Immediate action threshold", "Provisional ADC comparison on Alerts."],
      ["MQ-7 · Carbon monoxide (CO)", "25–50 ppm", "8-hour exposure guidance", "Provisional ADC comparison on Alerts."],
      ["MG811 · Carbon dioxide (CO₂)", "5,000 ppm / 0.50%", "8-hour exposure limit", "Provisional ADC comparison on Alerts."]
    ];
    return '<section class="panel reference-panel"><div class="panel-head"><h2>Gas concentration references</h2><span>Uncalibrated · provisional checks on Alerts</span></div>' +
      '<div class="panel-body"><p class="reference-warning">These are concentration references, not calibrated sensor limits. The Alerts page shows provisional ADC-count comparisons based on explicit linear-scale assumptions; validate the sensor response before relying on them.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Sensor / gas</th><th>Reference provided</th><th>Averaging period</th><th>Use in dashboard</th></tr></thead><tbody>' +
      references.map(function (row) {
        return "<tr><td>" + escapeHtml(row[0]) + "</td><td>" + escapeHtml(row[1]) + "</td><td>" + escapeHtml(row[2]) + "</td><td>" + escapeHtml(row[3]) + "</td></tr>";
      }).join("") +
      '</tbody></table></div><p class="small-meta">All live readings remain raw ADC counts and are marked NOT CALIBRATED. ADC = 0 does not mean zero gas. Real-time readings are not occupational exposure averages.</p></div></section>';
  }

  function alertChecks() {
    const s = state();
    const available = function (code) {
      const item = s.readings[code];
      return item && item.value != null && s.deviceOnline;
    };
    const heart = s.readings.HEART;
    const heartStatus = !available("HEART") || heart.value === 0 ? "No data" :
      heart.value > 140 ? "Critical" : heart.value >= 130 ? "Warning" :
      heart.value < 60 ? "Review" : "Normal";
    const gasStatus = function (code, warning, critical) {
      if (!available(code)) return "No data";
      const value = Number(s.readings[code].value);
      return value >= critical ? "Critical" : value >= warning ? "Warning" : "Normal";
    };
    return [
      {
        code: "HEART",
        title: "Pulse sensor · heart rate",
        value: heart && heart.value != null ? heart.value === 0 ? "No beat detected" : fmt(heart.value) + " bpm" : "No current reading",
        status: heartStatus,
        threshold: "Review at ≥130 bpm; high at >140 bpm; <60 bpm needs active-work confirmation.",
        basis: "A single current reading cannot establish a full-shift sustained rate. Age-predicted maximum (220 − age) and whether the miner is active are not available in telemetry."
      },
      {
        code: "CH4",
        title: "MQ-4 · methane",
        value: available("CH4") ? fmt(s.readings.CH4.value) + " ADC counts (" + fmt(s.readings.CH4.value / 3600 * 100, 1) + "% of tested max)" : "No current reading",
        status: gasStatus("CH4", 720, 900),
        threshold: "Warning: 720 counts (20%); critical: 900 counts (25%); evacuation reference: 1,800 counts (50%) of tested max 3,600.",
        basis: "Provisional linear scaling assumes the 3,600-count maximum represents 5% methane by volume (100% LEL). This relationship has not been calibrated."
      },
      {
        code: "CO",
        title: "MQ-7 · carbon monoxide",
        value: available("CO") ? fmt(s.readings.CO.value) + " ADC counts (" + fmt(s.readings.CO.value / 3200 * 100, 1) + "% of tested max)" : "No current reading",
        status: gasStatus("CO", 200, 400),
        threshold: "Warning: 200 counts (6.25%); critical: 400 counts (12.5%) of tested max 3,200.",
        basis: "Provisional linear scaling assumes 3,200 counts represents 400 ppm, the upper endpoint shown in the supplied effects table. 25–50 ppm exposure limits are time-weighted; this dashboard cannot calculate an 8-hour average."
      },
      {
        code: "CO2",
        title: "MG811 · carbon dioxide",
        value: available("CO2") ? fmt(s.readings.CO2.value) + " ADC counts (" + fmt(s.readings.CO2.value / 2200 * 100, 1) + "% of tested max)" : "No current reading",
        status: gasStatus("CO2", 275, 275),
        threshold: "Alert: 275 counts (12.5%) of tested max 2,200.",
        basis: "Provisional linear scaling assumes 2,200 counts represents 40,000 ppm, the upper endpoint shown in the supplied effects table. The cited 5,000 ppm limit is an 8-hour exposure limit."
      }
    ];
  }

  function alertSources() {
    const sources = [
      {
        code: "HEART",
        title: "Heart-rate alert basis",
        summary: "Review sustained rates around 130–140 bpm, age-predicted maximum (220 − age), and a pulse below 60 bpm while active. This prototype lacks miner age, activity state, and full-shift exposure data.",
        links: [
          ["American Heart Association · Target heart rates", "https://www.heart.org/en/healthy-living/exercise-and-physical-activity/fitness-basics/target-heart-rates"],
          ["JIO M Nepal · supplied reference", "https://jiomnepal.edu.np/index.php/jiomnepal/article/download/497/476/944"],
          ["Medanta · Normal vs dangerous heart rate", "https://www.medanta.org/patient-education-blog/normal-vs-dangerous-heart-rate"],
          ["Cleveland Clinic · Heart rate", "https://my.clevelandclinic.org/health/diagnostics/heart-rate"]
        ]
      },
      {
        code: "CH4",
        title: "Methane alert basis",
        summary: "Near-zero is the expected normal tunnel reading; 1.0% by volume (20% LEL) is an action threshold, with higher concentrations requiring shutdown or evacuation under the applicable mine plan.",
        links: [
          ["CDC/NIOSH · Methane control", "https://www.cdc.gov/niosh/engcontrols/ecd/detail156.html"],
          ["Industrial Scientific · Gas levels in confined spaces", "https://www.indsci.com/en/blog/acceptable-and-dangerous-gas-levels-in-confined-spaces"],
          ["Queensland Government · Methane management in underground coal mines", "https://www.resources.qld.gov.au/__data/assets/pdf_file/0004/1449121/methane-management-in-underground-coal-mines.pdf"],
          ["MineARC · Methane hazards", "https://minearc.com/methane-health-and-safety-hazards-fact-sheet/"]
        ]
      },
      {
        code: "CO",
        title: "Carbon monoxide alert basis",
        summary: "The supplied guidance identifies 25–50 ppm over an 8-hour shift as unsafe and 0–9 ppm as a desirable background. The dashboard does not calculate time-weighted exposure.",
        links: [
          ["OSHA · Carbon monoxide chemical data", "https://www.osha.gov/chemicaldata/462"],
          ["MSHA · Carbon Monoxide & Mining", "https://www.msha.gov/sites/default/files/Alerts%20and%20Hazards/HH%20Cards/HH-28%20Carbon%20Monoxide%20&%20Mining.pdf"],
          ["CO2Meter · Carbon monoxide levels chart", "https://www.co2meter.com/blogs/news/carbon-monoxide-levels-chart"],
          ["WV Law · Carbon monoxide and mining", "https://www.wvlaw.net/2015/04/17/a-coal-miners-silent-killer-carbon-monoxide/"],
          ["Worksite Med · Carbon monoxide safety", "https://worksitemed.com/protect-your-team-from-carbon-monoxide/"]
        ]
      },
      {
        code: "CO2",
        title: "Carbon dioxide alert basis",
        summary: "5,000 ppm (0.5%) is the supplied 8-hour limit; a well-ventilated tunnel is ideally below 2,500 ppm. The dashboard does not calculate time-weighted exposure.",
        links: [
          ["OSHA · Carbon dioxide chemical data", "https://www.osha.gov/chemicaldata/183"],
          ["NIOSH · Pocket Guide to Chemical Hazards", "https://www.cdc.gov/niosh/npg/npgd0103.html"],
          ["CDC Stacks · supplied reference", "https://stacks.cdc.gov/view/cdc/206362/cdc_206362_DS1.pdf"],
          ["WestAir Gases · CO₂ levels", "https://westairgases.com/blog/what-co2-level-is-dangerous/"]
        ]
      }
    ];
    return '<section class="alert-source-section"><div class="toolbar"><h2 class="section-title">Sources and basis for alert criteria</h2></div><div class="alert-source-grid">' +
      sources.map(function (source) {
        return '<article class="panel alert-source"><div class="panel-head"><h2>' + escapeHtml(source.title) + '</h2></div><div class="panel-body"><p>' +
          escapeHtml(source.summary) + '</p><ul>' + source.links.map(function (link) {
            return '<li><a href="' + escapeHtml(link[1]) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(link[0]) + '</a></li>';
          }).join("") + '</ul></div></article>';
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
      '<div class="status-line"><span>Alerts</span><span>Latest-reading checks only · not stored</span></div></section></div>' + gasReferencePanel() +
      '<div class="split">' + liveControls() + '<section class="panel"><div class="panel-head"><h2>Helmet details</h2><span>Minewatch Helmet 001</span></div>' +
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
    return header("Alerts", "Latest sensor readings compared with provisional criteria.") +
      '<section class="panel"><div class="panel-head"><h2>Latest reading checks</h2><span>Checked ' + escapeHtml(time(s.lastCheckedAt)) + '</span></div>' +
      '<div class="alert-check-grid">' + alertChecks().map(function (item) {
        return '<article class="alert-check"><div class="alert-check-head"><div><h3>' + escapeHtml(item.title) + '</h3><span>' + escapeHtml(item.value) + '</span></div>' +
          badge(item.status) + '</div><p><strong>Criteria:</strong> ' + escapeHtml(item.threshold) + '</p><p class="small-meta">' +
          escapeHtml(item.basis) + '</p></article>';
      }).join("") + '</div></section>' + previousAlerts() + alertSources() +
      '<p class="disclaimer"></p>';
  }

  function previousAlerts() {
    const definitions = [
      { code: "CH4", title: "Methane · MQ-4", unit: "ADC counts", warning: 720, critical: 900 },
      { code: "CO", title: "Carbon monoxide · MQ-7", unit: "ADC counts", warning: 200, critical: 400 },
      { code: "CO2", title: "Carbon dioxide · MG811", unit: "ADC counts", warning: 275, critical: 275 },
      { code: "HEART", title: "Heart rate · pulse sensor", unit: "bpm", warning: 130, critical: 140 }
    ];
    const records = state().history;
    const events = [];

    definitions.forEach(function (definition) {
      const sensorRecords = records.filter(function (record) {
        return record.sensorCode === definition.code &&
          Number.isFinite(Number(record.value)) &&
          !Number.isNaN(Date.parse(record.timestamp));
      }).slice().sort(function (a, b) {
        return Date.parse(a.timestamp) - Date.parse(b.timestamp);
      });
      let previousStatus = null;

      sensorRecords.forEach(function (record) {
        const value = Number(record.value);
        let status = "Normal";
        if (definition.code === "HEART") {
          if (value === 0) status = "No beat";
          else if (value > definition.critical) status = "Critical";
          else if (value >= definition.warning) status = "Warning";
          else if (value < 60) status = "Review";
        } else if (value >= definition.critical) {
          status = "Critical";
        } else if (value >= definition.warning) {
          status = "Warning";
        }

        if (status === "Critical" && previousStatus !== "Critical") {
          events.push({
            timestamp: record.timestamp,
            sensor: definition.title,
            reading: fmt(value) + " " + definition.unit,
            status: status,
            event: previousStatus === "Warning" ? "Escalated from Warning" :
              previousStatus === null ? "First observed at Critical" : "Critical threshold crossed"
          });
        } else if (status === "Warning" && previousStatus !== "Warning" && previousStatus !== "Critical") {
          events.push({
            timestamp: record.timestamp,
            sensor: definition.title,
            reading: fmt(value) + " " + definition.unit,
            status: status,
            event: previousStatus === null ? "First observed at Warning" : "Warning threshold crossed"
          });
        } else if (status === "Review" && previousStatus !== "Review") {
          events.push({
            timestamp: record.timestamp,
            sensor: definition.title,
            reading: fmt(value) + " " + definition.unit,
            status: status,
            event: previousStatus === null ? "First observed at Review" : "Review threshold crossed"
          });
        }
        previousStatus = status;
      });
    });

    events.sort(function (a, b) { return Date.parse(b.timestamp) - Date.parse(a.timestamp); });
    const rows = events.length
      ? events.slice(0, 100).map(function (event) {
        return '<tr><td>' + escapeHtml(time(event.timestamp)) + '</td><td>' + escapeHtml(event.sensor) +
          '</td><td>' + escapeHtml(event.reading) + '</td><td>' + badge(event.status) +
          '</td><td>' + escapeHtml(event.event) + '</td></tr>';
      }).join("")
      : '<tr><td colspan="5"><div class="empty">No threshold crossings found in the loaded telemetry history.</div></td></tr>';

    return '<section class="panel ml-history"><div class="panel-head"><h2>Previous alerts</h2><span>Derived from loaded telemetry · newest 100</span></div>' +
      '<div class="table-wrap"><table class="ml-history-table"><thead><tr><th>Date and time</th><th>Sensor</th><th>Reading</th><th>Status</th><th>Event</th></tr></thead><tbody>' +
      rows + '</tbody></table></div><div class="panel-body"><p class="small-meta">These threshold crossings are reconstructed from the loaded sensor history; they are not saved alert records. Initial elevated readings are marked as first observed.</p></div></section>';
  }

  function mlScenario() {
    const definitions = [
      { code: "CH4", title: "Methane · MQ-4", unit: "ADC", max: 3600, warning: 720, critical: 900, seedPrevious: 350, seedCurrent: 360 },
      { code: "CO", title: "Carbon monoxide · MQ-7", unit: "ADC", max: 3200, warning: 200, critical: 400, seedPrevious: 155, seedCurrent: 160 },
      { code: "CO2", title: "Carbon dioxide · MG811", unit: "ADC", max: 2200, warning: 275, critical: 275, seedPrevious: 108, seedCurrent: 110 },
      { code: "HEART", title: "Heart rate · pulse sensor", unit: "bpm", max: 250, warning: 130, critical: 140, seedPrevious: 76, seedCurrent: 78 }
    ];
    const s = state();
    const samples = definitions.map(function (definition) {
      const current = s.readings[definition.code];
      const hasLive = current && current.value != null;
      const records = s.history.filter(function (record) {
        return record.sensorCode === definition.code && Number.isFinite(Number(record.value));
      }).slice().sort(function (a, b) { return Date.parse(b.timestamp) - Date.parse(a.timestamp); });
      const baseline = hasLive ? Number(current.value) : definition.seedCurrent;
      const previous = records.length > 1 ? Number(records[1].value) :
        hasLive ? null : definition.seedPrevious;
      const candidate = Math.max(0, Math.min(definition.max, Math.round(baseline)));
      const rising = previous != null && candidate > previous + Math.max(1, definition.warning * .05) &&
        candidate >= definition.warning * .75;
      let status = "Normal";
      let reason = "Below the criteria.";
      if (definition.code === "HEART") {
        if (candidate > 140) { status = "Critical"; reason = "Above the demo high-pulse criterion."; }
        else if (candidate >= 130) { status = "Warning"; reason = "At or above the demo elevated-pulse criterion."; }
        else if (candidate < 60) { status = "Review"; reason = "Below 60 bpm; activity state is unknown."; }
      } else if (candidate >= definition.critical) {
        status = "Critical";
        reason = "At or above the high-level criterion.";
      } else if (candidate >= definition.warning) {
        status = "Warning";
        reason = "At or above the review criterion.";
      } else if (rising) {
        status = "Watch";
        reason = "Rising versus the previous sample and near the criterion.";
      }
      return {
        code: definition.code,
        title: definition.title,
        unit: definition.unit,
        max: definition.max,
        warning: definition.warning,
        critical: definition.critical,
        baseline: baseline,
        previous: previous,
        candidate: candidate,
        source: hasLive ? s.deviceOnline ? "Live telemetry" : "Latest saved telemetry (stale)" : "Standard mock seed",
        rising: rising,
        status: status,
        reason: reason
      };
    });
    const critical = samples.filter(function (sample) { return sample.status === "Critical"; });
    const elevated = samples.filter(function (sample) {
      return sample.status === "Warning" || sample.status === "Review" || sample.status === "Watch";
    });
    return {
      samples: samples,
      outcome: critical.length ? "High-risk pattern" : elevated.length ? "Elevated pattern" : "Baseline-like pattern",
      status: critical.length ? "Critical" : elevated.length ? "Warning" : "Normal",
      explanation: critical.length
        ? critical.map(function (sample) { return sample.title + " " + sample.reason.toLowerCase(); }).join(" ")
        : elevated.length
          ? elevated.map(function (sample) { return sample.title + " " + sample.reason; }).join(" ")
          : "No demo criteria are crossed in the entered scenario."
    };
  }

  function mlWarningToCriticalHistory() {
    const definitions = [
      { code: "CH4", title: "Methane · MQ-4", unit: "ADC", warning: 720, critical: 900 },
      { code: "CO", title: "Carbon monoxide · MQ-7", unit: "ADC", warning: 200, critical: 400 },
      { code: "CO2", title: "Carbon dioxide · MG811", unit: "ADC", warning: 275, critical: 275 },
      { code: "HEART", title: "Heart rate · pulse sensor", unit: "bpm", warning: 130, critical: 140 }
    ];
    const s = state();
    const transitions = [];

    definitions.forEach(function (definition) {
      const records = s.history.filter(function (record) {
        return record.sensorCode === definition.code &&
          Number.isFinite(Number(record.value)) &&
          !Number.isNaN(Date.parse(record.timestamp));
      }).slice().sort(function (a, b) {
        return Date.parse(a.timestamp) - Date.parse(b.timestamp);
      });

      let previousStatus = null;
      let previousValue = null;
      let previousTimestamp = null;

      records.forEach(function (record) {
        const value = Number(record.value);
        let status = "Normal";
        if (definition.code === "HEART") {
          if (value === 0) status = "No beat";
          else if (value > definition.critical) status = "Critical";
          else if (value >= definition.warning) status = "Warning";
          else if (value < 60) status = "Review";
        } else {
          if (value >= definition.critical) status = "Critical";
          else if (value >= definition.warning) status = "Warning";
        }

        if (previousStatus === "Warning" && status === "Critical") {
          transitions.push({
            timestamp: record.timestamp,
            sensor: definition.title,
            reading: fmt(value) + " " + definition.unit,
            previousValue: previousValue,
            from: "Warning",
            to: "Critical",
            source: record.source || "ESP32"
          });
        }

        if (status !== previousStatus) {
          previousStatus = status;
          previousValue = value;
          previousTimestamp = record.timestamp;
        }
      });
    });

    transitions.sort(function (a, b) {
      return Date.parse(b.timestamp) - Date.parse(a.timestamp);
    });

    if (!transitions.length) {
      return '<tr><td colspan="6"><div class="empty">No Warning → Critical transitions found in the loaded historical records.</div></td></tr>';
    }

    return transitions.slice(0, 100).map(function (transition) {
      return '<tr><td>' + escapeHtml(time(transition.timestamp)) + '</td><td>' + escapeHtml(transition.sensor) +
        '</td><td>' + escapeHtml(transition.reading) + '</td><td>' + badge("Warning") +
        '</td><td>' + badge("Critical") + '</td><td>' + escapeHtml(transition.source) + '</td></tr>';
    }).join("");
  }

  function mlPredictions() {
    const scenario = mlScenario();
    return header("ML Predictions") +
      escapeHtml(scenario.outcome) + '</strong><p>' + '</p></div></div></section>' +
      '<section class="panel ml-data-panel"><div class="panel-head"><h2>Latest sensor readings.</h2><span>Recalculated from live ESP32 data</span></div>' +
      '<div class="table-wrap"><table class="ml-table"><thead><tr><th>Sensor</th><th>Previous reading</th><th>Latest real reading</th><th>Change</th><th>Signal</th></tr></thead><tbody>' +
      scenario.samples.map(function (sample) {
        const change = sample.previous == null ? "No earlier sample" :
          (sample.candidate - sample.previous > 0 ? "+" : "") + fmt(sample.candidate - sample.previous) + " " + sample.unit;
        return '<tr><td>' + escapeHtml(sample.title) + '</td><td>' +
          (sample.previous == null ? "Not available" : fmt(sample.previous) + " " + escapeHtml(sample.unit)) +
          '</td><td><strong>' + fmt(sample.candidate) + ' ' + escapeHtml(sample.unit) + '</strong><br><small>' + escapeHtml(sample.source) + '</small></td><td>' + change +
          '</td><td>' + badge(sample.status) + '<br><small>' + escapeHtml(sample.reason) + '</small></td></tr>';
      }).join("") + '</tbody></table></div></section>' +
      '<section class="panel ml-history"><div class="panel-head"><h2>Warning-to-critical history</h2><span>Derived from saved ESP32 records</span></div>' +
      '<div class="table-wrap"><table class="ml-history-table"><thead><tr><th>Date and time</th><th>Sensor</th><th>Reading</th><th>Previous status</th><th>New status</th><th>Source</th></tr></thead><tbody>' +
      mlWarningToCriticalHistory() +
      '</tbody></table></div></section>' +
      '<section class="panel ml-explainer"><div class="panel-head"><h2>How to read this demonstration</h2><span>Mock data follows your sensor readings</span></div><div class="panel-body">' +
      '<p><strong>Previous reading</strong> comes from the second-most-recent saved sample when available. <strong>Latest real reading</strong> comes from current ESP32 telemetry. If a sensor has no live or saved value, a clearly labeled standard mock seed is used.</p>' +
      '<p>The mock outcome recalculates from latest readings. The warning-to-critical history below is derived from historical records using the same provisional thresholds; it is not a saved alert log or certified safety record.</p></div></section>';
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
    const pages = { overview: overview, monitoring: monitoring, devices: devices, miners: miners, alerts: alerts, "ml-predictions": mlPredictions, history: history };
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
