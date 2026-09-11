import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StatusFilter = "success" | "error" | null;

type LogRow = {
  id: string;
  received_at: string;
  pond_id: number | null;
  pond_code: string | null;
  pond_name: string | null;
  raw_payload: unknown;
  temperature: number | null;
  ph: number | null;
  salinity: number | null;
  dissolved_oxygen: number | null;
  http_status: number;
  ip_address: string | null;
  error_message: string | null;
};

function parseStatus(v: string | null): StatusFilter {
  if (v === "success" || v === "error") return v;
  return null;
}

function parseDate(v: string | null): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const exportMode = url.searchParams.get("export") === "true";

  const pondParam = url.searchParams.get("pond");
  const pondId =
    pondParam && /^\d+$/.test(pondParam) ? parseInt(pondParam, 10) : null;
  const status = parseStatus(url.searchParams.get("status"));
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"));

  const pageRaw = parseInt(url.searchParams.get("page") ?? "1", 10);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit = Math.min(
    100,
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 50)
  );
  const offset = (page - 1) * limit;

  const baseWhere = `
    ($1::int IS NULL OR l.pond_id = $1)
    AND (
      $2::text IS NULL OR (
        ($2 = 'success' AND l.http_status BETWEEN 200 AND 299)
        OR ($2 = 'error'   AND NOT (l.http_status BETWEEN 200 AND 299))
      )
    )
    AND ($3::timestamptz IS NULL OR l.received_at >= $3)
    AND ($4::timestamptz IS NULL OR l.received_at <= $4)
  `;

  if (exportMode) {
    const { rows } = await pool.query<LogRow>(
      `SELECT
         l.id, l.received_at, l.pond_id, l.pond_code,
         p.name AS pond_name,
         l.raw_payload,
         l.temperature, l.ph, l.salinity, l.dissolved_oxygen,
         l.http_status, l.ip_address, l.error_message
       FROM ingestion_logs l
       LEFT JOIN ponds p ON p.id = l.pond_id
       WHERE ${baseWhere}
       ORDER BY l.received_at DESC`,
      [pondId, status, from, to]
    );

    const header = [
      "Received At",
      "Pond Code",
      "Pond Name",
      "Temperature",
      "pH",
      "Salinity",
      "Dissolved Oxygen",
      "HTTP Status",
      "IP Address",
      "Error",
      "Raw Payload",
    ];
    const lines = [header.map(csvEscape).join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.received_at,
          r.pond_code,
          r.pond_name,
          r.temperature,
          r.ph,
          r.salinity,
          r.dissolved_oxygen,
          r.http_status,
          r.ip_address,
          r.error_message,
          r.raw_payload,
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    const csv = lines.join("\n");
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ingestion_logs_${stamp}.csv"`,
      },
    });
  }

  const totalQuery = pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM ingestion_logs l
      WHERE ${baseWhere}`,
    [pondId, status, from, to]
  );

  const pageQuery = pool.query<LogRow>(
    `SELECT
       l.id, l.received_at, l.pond_id, l.pond_code,
       p.name AS pond_name,
       l.raw_payload,
       l.temperature, l.ph, l.salinity, l.dissolved_oxygen,
       l.http_status, l.ip_address, l.error_message
     FROM ingestion_logs l
     LEFT JOIN ponds p ON p.id = l.pond_id
     WHERE ${baseWhere}
     ORDER BY l.received_at DESC
     LIMIT $5 OFFSET $6`,
    [pondId, status, from, to, limit, offset]
  );

  try {
    const [totalRes, pageRes] = await Promise.all([totalQuery, pageQuery]);
    const total = parseInt(totalRes.rows[0]?.total ?? "0", 10);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return NextResponse.json({
      logs: pageRes.rows.map((r) => ({
        id: r.id,
        received_at: r.received_at,
        pond_id: r.pond_id,
        pond_code: r.pond_code,
        pond_name: r.pond_name,
        raw_payload: r.raw_payload,
        temperature: r.temperature,
        ph: r.ph,
        salinity: r.salinity,
        dissolved_oxygen: r.dissolved_oxygen,
        http_status: r.http_status,
        ip_address: r.ip_address,
        error_message: r.error_message,
      })),
      total,
      page,
      limit,
      totalPages,
    });
  } catch (err) {
    console.error("admin_logs_get_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
