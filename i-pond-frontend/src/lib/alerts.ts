import type { PoolClient } from "pg";
import { pool } from "@/lib/db";

const CONSECUTIVE_THRESHOLD = 7;

type Sensor = "temperature" | "ph" | "salinity" | "dissolved_oxygen";

const SENSOR_COLUMN: Record<Sensor, string> = {
  temperature: "temperature",
  ph: "ph",
  salinity: "salinity",
  dissolved_oxygen: "dissolved_oxygen",
};

export async function checkForAlert(
  pondId: number,
  sensor: Sensor,
  value: number
): Promise<void> {
  const col = SENSOR_COLUMN[sensor];

  const { rows: thresholds } = await pool.query<{
    optimal_min: number;
    optimal_max: number;
  }>(
    `SELECT optimal_min, optimal_max
       FROM pond_sensor_thresholds
      WHERE pond_id = $1 AND sensor = $2`,
    [pondId, sensor]
  );

  if (thresholds.length === 0) return;
  const { optimal_min, optimal_max } = thresholds[0];

  const { rows } = await pool.query<{ value: number | null }>(
    `SELECT ${col} AS value
       FROM sensor_readings
      WHERE pond_id = $1 AND ${col} IS NOT NULL
      ORDER BY time DESC
      LIMIT ${CONSECUTIVE_THRESHOLD}`,
    [pondId]
  );

  const haveEnough = rows.length === CONSECUTIVE_THRESHOLD;
  const allOutOfRange =
    haveEnough &&
    rows.every((r) => {
      const v = r.value;
      return v !== null && (v < optimal_min || v > optimal_max);
    });

  if (!allOutOfRange) return;

  const { rows: existing } = await pool.query<{ id: string }>(
    `SELECT id FROM sensor_alerts
      WHERE pond_id = $1 AND sensor = $2 AND acknowledged_at IS NULL
      LIMIT 1`,
    [pondId, sensor]
  );

  if (existing.length > 0) return;

  await pool.query(
    `INSERT INTO sensor_alerts
       (pond_id, sensor, consecutive_count, last_value, optimal_min, optimal_max)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [pondId, sensor, CONSECUTIVE_THRESHOLD, value, optimal_min, optimal_max]
  );
}

export async function runAlertChecks(
  pondId: number,
  values: {
    temperature: number | null;
    ph: number | null;
    salinity: number | null;
    dissolved_oxygen: number | null;
  }
): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (values.temperature !== null) tasks.push(checkForAlert(pondId, "temperature", values.temperature));
  if (values.ph !== null) tasks.push(checkForAlert(pondId, "ph", values.ph));
  if (values.salinity !== null) tasks.push(checkForAlert(pondId, "salinity", values.salinity));
  if (values.dissolved_oxygen !== null) tasks.push(checkForAlert(pondId, "dissolved_oxygen", values.dissolved_oxygen));

  try {
    await Promise.all(tasks);
  } catch (err) {
    console.error("alert_check_error", err);
  }
}

export type { Sensor, PoolClient };
