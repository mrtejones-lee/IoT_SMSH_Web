import { createClient } from "npm:@supabase/supabase-js@2";

const allowedReadings: Record<string, string> = {
  MQ4_ADC: "ADC counts",
  MQ6_ADC: "ADC counts",
  MQ7_ADC: "ADC counts",
  MG811_ADC: "ADC counts",
};

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

  const entries = Object.entries(payload.readings);
  if (entries.length === 0 || entries.some(([code, value]) =>
    !(code in allowedReadings) ||
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 4095
  )) {
    return new Response("Unsupported sensor or invalid ADC count", { status: 400 });
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

  const rows = entries.map(([code, value]) => ({
    device_id: "HELMET-001",
    sensor_code: code,
    value,
    unit: allowedReadings[code],
    source: "ESP32",
  }));

  const { error } = await supabase.from("telemetry_readings").insert(rows);

  if (error) {
    console.error("Telemetry insert failed:", error.message);
    return new Response("Database insert failed", { status: 500 });
  }

  return Response.json({ accepted: rows.length });
});
