(function () {
  "use strict";

  const LIMITS = 5000;
  const sensors = [
    { code: "CH4", name: "MQ-4", short: "Methane (CH₄)", unit: "ADC counts", initial: 120, min: 80, max: 250, warning: 200, critical: 235, step: 7 },
    { code: "CO", name: "MQ-7", short: "Carbon Monoxide (CO)", unit: "ADC counts", initial: 180, min: 100, max: 350, warning: 280, critical: 330, step: 10 },
    { code: "LPG", name: "MQ-6", short: "Combustible Gas / LPG", unit: "ADC counts", initial: 160, min: 80, max: 300, warning: 240, critical: 280, step: 9 },
    { code: "CO2", name: "MG-811", short: "Carbon Dioxide (CO₂)", unit: "ppm (simulated)", initial: 650, min: 450, max: 1200, warning: 900, critical: 1100, step: 35 },
    { code: "HR", name: "Ear-Clip Heart Rate", short: "Heart rate", unit: "BPM", initial: 78, min: 65, max: 100, warning: 105, critical: 120, step: 3 },
    { code: "BATTERY", name: "Voltage Sensor", short: "Battery Voltage", unit: "V", initial: 3.9, min: 3.3, max: 4.2, warning: 2.8, critical: 2.6, step: 0.025 },
    { code: "BATTERY_PERCENT", name: "Battery level", short: "Battery", unit: "%", initial: 85, min: 0, max: 100, warning: 20, critical: 10, step: 0.006 },
    { code: "CURRENT", name: "Current consumption", short: "Current", unit: "A", initial: 0.35, min: 0.25, max: 0.5, warning: 1, critical: 2, step: 0.018 }
  ];
  const defaultThresholds = sensors.map(function (sensor) {
    return { code: sensor.code, warning: sensor.warning, critical: sensor.critical };
  });

  let state;
  let timer = null;
  let nextAlertId = 1;

  function now() { return new Date().toISOString(); }

  function createReading(sensor, value) {
    return {
      code: sensor.code,
      name: sensor.name,
      value: value,
      unit: sensor.unit,
      status: "Normal",
      available: true,
      updatedAt: now()
    };
  }

  function freshState() {
    const readings = {};
    sensors.forEach(function (sensor) {
      readings[sensor.code] = createReading(sensor, sensor.initial);
    });
    return {
      running: true,
      intervalMs: 10000,
      packets: 0,
      readings: readings,
      history: [],
      alerts: [],
      alertConditions: {},
      disconnectedSensors: {},
      deviceOnline: true,
      lastHeartbeat: now(),
      lastTelemetry: now(),
      startedAt: now()
    };
  }

  function getState() { return state; }
  function config() { return sensors; }

  function publish() {
    window.dispatchEvent(new CustomEvent("minewatch:update", { detail: state }));
  }

  function statusFor(sensor, value) {
    if (sensor.code === "BATTERY_PERCENT") return value <= sensor.critical ? "Critical" : value <= sensor.warning ? "Warning" : "Normal";
    return value >= sensor.critical ? "Critical" : value >= sensor.warning ? "Warning" : "Normal";
  }

  function makeAlert(sensor, reading, status, extra) {
    const condition = sensor.code + ":" + status;
    if (state.alertConditions[condition]) return;
    state.alertConditions[condition] = true;
    state.alerts.unshift({
      id: "MW-" + String(nextAlertId++).padStart(4, "0"),
      timestamp: now(),
      deviceId: "HELMET-001",
      sensor: sensor.name,
      code: sensor.code,
      reading: reading.value,
      unit: reading.unit,
      threshold: status === "Critical" ? sensor.critical : sensor.warning,
      severity: status,
      description: extra || sensor.name + " exceeded its configurable demo " + status.toLowerCase() + " threshold.",
      acknowledged: false,
      resolved: false
    });
  }

  function evaluate(sensor, reading) {
    const status = statusFor(sensor, reading.value);
    reading.status = status;
    if (status === "Warning") closeAlertCondition(sensor.code, "Critical");
    else if (status === "Critical") closeAlertCondition(sensor.code, "Warning");
    else {
      closeAlertCondition(sensor.code, "Warning");
      closeAlertCondition(sensor.code, "Critical");
    }
    if (status !== "Normal") makeAlert(sensor, reading, status);
  }

  function closeAlertCondition(code, level) {
    const key = code + ":" + level;
    if (!state.alertConditions[key]) return;
    const alert = state.alerts.find(function (item) { return item.code === code && item.severity === level && !item.resolved; });
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = now();
    }
    delete state.alertConditions[key];
  }

  function record(sensor, reading) {
    state.history.unshift({
      id: "TEL-" + String(state.packets).padStart(6, "0") + "-" + sensor.code,
      deviceId: "HELMET-001",
      sensorCode: sensor.code,
      value: reading.value,
      unit: reading.unit,
      status: reading.status,
      timestamp: reading.updatedAt,
      source: "SIMULATED"
    });
    if (state.history.length > LIMITS) state.history.length = LIMITS;
  }

  function tick() {
    if (!state.running || !state.deviceOnline) return;
    const timestamp = now();
    sensors.forEach(function (sensor) {
      const reading = state.readings[sensor.code];
      if (sensor.code === "BATTERY_PERCENT") {
        reading.value = Math.max(0, reading.value - sensor.step);
        reading.updatedAt = timestamp;
        evaluate(sensor, reading);
        return;
      }
      if (state.disconnectedSensors[sensor.code]) {
        reading.available = false;
        reading.status = "Offline";
        return;
      }
      reading.available = true;
      const center = sensor.initial;
      let step = (Math.random() * 2 - 1) * sensor.step;
      if (Math.random() < 0.025) step += (Math.random() < 0.5 ? -1 : 1) * sensor.step * 3;
      let value = reading.value + step;
      if (sensor.code !== "HR" && sensor.code !== "BATTERY" && sensor.code !== "CURRENT") {
        value = Math.max(sensor.min, Math.min(sensor.max, value));
        if (value > center) value -= (value - center) * 0.04;
      } else {
        value = Math.max(sensor.min, Math.min(sensor.max, value));
      }
      if (["H2S", "CO", "LPG", "CO2", "HR"].includes(sensor.code)) {
        const spike = Math.random();
        if (spike < 0.003) value = Math.max(value, sensor.critical + sensor.step);
        else if (spike < 0.015) value = Math.max(value, sensor.warning + sensor.step);
      }
      reading.value = sensor.code === "BATTERY" || sensor.code === "CURRENT" ? Number(value.toFixed(2)) : Math.round(value);
      reading.updatedAt = timestamp;
      evaluate(sensor, reading);
    });

    state.packets += 1;
    state.lastTelemetry = timestamp;
    state.lastHeartbeat = timestamp;
    Object.keys(state.readings).forEach(function (code) {
      const sensor = sensors.find(function (item) { return item.code === code; });
      if (sensor && !state.disconnectedSensors[code]) record(sensor, state.readings[code]);
    });
    publish();
  }

  function configureTimer() {
    if (timer) window.clearInterval(timer);
    timer = null;
    if (state.running) timer = window.setInterval(tick, state.intervalMs);
  }

  function start() { state.running = true; configureTimer(); publish(); }
  function pause() { state.running = false; configureTimer(); publish(); }
  function setIntervalMs(value) {
    const interval = Number(value);
    if (!Number.isFinite(interval) || interval < 1000 || interval > 60000) throw new Error("Update interval must be between 1 and 60 seconds.");
    state.intervalMs = interval;
    configureTimer();
    publish();
  }

  function setDeviceOnline(online) {
    state.deviceOnline = Boolean(online);
    if (online) state.lastHeartbeat = now();
    else {
      const sensor = { code: "DEVICE", name: "Helmet connection", warning: 0, critical: 0 };
      makeAlert(sensor, { value: "OFFLINE", unit: "status" }, "Warning", "HELMET-001 was manually disconnected in demo mode.");
    }
    if (online) resolveCondition("DEVICE");
    publish();
  }

  function resolveCondition(code) {
    ["Warning", "Critical"].forEach(function (level) {
      closeAlertCondition(code, level);
    });
  }

  function setSensorAvailable(code, available) {
    if (!state.readings[code]) throw new Error("Unknown sensor: " + code);
    if (available) {
      delete state.disconnectedSensors[code];
      state.readings[code].available = true;
      state.readings[code].status = "Normal";
      resolveCondition(code);
    } else {
      state.disconnectedSensors[code] = true;
      state.readings[code].available = false;
      state.readings[code].status = "Offline";
      const sensor = sensors.find(function (item) { return item.code === code; });
      makeAlert({ code: code, name: sensor.name, warning: 0, critical: 0 }, state.readings[code], "Warning", sensor.name + " was manually disconnected in demo mode.");
    }
    publish();
  }

  function simulateAbnormal(severity, code) {
    const sensor = sensors.find(function (item) { return item.code === code; });
    if (!sensor || sensor.code === "BATTERY" || sensor.code === "CURRENT") throw new Error("Choose a supported sensor.");
    if (state.disconnectedSensors[code]) setSensorAvailable(code, true);
    const reading = state.readings[code];
    reading.value = severity === "Critical" ? sensor.critical + sensor.step : sensor.warning + sensor.step;
    reading.updatedAt = now();
    evaluate(sensor, reading);
    state.packets += 1;
    state.lastTelemetry = reading.updatedAt;
    record(sensor, reading);
    publish();
  }

  function acknowledge(id) {
    const alert = state.alerts.find(function (item) { return item.id === id; });
    if (!alert) throw new Error("Alert not found: " + id);
    alert.acknowledged = true;
    alert.acknowledgedAt = now();
    publish();
  }

  function resolve(id) {
    const alert = state.alerts.find(function (item) { return item.id === id; });
    if (!alert) throw new Error("Alert not found: " + id);
    alert.resolved = true;
    alert.resolvedAt = now();
    publish();
  }

  function setThreshold(code, warning, critical) {
    const sensor = sensors.find(function (item) { return item.code === code; });
    const warn = Number(warning);
    const crit = Number(critical);
    if (!sensor || !Number.isFinite(warn) || !Number.isFinite(crit) || warn <= 0 || crit <= 0) {
      throw new Error("Thresholds must be valid positive numbers.");
    }
    if ((code === "BATTERY_PERCENT" && crit >= warn) || (code !== "BATTERY_PERCENT" && crit <= warn)) {
      throw new Error(code === "BATTERY_PERCENT" ? "Critical battery threshold must be lower than warning." : "Critical threshold must be higher than warning.");
    }
    sensor.warning = warn;
    sensor.critical = crit;
    state.alerts.forEach(function (alert) {
      if (alert.code === code && !alert.resolved) {
        alert.resolved = true;
        alert.resolvedAt = now();
      }
    });
    delete state.alertConditions[code + ":Warning"];
    delete state.alertConditions[code + ":Critical"];
    evaluate(sensor, state.readings[code]);
    publish();
  }

  function reset() {
    if (timer) window.clearInterval(timer);
    nextAlertId = 1;
    defaultThresholds.forEach(function (defaults) {
      const sensor = sensors.find(function (item) { return item.code === defaults.code; });
      sensor.warning = defaults.warning;
      sensor.critical = defaults.critical;
    });
    state = freshState();
    Object.keys(state.readings).forEach(function (code) {
      const sensor = sensors.find(function (item) { return item.code === code; });
      if (sensor) record(sensor, state.readings[code]);
    });
    configureTimer();
    publish();
  }

  state = freshState();
  sensors.forEach(function (sensor) { record(sensor, state.readings[sensor.code]); });
  configureTimer();
  window.MinewatchMockProvider = {
    getState: getState,
    config: config,
    tick: tick,
    start: start,
    pause: pause,
    reset: reset,
    setIntervalMs: setIntervalMs,
    setDeviceOnline: setDeviceOnline,
    setSensorAvailable: setSensorAvailable,
    simulateAbnormal: simulateAbnormal,
    acknowledge: acknowledge,
    resolve: resolve,
    setThreshold: setThreshold
  };
  window.MinewatchProvider = window.MinewatchMockProvider;
})();
