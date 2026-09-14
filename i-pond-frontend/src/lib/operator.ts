/**
 * Local operator identity — the appliance has no users and no sessions.
 *
 * Several tables still reference `owners(id)`: `maintenance_requests.requested_by` (table kept, feature removed)
 * is NOT NULL, and the alert / threshold audit columns are foreign keys. Every
 * write from this appliance is attributed to a single local operator row so
 * those constraints hold and the audit trail stays readable.
 *
 * This is identity for record-keeping only. It grants nothing — there is no
 * authorization left to grant.
 *
 * Self-healing: if the owners table is empty (a Pi that never ran the seed, or
 * was seeded by hand), the operator row is created on first use. Without this,
 * every acknowledge / maintenance / threshold write fails a foreign-key check
 * with a 500 and the UI just silently does nothing.
 */
import { pool } from "@/lib/db";

/** Matches db/seeds/002_local_appliance.sql so a later seed run is a no-op. */
const OPERATOR = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Local Operator",
  email: "operator@localhost",
};

let cached: string | null = null;

/** The `owners.id` to stamp on rows this appliance writes. Resolved once per process. */
export async function getOperatorId(): Promise<string> {
  if (cached !== null) return cached;

  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM owners ORDER BY created_at ASC LIMIT 1`
  );
  if (rows[0]) {
    cached = rows[0].id;
    return cached;
  }

  // No owner at all — create the one the seed would have. ON CONFLICT covers
  // a race with a concurrent first request or a seed running at the same time.
  await pool.query(
    `INSERT INTO owners (id, name, email, role, password_hash)
     VALUES ($1, $2, $3, 'admin', '')
     ON CONFLICT (id) DO NOTHING`,
    [OPERATOR.id, OPERATOR.name, OPERATOR.email]
  );
  console.warn("operator_row_created", OPERATOR.id);

  cached = OPERATOR.id;
  return cached;
}
