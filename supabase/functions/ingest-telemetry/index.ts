import { createClient } from "npm:@supabase/supabase-js@2";

const allowedReadings: Record<string, string> = {
  MQ4_ADC: "ADC counts",
  MQ7_ADC: "ADC counts",
  MG811_ADC: "ADC counts",
  PULSE_BPM: "bpm",
};
const requiredReadings = ["MQ4_ADC", "MQ7_ADC", "MG811_ADC"];

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expectedToken = Deno.env.get("DEVICE_INGEST_TOKEN");
  const authorization = request.headers.get("Authorization") ?? "";

  if (!expectedToken ||
      !constantTimeEqual(authorization, `Bearer ${expectedToken}`)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return new Response("Invalid payload", { status: 400 });
  }

  const payload = body as {
    device_id?: unknown;
    readings?: unknown;
  };

  if (payload.device_id !== "HELMET-001" ||
      !payload.readings ||
      typeof payload.readings !== "object" ||
      Array.isArray(payload.readings)) {
    return new Response("Invalid device or readings", { status: 400 });
  }

  const readings = payload.readings as Record<string, unknown>;
  // MQ6_ADC is retained in old firmware payloads but is no longer a supported sensor.
  const legacyRemovedReadings = Object.fromEntries(
    Object.entries(readings).filter(([code]) => code !== "MQ6_ADC")
  );
  const entries = Object.entries(legacyRemovedReadings);
  if (!requiredReadings.every((code) =>
    Object.prototype.hasOwnProperty.call(readings, code)
  ) || entries.some(([code, value]) => {
    if (!Object.prototype.hasOwnProperty.call(allowedReadings, code) ||
        typeof value !== "number" ||
        !Number.isInteger(value)) {
      return true;
    }

    return code === "PULSE_BPM"
      ? value < 0 || value > 220
      : value < 0 || value > 4095;
  })) {
    return new Response("Unsupported sensor or invalid reading", { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Supabase function environment is missing required values.");
    return new Response("Server configuration error", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const latestResults = await Promise.all(
    entries.map(([code]) => supabase
      .from("telemetry_readings")
      .select("id,sensor_code,value,captured_at")
      .eq("device_id", "HELMET-001")
      .eq("source", "ESP32")
      .eq("sensor_code", code)
      .order("captured_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle())
  );
  const lookupError = latestResults.find((result) => result.error)?.error;

  if (lookupError) {
    console.error("Latest telemetry lookup failed:", lookupError.message);
    return new Response("Database lookup failed", { status: 500 });
  }

  const previousRows = latestResults
    .map((result) => result.data)
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const valuesUnchanged =
    previousRows.length === entries.length &&
    entries.every(([code, value]) => {
      const previous = previousRows.find((row) => row.sensor_code === code);
      return previous !== undefined && Number(previous.value) === value;
    });

  const lastSeenAt = new Date().toISOString();
  if (valuesUnchanged) {
    const rowIds = previousRows.map((row) => row.id);
    const { error } = await supabase
      .from("telemetry_readings")
      .update({ received_at: lastSeenAt })
      .in("id", rowIds);

    if (error) {
      console.error("Telemetry heartbeat update failed:", error.message);
      return new Response("Database heartbeat update failed", { status: 500 });
    }

    const stableSince = previousRows
      .map((row) => row.captured_at)
      .sort()[0];

    return Response.json({
      accepted: 0,
      unchanged: true,
      stable_since: stableSince,
      last_seen_at: lastSeenAt,
    });
  }

  const rows = entries.map(([code, value]) => ({
    device_id: "HELMET-001",
    sensor_code: code,
    value,
    unit: allowedReadings[code],
    source: "ESP32",
    captured_at: lastSeenAt,
    received_at: lastSeenAt,
  }));

  const { error } = await supabase.from("telemetry_readings").insert(rows);

  if (error) {
    console.error("Telemetry insert failed:", error.message);
    return new Response("Database insert failed", { status: 500 });
  }

  return Response.json({
    accepted: rows.length,
    unchanged: false,
    stable_since: lastSeenAt,
    last_seen_at: lastSeenAt,
  });
});
