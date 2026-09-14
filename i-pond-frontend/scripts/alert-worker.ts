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
const CONNECTIVITY_TIMEOUT_MINS = 20;

// A sensor alert needs the reading to be out of range for a sustained window,
// not just a handful of samples: the USB gateway posts every few seconds, so
// "7 consecutive readings" was under a minute. Every reading in the window
// must be out of range, and there must be at least MIN_READINGS of them.
const SENSOR_WINDOW_MINUTES = 30;
const SENSOR_MIN_READINGS = 7;

// After an alert is acknowledged, the same pond + sensor is not raised again
// for this long even if the condition persists. Without this the worker (every
// 5 min) and /api/ponds/status (every 30 s) re-created an alert moments after
// every acknowledgement — the popup came straight back.
const REALERT_COOLDOWN = '24 hours';

/** No open alert, and none acknowledged inside the cooldown, for this pond + sensor. */
async function mayRaise(pondId: number, sensor: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM sensor_alerts
      WHERE pond_id = $1 AND sensor = $2
        AND resolved_at IS NULL
        AND (acknowledged_at IS NULL OR acknowledged_at > NOW() - $3::interval)
      LIMIT 1`,
    [pondId, sensor, REALERT_COOLDOWN],
  );
  return rows.length === 0;
}

async function checkConnectivityAlert(pondId: number, pondName: string) {
  const { rows } = await pool.query<{ last_seen: Date | null }>(
    `SELECT MAX(time) AS last_seen FROM sensor_readings WHERE pond_id = $1`,
    [pondId],
  );

  const lastSeen = rows[0]?.last_seen;
  const minutesAgo = lastSeen
    ? (Date.now() - new Date(lastSeen).getTime()) / 1000 / 60
    : null;

  // A pond that has never sent anything has no connection to lose — it is
  // a pond without a gateway (or not yet wired), and alerting on it every
  // day forever is noise. The dashboard still shows it as offline.
  if (minutesAgo === null) return;

  if (minutesAgo >= CONNECTIVITY_TIMEOUT_MINS) {
    if (await mayRaise(pondId, 'connectivity')) {
      await pool.query(
        `INSERT INTO sensor_alerts
           (pond_id, sensor, triggered_at, consecutive_count, last_value, optimal_min, optimal_max)
         VALUES ($1, 'connectivity', NOW(), 1, $2, 0, 0)`,
        [pondId, minutesAgo],
      );
      console.log(
        `[ALERT] Pond ${pondId} (${pondName}) connectivity — ${minutesAgo.toFixed(0)} mins since last data`,
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
          AND time >= NOW() - make_interval(mins => $2)
        ORDER BY time DESC`,
      [pondId, SENSOR_WINDOW_MINUTES],
    );

    if (readings.length < SENSOR_MIN_READINGS) continue;

    const allOutOfRange = readings.every(
      (r) => r.value < optimal_min || r.value > optimal_max,
    );

    if (allOutOfRange) {
      if (await mayRaise(pondId, sensor)) {
        const lastValue = readings[0].value;
        await pool.query(
          `INSERT INTO sensor_alerts
             (pond_id, sensor, triggered_at, consecutive_count, last_value, optimal_min, optimal_max)
           VALUES ($1, $2, NOW(), $3, $4, $5, $6)`,
          [pondId, sensor, readings.length, lastValue, optimal_min, optimal_max],
        );
        console.log(`[ALERT] Pond ${pondId} — ${sensor} alert. Last: ${lastValue} (${readings.length} readings in ${SENSOR_WINDOW_MINUTES} min)`);
      }
    } else {
      // Back in range (at least one in-range reading in the window): close any
      // open alert so the popup and badge let go of it without a click.
      await pool.query(
        `UPDATE sensor_alerts
            SET resolved_at = NOW()
          WHERE pond_id = $1 AND sensor = $2 AND resolved_at IS NULL`,
        [pondId, sensor],
      );
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
