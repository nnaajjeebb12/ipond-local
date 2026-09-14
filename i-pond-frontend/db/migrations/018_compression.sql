-- 018_compression.sql
-- Native TimescaleDB compression for sensor_readings.
--
-- WHY: at one reading every few seconds, raw rows plus their three indexes
-- cost ~200 bytes each — roughly 17 MB/day/pond. A 14.6 GB USB drive fills in
-- well under a year with a few ponds. Compressed chunks are typically 10-20x
-- smaller, and range scans over old data read far fewer pages, which matters
-- on slow flash.
--
-- Chunks older than 30 days are compressed. Anything the dashboard reads
-- routinely (today / 7d / 14d / 30d) comes from the 15-minute rollup (017) or
-- from uncompressed chunks. Rows in compressed chunks can still be read,
-- inserted (ON CONFLICT works) and updated — the sync worker's
-- `UPDATE ... SET synced_at` on a row that has been waiting 30+ days to ship
-- still succeeds, it is just slower because the chunk is decompressed on the
-- way. That is the offline-for-a-month edge case, not the normal path.
--
-- segment_by pond_id / order_by time DESC matches every query pattern here
-- and covers the unique index (pond_id, time), which TimescaleDB requires.
--
-- Idempotent: ALTER TABLE SET is a no-op if already set; the policy uses
-- if_not_exists.

ALTER TABLE sensor_readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'pond_id',
    timescaledb.compress_orderby   = 'time DESC'
);

SELECT add_compression_policy(
    'sensor_readings',
    compress_after => INTERVAL '30 days',
    if_not_exists  => TRUE
);
