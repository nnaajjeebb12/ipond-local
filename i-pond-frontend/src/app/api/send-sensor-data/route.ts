import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = {
  data?: {
    pnd?: number;
    rtd?: number;
    ph?: number;
    sal?: number;
    dox?: number;
  };
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

type LogArgs = {
  pondId: number | null;
  pondCode: string | null;
  rawPayload: unknown;
  temperature: number | null;
  ph: number | null;
  salinity: number | null;
  dissolvedOxygen: number | null;
  httpStatus: number;
  ip: string;
  errorMessage: string | null;
};

async function writeLog(args: LogArgs): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ingestion_logs
         (pond_id, pond_code, raw_payload,
          temperature, ph, salinity, dissolved_oxygen,
          http_status, ip_address, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        args.pondId,
        args.pondCode,
        JSON.stringify(args.rawPayload ?? {}),
        args.temperature,
        args.ph,
        args.salinity,
        args.dissolvedOxygen,
        args.httpStatus,
        args.ip,
        args.errorMessage,
      ]
    );
  } catch (err) {
    console.error("ingestion_log_write_error", err);
  }
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.API_TOKEN;

  if (!expected) {
    await writeLog({
      pondId: null,
      pondCode: null,
      rawPayload: {},
      temperature: null,
      ph: null,
      salinity: null,
      dissolvedOxygen: null,
      httpStatus: 500,
      ip,
      errorMessage: "server_misconfigured",
    });
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  if (auth !== `Bearer ${expected}`) {
    await writeLog({
      pondId: null,
      pondCode: null,
      rawPayload: {},
      temperature: null,
      ph: null,
      salinity: null,
      dissolvedOxygen: null,
      httpStatus: 401,
      ip,
      errorMessage: "unauthorized",
    });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    await writeLog({
      pondId: null,
      pondCode: null,
      rawPayload: {},
      temperature: null,
      ph: null,
      salinity: null,
      dissolvedOxygen: null,
      httpStatus: 400,
      ip,
      errorMessage: "invalid_json",
    });
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const d = body?.data;
  if (!d || !isFiniteNumber(d.pnd)) {
    await writeLog({
      pondId: null,
      pondCode: null,
      rawPayload: body ?? {},
      temperature: null,
      ph: null,
      salinity: null,
      dissolvedOxygen: null,
      httpStatus: 400,
      ip,
      errorMessage: "invalid_payload",
    });
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const pndNum = Math.trunc(d.pnd);
  if (pndNum < 1 || pndNum > 10) {
    await writeLog({
      pondId: null,
      pondCode: null,
      rawPayload: body,
      temperature: null,
      ph: null,
      salinity: null,
      dissolvedOxygen: null,
      httpStatus: 400,
      ip,
      errorMessage: "pond_out_of_range",
    });
    return NextResponse.json({ error: "pond_out_of_range" }, { status: 400 });
  }

  const pondCode = `PND-${String(pndNum).padStart(3, "0")}`;

  const temperature = isFiniteNumber(d.rtd) ? d.rtd : null;
  const ph = isFiniteNumber(d.ph) ? d.ph : null;
  const salinity = isFiniteNumber(d.sal) ? d.sal : null;
  const dissolvedOxygen = isFiniteNumber(d.dox) ? d.dox : null;

  try {
    const pondResult = await pool.query<{ id: number }>(
      `SELECT id FROM ponds WHERE pond_code = $1`,
      [pondCode]
    );

    if (pondResult.rows.length === 0) {
      console.warn("ingest_unknown_pond", { pnd: pndNum, pondCode });
      await writeLog({
        pondId: null,
        pondCode,
        rawPayload: body,
        temperature,
        ph,
        salinity,
        dissolvedOxygen,
        httpStatus: 404,
        ip,
        errorMessage: "unknown_pond",
      });
      return NextResponse.json({ error: "unknown_pond" }, { status: 404 });
    }

    const pondId = pondResult.rows[0].id;

    await pool.query(
      `INSERT INTO sensor_readings
         (time, pond_id, temperature, ph, salinity, dissolved_oxygen)
       VALUES (NOW(), $1, $2, $3, $4, $5)`,
      [pondId, temperature, ph, salinity, dissolvedOxygen]
    );

    // Heartbeat for utilization. Only writer of pond_status_log; status='online'.
    // Stale/offline minutes are derived from gaps between consecutive heartbeats
    // in /api/utilization.
    await pool.query(
      `INSERT INTO pond_status_log (pond_id, status, recorded_at)
       VALUES ($1, 'online', NOW())`,
      [pondId]
    );

    await writeLog({
      pondId,
      pondCode,
      rawPayload: body,
      temperature,
      ph,
      salinity,
      dissolvedOxygen,
      httpStatus: 201,
      ip,
      errorMessage: null,
    });
  } catch (err) {
    console.error("ingest_db_error", err);
    await writeLog({
      pondId: null,
      pondCode,
      rawPayload: body,
      temperature,
      ph,
      salinity,
      dissolvedOxygen,
      httpStatus: 500,
      ip,
      errorMessage: "db_error",
    });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true },
    {
      status: 201,
      headers: {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    }
  );
}
