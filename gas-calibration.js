(function () {
  "use strict";

  const config = {
    adcResolutionBits: 10,
    firmwareAdcScaleFactor: 4,
    adcFullScaleVoltage: 3.3,
    sensorSupplyVoltage: 5,
    dividerTopOhms: 1000,
    dividerBottomOhms: 2000,
    sensors: {
      CH4: {
        gas: "methane",
        modelA: 1021,
        modelB: -2.7857,
        cleanAirRatio: 4.4,
        standardLoadResistanceKOhm: 20,
        loadResistanceKOhm: 0.66667,
        cleanAirRawAdc: 400,
        outputCircuitVerified: true
      },
      CO: {
        gas: "carbon monoxide",
        modelA: 98.909,
        modelB: -1.923,
        cleanAirRatio: 27.5,
        standardLoadResistanceKOhm: 10,
        loadResistanceKOhm: 0.66667,
        cleanAirRawAdc: 100,
        outputCircuitVerified: true,
        mq7HeaterCycleVerified: true,
        heaterHighVoltage: 5,
        heaterHighDurationSeconds: 60,
        heaterLowVoltage: 1.4,
        heaterLowDurationSeconds: 90
      },
      CO2: {
        gas: "carbon dioxide",
        lowReferencePpm: 420,
        lowReferenceRawAdc: 1850,
        highReferencePpm: 2000,
        highReferenceRawAdc: 980,
        referenceVoltageMvAt400Ppm: 400,
        referenceEmfSlopeMvPerDecadeMin: 30,
        referenceEmfSlopeMvPerDecadeMax: 50,
        referenceEmfSlopeMvPerDecadeTypical: 40,
        referencePpmRangeMin: 350,
        referencePpmRangeMax: 10000,
        referencePointsVerified: true
      }
    }
  };

  function voltageAtEsp32(rawAdc) {
    const maxAdc = Math.pow(2, config.adcResolutionBits) - 1;
    const adcCode = Number(rawAdc) / config.firmwareAdcScaleFactor;
    if (!Number.isFinite(adcCode) || adcCode <= 0 || adcCode > maxAdc) return null;
    return adcCode / maxAdc * config.adcFullScaleVoltage;
  }

  function sensorOutputVoltage(rawAdc) {
    const esp32Voltage = voltageAtEsp32(rawAdc);
    if (esp32Voltage === null) return null;
    const dividerRatio = config.dividerBottomOhms /
      (config.dividerTopOhms + config.dividerBottomOhms);
    const outputVoltage = esp32Voltage / dividerRatio;
    if (outputVoltage <= 0 || outputVoltage >= config.sensorSupplyVoltage) return null;
    return outputVoltage;
  }

  function sensorResistance(rawAdc, sensorConfig) {
    const outputVoltage = sensorOutputVoltage(rawAdc);
    if (outputVoltage === null) return null;
    return sensorConfig.loadResistanceKOhm *
      (config.sensorSupplyVoltage / outputVoltage - 1);
  }

  function estimateMg811(rawAdc) {
    const sensorConfig = config.sensors.CO2;
    const maxRawAdc = (Math.pow(2, config.adcResolutionBits) - 1) *
      config.firmwareAdcScaleFactor;
    const values = [
      sensorConfig.lowReferencePpm,
      sensorConfig.lowReferenceRawAdc,
      sensorConfig.highReferencePpm,
      sensorConfig.highReferenceRawAdc,
      Number(rawAdc)
    ];
    if (!values.every(Number.isFinite) || sensorConfig.lowReferencePpm <= 0 ||
        sensorConfig.highReferencePpm <= 0 ||
          sensorConfig.lowReferencePpm >= sensorConfig.highReferencePpm ||
        sensorConfig.lowReferenceRawAdc === sensorConfig.highReferenceRawAdc) {
      return {
        available: false,
        reason: "Configure two distinct known CO₂ reference concentrations and their averaged raw ADC readings."
      };
    }
    if (sensorConfig.lowReferenceRawAdc <= 0 ||
        sensorConfig.highReferenceRawAdc <= 0 ||
        sensorConfig.lowReferenceRawAdc > maxRawAdc ||
        sensorConfig.highReferenceRawAdc > maxRawAdc ||
        rawAdc <= 0 || rawAdc > maxRawAdc) {
      return { available: false, reason: "MG811 ADC values must be within the firmware's usable 1–4092 count range." };
    }
    if (!sensorConfig.referencePointsVerified) {
      return { available: false, reason: "Verify the two MG811 reference-gas calibration points." };
    }

    const rawMinimum = Math.min(sensorConfig.lowReferenceRawAdc, sensorConfig.highReferenceRawAdc);
    const rawMaximum = Math.max(sensorConfig.lowReferenceRawAdc, sensorConfig.highReferenceRawAdc);
    if (rawAdc < rawMinimum || rawAdc > rawMaximum) {
      return {
        available: false,
        reason: "This ADC reading is outside the two-point MG811 calibration range."
      };
    }

    const logLowPpm = Math.log10(sensorConfig.lowReferencePpm);
    const logHighPpm = Math.log10(sensorConfig.highReferencePpm);
    const slope = (logHighPpm - logLowPpm) /
      (sensorConfig.highReferenceRawAdc - sensorConfig.lowReferenceRawAdc);
    const intercept = logLowPpm - slope * sensorConfig.lowReferenceRawAdc;
    const logPpm = slope * Number(rawAdc) + intercept;
    const ppm = Math.pow(10, logPpm);
    if (!Number.isFinite(ppm) || ppm <= 0) {
      return { available: false, reason: "The MG811 calibration points returned an invalid concentration." };
    }
    return {
      available: true,
      ppm: ppm,
      calibrationType: "two-point log-linear",
      slopeLogPpmPerAdc: slope,
      interceptLogPpm: intercept,
      calibrationRange: {
        lowPpm: sensorConfig.lowReferencePpm,
        highPpm: sensorConfig.highReferencePpm,
        lowRawAdc: sensorConfig.lowReferenceRawAdc,
        highRawAdc: sensorConfig.highReferenceRawAdc
      }
    };
  }

  function estimate(sensorCode, rawAdc) {
    if (sensorCode === "CO2") return estimateMg811(rawAdc);
    const sensorConfig = config.sensors[sensorCode];
    if (!sensorConfig) return { available: false, reason: "No curve configured for this sensor." };
    if (!sensorConfig.outputCircuitVerified) {
      return { available: false, reason: "Verify the sensor module output circuit before estimating concentration." };
    }
    if (!Number.isFinite(sensorConfig.loadResistanceKOhm) || sensorConfig.loadResistanceKOhm <= 0) {
      return { available: false, reason: "Configure the sensor module's measured load resistance (RL)." };
    }
    if (!Number.isFinite(sensorConfig.cleanAirRawAdc)) {
      return { available: false, reason: "Configure a warmed-up clean-air baseline ADC reading." };
    }
    if (sensorCode === "CO" && !sensorConfig.mq7HeaterCycleVerified) {
      return { available: false, reason: "Verify MQ-7 heater cycling before estimating CO." };
    }

    const currentRs = sensorResistance(rawAdc, sensorConfig);
    const cleanAirRs = sensorResistance(sensorConfig.cleanAirRawAdc, sensorConfig);
    if (currentRs === null || cleanAirRs === null || cleanAirRs <= 0) {
      return { available: false, reason: "ADC reading is outside the usable voltage-divider range." };
    }

    const rsOverR0 = sensorConfig.cleanAirRatio * currentRs / cleanAirRs;
    if (!Number.isFinite(rsOverR0) || rsOverR0 <= 0) {
      return { available: false, reason: "Unable to calculate a valid Rs/R0 ratio." };
    }
    const ppm = sensorConfig.modelA * Math.pow(rsOverR0, sensorConfig.modelB);
    if (!Number.isFinite(ppm) || ppm < 0) {
      return { available: false, reason: "The sensor curve returned an invalid concentration." };
    }

    return {
      available: true,
      ppm: ppm,
      rsOverR0: rsOverR0,
      outputVoltage: sensorOutputVoltage(rawAdc),
      calibrationType: "Rs/R0 response curve"
    };
  }

  function isConfigured(sensorCode) {
    const sensorConfig = config.sensors[sensorCode];
    if (!sensorConfig) return false;
    const maxRawAdc = (Math.pow(2, config.adcResolutionBits) - 1) *
      config.firmwareAdcScaleFactor;
    if (sensorCode === "CO2") {
      return sensorConfig.referencePointsVerified === true &&
        Number.isFinite(sensorConfig.lowReferencePpm) &&
        sensorConfig.lowReferencePpm > 0 &&
        Number.isFinite(sensorConfig.highReferencePpm) &&
        sensorConfig.highReferencePpm > sensorConfig.lowReferencePpm &&
        Number.isFinite(sensorConfig.lowReferenceRawAdc) &&
        sensorConfig.lowReferenceRawAdc > 0 &&
        sensorConfig.lowReferenceRawAdc <= maxRawAdc &&
        Number.isFinite(sensorConfig.highReferenceRawAdc) &&
        sensorConfig.highReferenceRawAdc > 0 &&
        sensorConfig.highReferenceRawAdc <= maxRawAdc &&
        sensorConfig.highReferenceRawAdc !== sensorConfig.lowReferenceRawAdc;
    }
    return sensorConfig.outputCircuitVerified === true &&
      Number.isFinite(sensorConfig.loadResistanceKOhm) &&
      sensorConfig.loadResistanceKOhm > 0 &&
      Number.isFinite(sensorConfig.cleanAirRawAdc) &&
      sensorConfig.cleanAirRawAdc > 0 &&
      sensorConfig.cleanAirRawAdc <= maxRawAdc &&
      sensorOutputVoltage(sensorConfig.cleanAirRawAdc) !== null &&
      (sensorCode !== "CO" || sensorConfig.mq7HeaterCycleVerified === true);
  }

  window.ArgosGasCalibration = {
    config: config,
    estimate: estimate,
    isConfigured: isConfigured
  };
})();
