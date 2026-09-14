import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 90;

// Gap thresholds — mirrors getPondStatus() in src/lib/pondStatus.ts.
const ONLINE_GAP_SECONDS = 20 * 60;   // gap < 20 min -> online
const STALE_GAP_SECONDS = 45 * 60;    // gap < 45 min -> stale, else offline

type Status = "online" | "stale" | "offline";

type BreakdownEntry = { minutes: number; percent: number };

type PondResult = {
  pondId: number;
  pondName: string;
  totalMinutes: number;
  breakdown: Record<Status, BreakdownEntry>;
};

type SegmentRow = {
  pond_id: number;
  seg_start: Date;
  seg_end: Date;
  status: "online" | "stale" | "offline";
};

type PondRow = {
  id: number;
  name: string;
};

async function allPondIds(): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(`SELECT id FROM ponds`);
  return rows.map((r) => r.id);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const pondsParam = (url.searchParams.get("ponds") ?? "").trim();
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  if (!pondsParam) {
    return NextResponse.json({ error: "ponds_required" }, { status: 400 });
  }
  if (!fromParam || !toParam) {
    return NextResponse.json({ error: "from_and_to_required" }, { status: 400 });
  }
  if (!ISO_DATE.test(fromParam) || !ISO_DATE.test(toParam)) {
    return NextResponse.json({ error: "invalid_date_format" }, { status: 400 });
  }

  const fromMs = Date.parse(`${fromParam}T00:00:00Z`);
  const toMs = Date.parse(`${toParam}T00:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return NextResponse.json({ error: "invalid_date_range" }, { status: 400 });
  }
  const spanDays = Math.round((toMs - fromMs) / (24 * 3600 * 1000));
  if (spanDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: "range_too_large", maxDays: MAX_RANGE_DAYS },
      { status: 400 }
    );
  }

  let pondIds: number[];
  if (pondsParam === "all") {
    pondIds = await allPondIds();
  } else {
    const requested = pondsParam
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (requested.length === 0) {
      return NextResponse.json({ error: "invalid_pond_ids" }, { status: 400 });
    }
    pondIds = requested;
  }

  if (pondIds.length === 0) {
    return NextResponse.json({ data: [], message: "No ponds configured." });
  }

  try {
    const { rows: pondRows } = await pool.query<PondRow>(
      `SELECT id, name FROM ponds WHERE id = ANY($1::int[]) ORDER BY id`,
      [pondIds]
    );

    const emptyEntry = (p: PondRow): PondResult => ({
      pondId: p.id,
      pondName: p.name,
      totalMinutes: 0,
      breakdown: {
        online: { minutes: 0, percent: 0 },
        stale: { minutes: 0, percent: 0 },
        offline: { minutes: 0, percent: 0 },
      },
    });

    // Heartbeat-derived segments. Each consecutive heartbeat pair forms a
    // segment whose status depends on the gap length. Window is anchored on
    // both ends so trailing silence and front gaps are counted.
    const { rows: segRows } = await pool.query<SegmentRow>(
      `WITH bounds AS (
         SELECT $2::timestamptz AS win_start,
                LEAST(($3::date + INTERVAL '1 day')::timestamptz, NOW()) AS win_end
       ),
       prior_hb AS (
         SELECT DISTINCT ON (psl.pond_id) psl.pond_id, psl.recorded_at
           FROM pond_status_log psl, bounds b
          WHERE psl.pond_id = ANY($1::int[])
            AND psl.recorded_at < b.win_start
          ORDER BY psl.pond_id, psl.recorded_at DESC
       ),
       window_hb AS (
         SELECT psl.pond_id, psl.recorded_at
           FROM pond_status_log psl, bounds b
          WHERE psl.pond_id = ANY($1::int[])
            AND psl.recorded_at >= b.win_start
            AND psl.recorded_at <  b.win_end
       ),
       virtual_start AS (
         SELECT p.id AS pond_id, b.win_start AS recorded_at
           FROM unnest($1::int[]) AS p(id), bounds b
          WHERE NOT EXISTS (
            SELECT 1 FROM prior_hb ph WHERE ph.pond_id = p.id
          )
       ),
       virtual_end AS (
         SELECT p.id AS pond_id, b.win_end AS recorded_at
           FROM unnest($1::int[]) AS p(id), bounds b
       ),
       combined AS (
         SELECT pond_id, recorded_at FROM prior_hb
         UNION ALL
         SELECT pond_id, recorded_at FROM virtual_start
         UNION ALL
         SELECT pond_id, recorded_at FROM window_hb
         UNION ALL
         SELECT pond_id, recorded_at FROM virtual_end
       ),
       with_next AS (
         SELECT pond_id, recorded_at,
                LEAD(recorded_at) OVER (
                  PARTITION BY pond_id ORDER BY recorded_at
                ) AS next_at
           FROM combined
       )
       SELECT w.pond_id,
              GREATEST(w.recorded_at, b.win_start) AS seg_start,
              LEAST(w.next_at, b.win_end)          AS seg_end,
              CASE
                WHEN EXTRACT(EPOCH FROM (w.next_at - w.recorded_at)) < $4 THEN 'online'
                WHEN EXTRACT(EPOCH FROM (w.next_at - w.recorded_at)) < $5 THEN 'stale'
                ELSE 'offline'
              END AS status
         FROM with_next w, bounds b
        WHERE w.next_at IS NOT NULL
          AND LEAST(w.next_at, b.win_end) > GREATEST(w.recorded_at, b.win_start)
        ORDER BY w.pond_id, seg_start`,
      [pondIds, fromParam, toParam, ONLINE_GAP_SECONDS, STALE_GAP_SECONDS]
    );

    if (segRows.length === 0) {
      return NextResponse.json({
        data: pondRows.map(emptyEntry),
        message:
          "No status history yet. Data will appear as ponds are monitored.",
      });
    }

    const rawMinutes = new Map<number, Record<Status, number>>();
    const byPond = new Map<number, PondResult>();
    for (const p of pondRows) {
      byPond.set(p.id, emptyEntry(p));
      rawMinutes.set(p.id, { online: 0, stale: 0, offline: 0 });
    }

    for (const seg of segRows) {
      const raw = rawMinutes.get(seg.pond_id);
      if (!raw) continue;
      const segSec = (seg.seg_end.getTime() - seg.seg_start.getTime()) / 1000;
      if (segSec > 0) raw[seg.status] += segSec / 60;
    }

    // Use RAW minutes for percent so rounded display values cannot push the
    // sum above 100%. Round only for display.
    for (const entry of byPond.values()) {
      const raw = rawMinutes.get(entry.pondId);
      let totalRaw = 0;
      if (raw) {
        for (const s of ["online", "stale", "offline"] as Status[]) {
          totalRaw += raw[s];
        }
      }
      entry.totalMinutes = Math.round(totalRaw * 10) / 10;
      for (const s of ["online", "stale", "offline"] as Status[]) {
        const m = raw ? raw[s] : 0;
        entry.breakdown[s].minutes = Math.round(m * 10) / 10;
        entry.breakdown[s].percent =
          totalRaw > 0 ? Math.round((m / totalRaw) * 1000) / 10 : 0;
      }
    }

    return NextResponse.json({ data: Array.from(byPond.values()) });
  } catch (err) {
    console.error("utilization_query_error", err);
    const message = err instanceof Error ? err.message : "db_error";
    return NextResponse.json(
      { error: "db_error", message },
      { status: 500 }
    );
  }
}
