const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const PORT_PATH = process.env.SERIAL_PORT || '/dev/ttyUSB0';
const BAUD = 9600;
const API_URL = 'http://localhost:3000/api/send-sensor-data';
const API_TOKEN = process.env.API_TOKEN;

if (!API_TOKEN) {
  console.error('API_TOKEN not set in environment');
  process.exit(1);
}

const port = new SerialPort({ path: PORT_PATH, baudRate: BAUD });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

port.on('open', () => console.log(`Listening on ${PORT_PATH} @ ${BAUD}`));
port.on('error', (err) => console.error('Serial error:', err.message));

parser.on('data', async (line) => {
  line = line.trim();
  if (!line.startsWith('{')) return; // skip LCD debug lines etc.

  try {
    JSON.parse(line); // validate before forwarding
  } catch {
    console.error('Skipping invalid JSON:', line);
    return;
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_TOKEN}`,
      },
      body: line,
    });
    const text = await res.text();
    console.log(`[${res.status}]`, text);
  } catch (err) {
    console.error('POST failed:', err.message);
  }
});
