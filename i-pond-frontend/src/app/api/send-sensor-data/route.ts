import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
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

// Heartbeats feed /utilization, whose coarsest distinction is a 20-minute gap.
// One row per minute per pond carries exactly the same information as one row
// per reading, at a small fraction of the writes.
const HEARTBEAT_MIN_GAP = "60 seconds";

type Queryable = Pick<PoolClient, "query">;

function insertLog(q: Queryable, args: LogArgs) {
  return q.query(
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
}

/** Best-effort log outside the ingest transaction (rejections and failures). */
async function writeLog(args: LogArgs): Promise<void> {
  try {
    await insertLog(pool, args);
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

  // One reading = one transaction = one commit. Previously this was three
  // autocommit INSERTs, each waiting for its own WAL fsync on the USB drive,
  // and every reader on the shared pool queued behind them. The transaction
  // also opts out of the fsync wait (SET LOCAL, so nothing else is affected):
  // on sudden power loss the newest ~0.6 s of readings may be lost, which is
  // an acceptable trade for telemetry. docker-compose.yml sets the same
  // default server-wide; this makes ingest fast even on a container that has
  // not been recreated with the new config.
  const client = await pool.connect();
  let inTx = false;
  try {
    await client.query("BEGIN");
    inTx = true;
    await client.query("SET LOCAL synchronous_commit TO off");

    const pondResult = await client.query<{ id: number }>(
      `SELECT id FROM ponds WHERE pond_code = $1`,
      [pondCode]
    );

    if (pondResult.rows.length === 0) {
      await client.query("ROLLBACK");
      inTx = false;
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

    await client.query(
      `INSERT INTO sensor_readings
         (time, pond_id, temperature, ph, salinity, dissolved_oxygen)
       VALUES (NOW(), $1, $2, $3, $4, $5)`,
      [pondId, temperature, ph, salinity, dissolvedOxygen]
    );

    // Heartbeat for utilization. Only writer of pond_status_log; status='online'.
    // Stale/offline minutes are derived from gaps between consecutive heartbeats
    // in /api/utilization, so one row per HEARTBEAT_MIN_GAP is enough.
    await client.query(
      `INSERT INTO pond_status_log (pond_id, status, recorded_at)
       SELECT $1, 'online', NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM pond_status_log
           WHERE pond_id = $1
             AND recorded_at > NOW() - $2::interval
        )`,
      [pondId, HEARTBEAT_MIN_GAP]
    );

    await insertLog(client, {
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

    await client.query("COMMIT");
    inTx = false;
  } catch (err) {
    console.error("ingest_db_error", err);
    if (inTx) {
      await client.query("ROLLBACK").catch(() => {});
    }
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
  } finally {
    client.release();
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
