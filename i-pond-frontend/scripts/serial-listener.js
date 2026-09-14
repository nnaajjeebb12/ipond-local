/**
 * USB serial listener — the ESP32 gateway's link to the Pi.
 *
 * The gateway no longer has Wi-Fi. It prints one JSON line per reading over
 * USB serial, in exactly the shape the ingestion route expects:
 *
 *   {"data":{"pnd":3.00,"rtd":28.40,"ph":7.10,"sal":16.20,"dox":6.60}}
 *
 * This process reads those lines and POSTs each one to /api/send-sensor-data
 * on localhost, so the rest of the system (ingestion log, heartbeat, alerts,
 * cloud sync) works unchanged.
 *
 * Runs forever under systemd (see docs/Pi-Deployment-Checklist.md). If the
 * cable is pulled or the gateway resets, the port closes and this process
 * EXITS — that is deliberate, so systemd's Restart=always brings it back
 * and re-opens the port. A process that swallowed the close would sit alive
 * and deaf, and nothing would ever restart it.
 *
 * Test without hardware by piping lines on stdin:
 *   echo '{"data":{"pnd":1,"rtd":28,"ph":7,"sal":15,"dox":6}}' \
 *     | SERIAL_PORT=- node scripts/serial-listener.js
 */
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const readline = require('node:readline');

function loadEnv() {
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
    // .env may not exist when systemd supplies the environment
  }
}

loadEnv();

const PORT_PATH = process.env.SERIAL_PORT || '/dev/ttyUSB0';
const BAUD = Number(process.env.SERIAL_BAUD || 9600); // must match Serial.begin() in the firmware
const API_URL = process.env.INGEST_URL || 'http://localhost:3000/api/send-sensor-data';
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.error('API_TOKEN is not set (put it in .env or the service environment)');
  process.exit(1);
}

function stamp() {
  return new Date().toISOString();
}

let forwarded = 0;
let rejected = 0;

// In-flight POSTs, so a port close (or end of stdin) waits for them to land
// before the process exits instead of killing them mid-request.
const inflight = new Set();

function track(promise) {
  inflight.add(promise);
  promise.finally(() => inflight.delete(promise));
  return promise;
}

async function drainAndExit(code, why) {
  if (inflight.size > 0) {
    console.log(`[${stamp()}] ${why} — waiting for ${inflight.size} in-flight POST(s)`);
    await Promise.allSettled([...inflight]);
  }
  console.log(`[${stamp()}] ${why} — forwarded ${forwarded}, rejected ${rejected}`);
  // Same lesson as sync-worker.ts: never process.exit() straight after a fetch.
  // Its teardown leaves an async handle mid-close and exiting on top of it
  // aborts with a libuv assertion (exit 127). Set the code and let the loop
  // drain; the unref'd timer is only a backstop and does not hold us open.
  process.exitCode = code;
  setTimeout(() => process.exit(code), 2000).unref();
}

async function forward(line) {
  line = line.trim();
  // The gateway only prints JSON, but on reset the ESP32 bootloader emits
  // garbage at a different baud rate; anything not starting with "{" is noise.
  if (!line.startsWith('{')) return;

  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    rejected += 1;
    console.error(`[${stamp()}] not JSON, skipped: ${line.slice(0, 80)}`);
    return;
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.data) {
    rejected += 1;
    console.error(`[${stamp()}] no "data" object, skipped: ${line.slice(0, 80)}`);
    return;
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_TOKEN}`,
      },
      body: line,
    });
    const text = await res.text();
    if (res.ok) {
      forwarded += 1;
      console.log(`[${stamp()}] pond ${parsed.data.pnd} -> ${res.status} (${forwarded} total)`);
    } else {
      rejected += 1;
      console.error(`[${stamp()}] pond ${parsed.data.pnd} -> ${res.status} ${text.slice(0, 120)}`);
    }
  } catch (err) {
    // The app is down or restarting. The reading is lost — the gateway has no
    // buffer — so say so plainly. systemd ordering (After=ipond.service) keeps
    // this rare.
    rejected += 1;
    console.error(`[${stamp()}] POST failed (is the app running?): ${err.message}`);
  }
}

function attach(stream, label) {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  rl.on('line', (line) => {
    track(forward(line).catch((err) => console.error(`[${stamp()}] unexpected: ${err.message}`)));
  });
  console.log(`[${stamp()}] listening on ${label}`);
}

if (PORT_PATH === '-') {
  // Test mode: lines from stdin, exit when it closes.
  attach(process.stdin, 'stdin');
  process.stdin.on('end', () => drainAndExit(0, 'stdin closed'));
} else {
  const { SerialPort } = require('serialport');

  // When the port cannot be opened (cable out, wrong path), wait before
  // exiting. The supervisor restarts us either way; without the pause it
  // does so every ~0.4 s for as long as the cable is out — one Pi racked up
  // 6,000 restarts and two log lines per second overnight.
  const REOPEN_DELAY_MS = 10_000;

  const port = new SerialPort({ path: PORT_PATH, baudRate: BAUD }, (err) => {
    if (err) {
      console.error(`[${stamp()}] cannot open ${PORT_PATH}: ${err.message}`);
      console.error(`  Is the gateway plugged in? Try: ls -l /dev/serial/by-id/  — retrying in ${REOPEN_DELAY_MS / 1000}s`);
      setTimeout(() => process.exit(1), REOPEN_DELAY_MS);
    }
  });

  port.on('open', () => attach(port, `${PORT_PATH} @ ${BAUD} baud`));

  port.on('error', (err) => {
    console.error(`[${stamp()}] serial error: ${err.message}`);
  });

  port.on('close', () => {
    console.error(`[${stamp()}] ${PORT_PATH} closed (cable unplugged or gateway reset) — exiting so the service restarts`);
    drainAndExit(1, 'port closed');
  });
}
