(function () {
  "use strict";

  const config = window.MINEWATCH_SUPABASE_CONFIG;
  const sensorMap = {
    MQ4_ADC: { code: "CH4", name: "MQ-4", unit: "ADC counts" },
    MQ7_ADC: { code: "CO", name: "MQ-7", unit: "ADC counts" },
    MQ6_ADC: { code: "LPG", name: "MQ-6", unit: "ADC counts" },
    MG811_ADC: { code: "CO2", name: "MG811", unit: "ADC counts" }
  };
  const sensors = [
    { code: "CH4", name: "MQ-4", short: "Methane (CH₄)", unit: "ADC counts" },
    { code: "CO", name: "MQ-7", short: "Carbon Monoxide (CO)", unit: "ADC counts" },
    { code: "LPG", name: "MQ-6", short: "Combustible Gas / LPG", unit: "ADC counts" },
    { code: "CO2", name: "MG811", short: "Carbon Dioxide (CO₂)", unit: "ADC counts" }
  ];

  let timer = null;
  let requestController = null;
  let refreshInProgress = false;
  const readings = {};
  sensors.forEach(function (sensor) {
    readings[sensor.code] = {
      code: sensor.code,
      name: sensor.name,
      value: null,
      unit: sensor.unit,
      status: "No data",
      available: false,
      updatedAt: null
    };
  });

  const state = {
    running: true,
    intervalMs: config ? config.pollIntervalMs : 10000,
    packets: 0,
    readings: readings,
    history: [],
    alerts: [],
    alertConditions: {},
    disconnectedSensors: {},
    deviceOnline: false,
    lastHeartbeat: null,
    lastTelemetry: null,
    stableSince: null,
    connectionStatus: "checking",
    error: "",
    source: "ESP32",
    lastCheckedAt: null
  };

  function publish() {
    window.dispatchEvent(new CustomEvent("minewatch:update", { detail: state }));
  }

  function validConfig() {
    return config &&
      typeof config.url === "string" &&
      config.url.startsWith("https://") &&
      typeof config.publishableKey === "string" &&
      config.publishableKey.length > 10 &&
      config.publishableKey.indexOf("PASTE_") !== 0 &&
      typeof config.deviceId === "string" &&
      Number.isFinite(config.pollIntervalMs) &&
      Number.isFinite(config.historyLimit);
  }

  function requestUrl() {
    const url = new URL("/rest/v1/telemetry_readings", config.url);
    url.searchParams.set("select", "id,device_id,sensor_code,value,unit,source,captured_at,received_at");
    url.searchParams.set("device_id", "eq." + config.deviceId);
    url.searchParams.set("source", "eq.ESP32");
    url.searchParams.set("order", "captured_at.desc,received_at.desc");
    url.searchParams.set("limit", String(config.historyLimit));
    return url.toString();
  }

  function normalize(row) {
    if (!row || typeof row !== "object") return null;
    const sensor = sensorMap[row.sensor_code];
    const value = Number(row.value);
    const timestamp = row.captured_at || row.received_at;
    if (!sensor || row.device_id !== config.deviceId || row.source !== "ESP32" ||
        !Number.isFinite(value) || value < 0 ||
        typeof timestamp !== "string" || Number.isNaN(Date.parse(timestamp))) return null;

    return {
      id: String(row.id),
      deviceId: row.device_id,
      sensorCode: sensor.code,
      databaseSensorCode: row.sensor_code,
      value: value,
      unit: sensor.unit,
      status: "Not calibrated",
      timestamp: timestamp,
      lastSeenAt: row.received_at || timestamp,
      source: "ESP32"
    };
  }

  function validPublicKey() {
    return validConfig() &&
      (config.publishableKey.startsWith("sb_publishable_") ||
       config.publishableKey.startsWith("eyJ"));
  }

  async function refresh() {
    if (refreshInProgress) return;
    if (!validConfig()) {
      state.connectionStatus = "configuration required";
      state.error = "Add the Supabase publishable/anon key in supabase-public-config.js.";
      state.lastCheckedAt = new Date().toISOString();
      publish();
      return;
    }

    if (!validPublicKey()) {
      state.connectionStatus = "configuration required";
      state.error = "The configured public key format is not recognized. Use a Supabase publishable or legacy anon key.";
      state.lastCheckedAt = new Date().toISOString();
      publish();
      return;
    }

    refreshInProgress = true;
    if (requestController) requestController.abort();
    requestController = new AbortController();
    const timeout = window.setTimeout(function () { requestController.abort(); }, 12000);
    state.connectionStatus = "checking";

    try {
      const response = await fetch(requestUrl(), {
        method: "GET",
        headers: {
          apikey: config.publishableKey,
          Accept: "application/json"
        },
        cache: "no-store",
        signal: requestController.signal
      });

      if (!response.ok) {
        state.connectionStatus = "error";
        state.error = response.status === 401 || response.status === 403
          ? "Supabase denied public reads. Check the anon SELECT grant and RLS policy."
          : "Supabase request failed with HTTP " + response.status + ". Check the telemetry table and API settings.";
        state.lastCheckedAt = new Date().toISOString();
        publish();
        return;
      }

      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error("Supabase returned an unexpected response.");

      const history = payload.map(normalize).filter(Boolean);
      state.history = history;
      state.packets = history.length;
      state.error = "";
      state.connectionStatus = "connected";
      state.lastCheckedAt = new Date().toISOString();

      sensors.forEach(function (sensor) {
        const latest = history.find(function (record) { return record.sensorCode === sensor.code; });
        const reading = state.readings[sensor.code];
        reading.value = latest ? latest.value : null;
        reading.unit = latest ? latest.unit : sensor.unit;
        reading.updatedAt = latest ? latest.timestamp : null;
        reading.available = Boolean(latest);
        reading.status = latest ? "Not calibrated" : "No data";
      });

      state.lastTelemetry = history.length ? history.reduce(function (latest, record) {
        return Date.parse(record.timestamp) > Date.parse(latest) ? record.timestamp : latest;
      }, history[0].timestamp) : null;
      const latestBySensor = sensors.map(function (sensor) {
        return history.find(function (record) { return record.sensorCode === sensor.code; });
      }).filter(Boolean);
      state.stableSince = latestBySensor.length
        ? latestBySensor.map(function (record) { return record.timestamp; }).sort()[0]
        : null;
      state.lastHeartbeat = latestBySensor.length
        ? latestBySensor.map(function (record) { return record.lastSeenAt; }).sort().slice(-1)[0]
        : null;
      state.deviceOnline = Boolean(state.lastTelemetry) &&
        Date.now() - Date.parse(state.lastHeartbeat) <= config.recentTelemetryMs;
    } catch (error) {
      state.connectionStatus = "error";
      state.error = error.name === "AbortError"
        ? "Supabase request timed out. Check network connectivity."
        : error.message || "Unable to read telemetry from Supabase.";
      state.lastCheckedAt = new Date().toISOString();
    } finally {
      window.clearTimeout(timeout);
      refreshInProgress = false;
      publish();
    }
  }

  function startPolling() {
    if (timer) window.clearInterval(timer);
    timer = window.setInterval(refresh, state.intervalMs);
  }

  window.MinewatchProvider = {
    getState: function () { return state; },
    config: function () { return sensors; },
    refresh: refresh,
    start: startPolling
  };

  refresh();
  startPolling();
})();
