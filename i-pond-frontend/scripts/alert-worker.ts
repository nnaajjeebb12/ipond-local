import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

function loadEnv(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2];
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {
    // .env may not exist in production
  }
}

loadEnv();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  ssl: false,
});

const SENSORS = ['temperature', 'ph', 'salinity', 'dissolved_oxygen'] as const;
const CONSECUTIVE_THRESHOLD = 7;
const CONNECTIVITY_TIMEOUT_MINS = 20;

async function checkConnectivityAlert(pondId: number, pondName: string) {
  const { rows } = await pool.query<{ last_seen: Date | null }>(
    `SELECT MAX(time) AS last_seen FROM sensor_readings WHERE pond_id = $1`,
    [pondId],
  );

  const lastSeen = rows[0]?.last_seen;
  const minutesAgo = lastSeen
    ? (Date.now() - new Date(lastSeen).getTime()) / 1000 / 60
    : null;

  if (minutesAgo === null || minutesAgo >= CONNECTIVITY_TIMEOUT_MINS) {
    const existing = await pool.query(
      `SELECT id FROM sensor_alerts
        WHERE pond_id = $1 AND sensor = 'connectivity' AND acknowledged_at IS NULL`,
      [pondId],
    );

    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO sensor_alerts
           (pond_id, sensor, triggered_at, consecutive_count, last_value, optimal_min, optimal_max)
         VALUES ($1, 'connectivity', NOW(), 1, $2, 0, 0)`,
        [pondId, minutesAgo ?? -1],
      );
      console.log(
        `[ALERT] Pond ${pondId} (${pondName}) connectivity — ${minutesAgo?.toFixed(0) ?? 'never'} mins since last data`,
      );
    }
  } else {
    await pool.query(
      `UPDATE sensor_alerts
        SET resolved_at = NOW()
       WHERE pond_id = $1 AND sensor = 'connectivity' AND resolved_at IS NULL`,
      [pondId],
    );
  }
}

async function checkSensorAlerts(pondId: number) {
  for (const sensor of SENSORS) {
    const { rows: thresholds } = await pool.query<{
      optimal_min: number;
      optimal_max: number;
    }>(
      `SELECT optimal_min, optimal_max
         FROM pond_sensor_thresholds
        WHERE pond_id = $1 AND sensor = $2`,
      [pondId, sensor],
    );

    if (thresholds.length === 0) continue;

    const { optimal_min, optimal_max } = thresholds[0];

    const { rows: readings } = await pool.query<{ value: number }>(
      `SELECT ${sensor} AS value
         FROM sensor_readings
        WHERE pond_id = $1 AND ${sensor} IS NOT NULL
        ORDER BY time DESC
        LIMIT ${CONSECUTIVE_THRESHOLD}`,
      [pondId],
    );

    if (readings.length < CONSECUTIVE_THRESHOLD) continue;

    const allOutOfRange = readings.every(
      (r) => r.value < optimal_min || r.value > optimal_max,
    );

    if (allOutOfRange) {
      const existing = await pool.query(
        `SELECT id FROM sensor_alerts
          WHERE pond_id = $1 AND sensor = $2 AND acknowledged_at IS NULL`,
        [pondId, sensor],
      );

      if (existing.rows.length === 0) {
        const lastValue = readings[0].value;
        await pool.query(
          `INSERT INTO sensor_alerts
             (pond_id, sensor, triggered_at, consecutive_count, last_value, optimal_min, optimal_max)
           VALUES ($1, $2, NOW(), $3, $4, $5, $6)`,
          [pondId, sensor, CONSECUTIVE_THRESHOLD, lastValue, optimal_min, optimal_max],
        );
        console.log(`[ALERT] Pond ${pondId} — ${sensor} alert. Last: ${lastValue}`);
      }
    }
  }
}

async function run() {
  console.log(`[${new Date().toISOString()}] Alert worker running...`);

  const { rows: ponds } = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM ponds',
  );

  for (const pond of ponds) {
    await checkConnectivityAlert(pond.id, pond.name);
    await checkSensorAlerts(pond.id);
  }

  console.log(`[${new Date().toISOString()}] Alert worker done.`);
  await pool.end();
  process.exit(0);
}

run().catch((err) => {
  console.error('Alert worker error:', err);
  process.exit(1);
});
