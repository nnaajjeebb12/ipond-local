/**
 * Local operator identity — the appliance has no users and no sessions.
 *
 * Several tables still reference `owners(id)`: `maintenance_requests.requested_by`
 * is NOT NULL, and the alert / threshold audit columns are foreign keys. Every
 * write from this appliance is attributed to a single local operator row so
 * those constraints hold and the audit trail stays readable.
 *
 * This is identity for record-keeping only. It grants nothing — there is no
 * authorization left to grant.
 */
import { pool } from "@/lib/db";

/** Seeded admin (db/seeds/001_seed.sql) — fallback when the lookup finds nothing. */
const FALLBACK_OPERATOR_ID = "00000000-0000-0000-0000-000000000001";

let cached: string | null = null;

/** The `owners.id` to stamp on rows this appliance writes. Resolved once per process. */
export async function getOperatorId(): Promise<string> {
  if (cached !== null) return cached;

  let id = FALLBACK_OPERATOR_ID;
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM owners ORDER BY created_at ASC LIMIT 1`
    );
    if (rows[0]) id = rows[0].id;
  } catch {
    // DB unreachable — fall back to the seeded id.
  }

  cached = id;
  return cached;
}
