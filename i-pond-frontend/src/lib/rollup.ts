/**
 * SQL fragments for reading from the 15-minute continuous aggregate
 * `sensor_readings_15m` (migration 017) instead of raw `sensor_readings`.
 *
 * The rollup stores SUM + COUNT + MIN + MAX per sensor per 15-minute bucket,
 * so any coarser bucket (1 h, 3 h, 6 h, 1 day) is an exact re-aggregation:
 * weighted average, min of mins, max of maxes. Real-time aggregation is on,
 * so the bucket that is still filling is computed from raw rows on the fly.
 *
 * Every fragment takes the rollup's table alias and a validated sensor column
 * name (`temperature`, `ph`, `salinity`, `dissolved_oxygen`) — callers must
 * only pass names from their SENSOR_COLUMNS map, never user input.
 */

export const ROLLUP_VIEW = "sensor_readings_15m";

/** Weighted average over the buckets being grouped, rounded like every other sensor value. */
export function rollupAvg(a: string, col: string): string {
  return `ROUND((SUM(${a}.${col}_sum) / NULLIF(SUM(${a}.${col}_cnt), 0))::numeric, 2)::float8`;
}

export function rollupMin(a: string, col: string): string {
  return `ROUND(MIN(${a}.${col}_min)::numeric, 2)::float8`;
}

export function rollupMax(a: string, col: string): string {
  return `ROUND(MAX(${a}.${col}_max)::numeric, 2)::float8`;
}

/**
 * Readings outside the pond's optimal range, at 15-minute resolution: a
 * 15-minute bucket whose AVERAGE is out of range contributes all of its
 * readings. This matches how the chart colours a bucket's health (also by
 * average), so the anomaly count and the health colour always agree. It is
 * not a per-reading count — a single spike inside an otherwise-normal
 * quarter hour is not counted.
 *
 * `pst` must be the pond_sensor_thresholds alias in the enclosing query.
 */
export function rollupAnomalyCount(a: string, col: string, pst = "pst"): string {
  const avg = `(${a}.${col}_sum / NULLIF(${a}.${col}_cnt, 0))`;
  return `COALESCE(SUM(${a}.${col}_cnt) FILTER (
            WHERE ${avg} < ${pst}.optimal_min
               OR ${avg} > ${pst}.optimal_max
          ), 0)`;
}
