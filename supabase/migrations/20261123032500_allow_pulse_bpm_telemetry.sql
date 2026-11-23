alter table public.telemetry_readings
  drop constraint if exists telemetry_readings_sensor_code_check;

alter table public.telemetry_readings
  add constraint telemetry_readings_sensor_code_check
  check (
    sensor_code in (
      'MQ4_ADC',
      'MQ6_ADC',
      'MQ7_ADC',
      'MG811_ADC',
      'PULSE_BPM',
      'HEART_RATE_BPM',
      'BATTERY_VOLTAGE_V',
      'BATTERY_CURRENT_A',
      'BATTERY_PERCENT'
    )
  );
