# Raspberry Pi Deployment Checklist

**Soletronix iPond — local appliance**

This guide takes a brand-new Raspberry Pi to a working pond-monitoring
appliance. It assumes **no prior experience** with Linux, Docker, Node.js or
databases. Every command is copy-paste. After each step there is a
**"You should see"** block — if your screen does not match it, stop and go to
[Troubleshooting](#12-troubleshooting) rather than continuing.

Work top to bottom. Tick each box as you go.

---

## Contents

| Phase | What it does | Time |
|---|---|---|
| [0. Before you start](#0-before-you-start) | Gather hardware, tokens, licence | — |
| [1. Prepare the Pi](#1-prepare-the-raspberry-pi) | OS, updates, remote access | 30 min |
| [2. Install software](#2-install-the-software-the-app-needs) | Node, Docker, nginx, git | 20 min |
| [3. Get the code](#3-get-the-code-onto-the-pi) | Clone the repository | 5 min |
| [4. Configure](#4-configure-the-appliance-env) | Write the `.env` file | 15 min |
| [5. Licence](#5-install-the-licence-file) | Install the signed licence | 15 min |
| [6. Database](#6-start-the-database) | Start TimescaleDB, seed it | 15 min |
| [7. Build](#7-build-the-application) | Compile the app | 10–25 min |
| [8. Run as a service](#8-run-it-as-a-service-systemd) | Auto-start on boot | 15 min |
| [9. Web access](#9-put-it-on-port-80-nginx) | Reach it from any device | 10 min |
| [10. Background jobs](#10-schedule-the-background-jobs-cron) | Alerts + cloud sync | 10 min |
| [11. Connect the ESP32](#11-point-the-esp32-at-the-pi) | Point sensors at the Pi | 15 min |
| [12. Final checks](#12-final-acceptance-test) | Prove it all works | 15 min |

---

## Words you will see

Read this once. You do not need to memorise it.

- **Terminal** — the black window where you type commands.
- **`sudo`** — "do this as administrator". It may ask for your password. While
  typing a password **nothing appears on screen** — that is normal, keep typing
  and press Enter.
- **Docker** — runs the database in a sealed box so it cannot conflict with
  anything else on the Pi.
- **TimescaleDB** — the database that stores sensor readings.
- **Node.js** — the engine that runs the dashboard.
- **nginx** — puts the dashboard on the normal web port so you can visit it
  without typing a port number.
- **systemd** — starts the dashboard automatically when the Pi powers on.
- **cron** — runs jobs on a timer (alerts every 5 minutes, cloud sync every 5
  minutes).
- **`.env`** — a plain text file holding passwords and settings. **Never share
  it, never commit it to git.**

> **How to paste into the terminal:** `Ctrl+Shift+V` (not `Ctrl+V`).
> **How to save in the `nano` editor:** `Ctrl+O`, then `Enter`, then `Ctrl+X`.

---

## 0. Before you start

### 0.1 Hardware

- [ ] Raspberry Pi **4 or 5**, with **4 GB RAM or more**
      *(2 GB can work but you must add swap in step 7.2. A Pi 3 is not
      supported — the database will not run well.)*
- [ ] microSD card, **32 GB or larger**, Class 10 / A1 or better
- [ ] Official power supply (an underpowered charger causes random corruption)
- [ ] Ethernet cable to the site router — **strongly preferred over Wi-Fi** for
      an always-on appliance
- [ ] A laptop on the same network, to do the setup over SSH
- [ ] The ESP32 gateway(s) already installed at the ponds

### 0.2 Information to collect

Write these down now. You cannot finish without them.

- [ ] **`API_TOKEN`** — the token already compiled into the ESP32 firmware.
      It must match **exactly**, character for character.
- [ ] **`SYNC_TOKEN`** — a **new, different** token for cloud sync. Ask
      Soletronix for it, or generate one in step 4 and send it to them.
      ⚠️ **It must not be the same as `API_TOKEN`.** They are deliberately
      separate so a compromised pond sensor cannot rewrite historical data, and
      a leaked sync token cannot impersonate a sensor.
- [ ] **Client / site name** — as it should appear on the licence.
- [ ] **Number of ponds** at this site (1–10).
- [ ] **Repository URL** for this project.
- [ ] A **fixed IP address** for the Pi, or a DHCP reservation on the router.
      *(Ask whoever manages the site network. Without this, the Pi's address
      can change and the ESP32s will stop finding it.)*

### 0.3 The licence — start this first, it has a waiting time

The dashboard **will not display anything** without a valid licence file. The
licence is signed by Soletronix and locked to **one specific Pi**, so it cannot
be created until the Pi is running (you need its serial number, step 5.1).

- [ ] Email **sales@soletronix.com** now to open the request, so it is in
      progress while you do steps 1–4.

---

## 1. Prepare the Raspberry Pi

### 1.1 Flash the operating system

- [ ] On your laptop, install **Raspberry Pi Imager** from
      <https://www.raspberrypi.com/software/>
- [ ] Insert the microSD card.
- [ ] Open Imager and choose:
  - **Device:** your Pi model
  - **Operating System:** `Raspberry Pi OS (64-bit)`
    ⚠️ **It must be 64-bit.** The database will not run on 32-bit.
  - **Storage:** your microSD card
- [ ] Click the **gear / "Edit Settings"** button and set:
  - Hostname: `ipond`
  - ✅ Enable SSH → *Use password authentication*
  - Username: `pi` — Password: choose a strong one and **write it down**
  - Configure Wi-Fi *(only if you cannot use Ethernet)*
  - Locale / timezone: **`Asia/Manila`**
- [ ] Click **Write** and wait for it to finish and verify.

### 1.2 First boot

- [ ] Put the card in the Pi, connect the Ethernet cable, then connect power.
- [ ] Wait **2–3 minutes** for the first boot.

### 1.3 Connect from your laptop

- [ ] Open a terminal on your laptop (on Windows: **PowerShell**) and run:

```bash
ssh pi@ipond.local
```

If that fails, find the Pi's IP on your router's admin page and use
`ssh pi@192.168.1.50` (substituting the real address).

- [ ] Type `yes` when asked about authenticity, then enter your password.

> **You should see:** a prompt ending in `pi@ipond:~ $`
> Everything from here on is typed in **this** window.

### 1.4 Update the system

```bash
sudo apt update && sudo apt full-upgrade -y
```

- [ ] Wait for it to finish (can take 10+ minutes on a fresh install).
- [ ] Reboot and reconnect:

```bash
sudo reboot
```

Wait one minute, then `ssh pi@ipond.local` again.

### 1.5 Set the timezone and confirm the architecture

```bash
sudo timedatectl set-timezone Asia/Manila
timedatectl | grep "Time zone"
uname -m
```

> **You should see:** `Time zone: Asia/Manila (PST, +0800)` and `aarch64`.
>
> ⚠️ If `uname -m` says `armv7l`, you installed **32-bit** Raspberry Pi OS.
> Go back to step 1.1 and reflash with the 64-bit version. Nothing later will
> work otherwise.

---

## 2. Install the software the app needs

### 2.1 Git

```bash
sudo apt install -y git
git --version
```

### 2.2 Node.js 22

The version in the Raspberry Pi OS repository is too old. Install from
NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

> **You should see:** `v22.x.x` and a npm version of `10` or higher.
> Node 20 also works; **Node 18 or older will not.**

### 2.3 Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker pi
```

- [ ] **Log out and back in** for the group change to take effect:

```bash
exit
```

Then `ssh pi@ipond.local` again and verify:

```bash
docker run --rm hello-world
```

> **You should see:** `Hello from Docker!`
> If you instead see `permission denied`, you did not log out and back in.

### 2.4 nginx

```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

- [ ] In a browser on your laptop, visit `http://ipond.local`

> **You should see:** the default *"Welcome to nginx!"* page. We replace this in
> step 9.

---

## 3. Get the code onto the Pi

```bash
cd /home/pi
git clone <REPOSITORY-URL> ipond-local
cd ipond-local
ls
```

> **You should see:** `BACKEND_PRD.md  FRONTEND_PRD.md  i-pond-frontend`

⚠️ **Important — two folder levels.** The repository root is
`/home/pi/ipond-local`, but the application lives one level down in
`/home/pi/ipond-local/i-pond-frontend`. Almost every command below runs in the
**application** folder. To save typing:

```bash
echo 'export APP_DIR=/home/pi/ipond-local/i-pond-frontend' >> ~/.bashrc
source ~/.bashrc
cd $APP_DIR
pwd
```

> **You should see:** `/home/pi/ipond-local/i-pond-frontend`

### 3.1 Install the app's dependencies

```bash
cd $APP_DIR
npm install
```

- [ ] This takes **5–15 minutes** and prints a lot of text. Warnings are normal;
      lines starting with `npm error` are not.

⚠️ Do **not** use `npm install --production`. The background workers need the
development dependencies (`tsx`) to run.

---

## 4. Configure the appliance (`.env`)

```bash
cd $APP_DIR
cp .env.example .env
```

### 4.1 Generate the database password and sync token

```bash
openssl rand -hex 16   # use this for POSTGRES_PASSWORD
openssl rand -hex 32   # use this for SYNC_TOKEN (only if Soletronix didn't give you one)
```

- [ ] Copy both results somewhere safe before continuing.

### 4.2 Edit the file

```bash
nano .env
```

Fill in every value. The file should end up looking like this — replace
everything in `<angle brackets>`:

```bash
DATABASE_URL=postgresql://soletronix:<DB-PASSWORD>@localhost:5432/soletronix

POSTGRES_USER=soletronix
POSTGRES_PASSWORD=<DB-PASSWORD>
POSTGRES_DB=soletronix

API_TOKEN=<EXACT token from the ESP32 firmware>

TZ=Asia/Manila
APP_TIMEZONE=Asia/Manila
NEXT_PUBLIC_APP_TIMEZONE=Asia/Manila

SYNC_TOKEN=<the 64-character token from 4.1 — NOT the same as API_TOKEN>
MAIN_SERVER_URL=https://seeme-db.com

LICENSE_PATH=/home/pi/ipond-local/license.json
```

- [ ] Save: `Ctrl+O`, `Enter`, `Ctrl+X`.

### 4.3 Check your work

```bash
cd $APP_DIR
grep -c "<" .env
```

> **You should see:** `0`
> Anything higher means you left a `<placeholder>` unfilled.

```bash
# The database password must match in both places — this prints nothing if OK
PW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2)
grep -q "soletronix:$PW@localhost" .env && echo "PASSWORD OK" || echo "MISMATCH — fix DATABASE_URL"

# The two tokens must differ
A=$(grep '^API_TOKEN=' .env | cut -d= -f2)
S=$(grep '^SYNC_TOKEN=' .env | cut -d= -f2)
[ "$A" = "$S" ] && echo "DANGER: tokens are identical — change SYNC_TOKEN" || echo "TOKENS OK"
```

> **You should see:** `PASSWORD OK` and `TOKENS OK`.

### 4.4 Lock the file down

```bash
chmod 600 .env
```

This stops other accounts on the Pi from reading your passwords.

---

## 5. Install the licence file

### 5.1 Get this Pi's serial number

```bash
cat /proc/cpuinfo | grep Serial
```

> **You should see:** something like `Serial : 100000001a2b3c4d`

- [ ] Copy the serial (the part after the colon).

### 5.2 Request the licence

- [ ] Reply to your email to **sales@soletronix.com** with:
  - The **serial number** from 5.1
  - The **client / site name**
  - The **licence duration** required

You will receive a `license.json` file. **Only Soletronix can create it** — it
is cryptographically signed, and the signing key never leaves them. You cannot
generate or edit it on the Pi; changing even one character invalidates it.

### 5.3 Install it

On **your laptop**, in the folder where you saved the file:

```bash
scp license.json pi@ipond.local:/home/pi/ipond-local/license.json
```

Back on the **Pi**, confirm it arrived and is readable only by you:

```bash
chmod 600 /home/pi/ipond-local/license.json
ls -l /home/pi/ipond-local/license.json
```

> **You should see:** one file, `-rw-------`, roughly 500–600 bytes.

⚠️ The path here must match `LICENSE_PATH` in your `.env` **exactly**. If they
disagree, the dashboard shows a full-screen *"No Licence Found"* page and
nothing else.

---

## 6. Start the database

### 6.1 Start the container

```bash
cd $APP_DIR
docker compose up -d
```

- [ ] The first run downloads about 400 MB. Allow **5–15 minutes**.

> **You should see:** `Container soletronix-timescaledb  Started`
>
> ⚠️ **If you see `no matching manifest for linux/arm64`**, this Pi's
> architecture has no prebuilt TimescaleDB image for the pinned version.
> Stop and contact Soletronix — do **not** switch to plain PostgreSQL, the app
> requires TimescaleDB's hypertable features. See
> [Troubleshooting](#12-troubleshooting).

### 6.2 Wait for it to be ready

```bash
docker exec soletronix-timescaledb pg_isready -U soletronix
```

Repeat until it responds. The first start also creates all the database tables,
which takes an extra 10–30 seconds after the container appears.

> **You should see:** `/var/run/postgresql:5432 - accepting connections`

### 6.3 Confirm the tables were created

```bash
docker exec soletronix-timescaledb \
  psql -U soletronix -d soletronix -c "\dt"
```

> **You should see:** a table listing including `sensor_readings`, `ponds`,
> `owners`, `sensor_alerts`, `maintenance_requests` — 10 tables in total.

### 6.4 Seed the ponds

The database now has the right *shape* but is **completely empty** — no ponds.
Until you do this step every ESP32 reading is rejected with `unknown_pond`.

```bash
cd $APP_DIR
docker exec -i soletronix-timescaledb \
  psql -U soletronix -d soletronix < db/seeds/002_local_appliance.sql
```

> **You should see:** `owners=1 ponds=10 thresholds=40`

⚠️ **Use `002_local_appliance.sql`, not `001_seed.sql`.** The older file belongs
to the multi-tenant cloud version; on a fresh database it fails with a foreign
key error and leaves you with **zero ponds**.

This creates ponds 1–10 (matching the `pnd` values the ESP32 firmware sends)
with sensible default optimal ranges. You can rename ponds later from the
dashboard — the **id numbers must not change**, because the firmware uses them.

---

## 7. Build the application

### 7.1 Check available memory

```bash
free -h
```

### 7.2 Add swap if you have under 4 GB of RAM

Skip this if the `total` column in step 7.1 shows 4 GB or more.

```bash
sudo dphys-swapfile swapoff
sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
free -h
```

> **You should see:** a `Swap:` row of about `2.0Gi`.
> Without this, the build on a small Pi is killed part-way with no clear error.

### 7.3 Build

```bash
cd $APP_DIR
npm run build
```

- [ ] This takes **5–25 minutes** on a Pi. It will look frozen at times — leave
      it alone.

> **You should see:** `✓ Compiled successfully` followed by a table of routes.

### 7.4 Copy the static files ⚠️ **do not skip**

```bash
cd $APP_DIR
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
```

This app builds in **standalone** mode, which does not include images,
stylesheets or fonts in the output. If you skip this the dashboard loads as
unstyled black-and-white text with no logo.

**You must repeat this after every single build.**

### 7.5 Test it once by hand

```bash
cd $APP_DIR/.next/standalone
LICENSE_PATH=/home/pi/ipond-local/license.json node server.js
```

> **You should see:** `▲ Next.js` … `✓ Ready in …`

Leave it running and open a **second** terminal (`ssh pi@ipond.local` again):

```bash
curl localhost:3000/api/health
curl localhost:3000/api/license
```

> **You should see:**
> `{"status":"ok","db":"connected",...}`
> `{"valid":true,"client":"<your site name>",...}`
>
> If licence says `"valid":false`, check the `reason` field:
> - `missing` — wrong `LICENSE_PATH`, or the file is not where you think
> - `serial_mismatch` — the licence was signed for a different Pi
> - `expired` — it has run out; contact sales
> - `bad_signature` — the file was edited or corrupted in transfer; re-copy it

- [ ] Go back to the first terminal and press `Ctrl+C` to stop it.

---

## 8. Run it as a service (systemd)

This makes the dashboard start automatically on power-up and restart if it
crashes.

### 8.1 Create the service file

```bash
sudo nano /etc/systemd/system/ipond.service
```

Paste this **exactly**:

```ini
[Unit]
Description=Soletronix iPond (local appliance)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/ipond-local/i-pond-frontend
EnvironmentFile=/home/pi/ipond-local/i-pond-frontend/.env
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node /home/pi/ipond-local/i-pond-frontend/.next/standalone/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] Save: `Ctrl+O`, `Enter`, `Ctrl+X`.

> **Why `EnvironmentFile` matters:** the build bakes a copy of `.env` into the
> standalone folder. Without this line, editing `.env` later would have **no
> effect** and you would be debugging a value the app is not actually using.

### 8.2 Start it

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ipond
sudo systemctl status ipond
```

> **You should see:** `Active: active (running)` in green.
> Press `q` to exit the status view.

### 8.3 Confirm it survives a reboot

```bash
sudo reboot
```

Wait two minutes, reconnect, then:

```bash
curl localhost:3000/api/health
```

> **You should see:** the `"db":"connected"` response again, with no manual
> steps. If not, run `sudo journalctl -u ipond -n 50` to see why.

---

## 9. Put it on port 80 (nginx)

So staff can visit `http://ipond.local` instead of `http://ipond.local:3000`.

```bash
sudo nano /etc/nginx/sites-available/ipond
```

Paste:

```nginx
server {
    listen 80;
    server_name _;
    client_max_body_size 2m;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

Then enable it and remove the default page:

```bash
sudo ln -sf /etc/nginx/sites-available/ipond /etc/nginx/sites-enabled/ipond
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

> **You should see:** `syntax is ok` and `test is successful`.

- [ ] On your laptop, visit **`http://ipond.local`**

> **You should see:** the See ME dashboard, in colour, with a sidebar listing
> Dashboard / Reports / Utilization / Thresholds / Notifications / Ingestion
> Logs.
>
> If the page is plain black text with no styling, you skipped **step 7.4**.

---

## 10. Schedule the background jobs (cron)

Two jobs run every five minutes: one raises sensor and connectivity alerts, the
other pushes readings to the Soletronix cloud.

```bash
mkdir -p /home/pi/logs
crontab -e
```

If it asks which editor, choose **`1` (nano)**.

Add these two lines at the bottom:

```cron
*/5 * * * * cd /home/pi/ipond-local/i-pond-frontend && /usr/bin/npm run alert-worker >> /home/pi/logs/alert-worker.log 2>&1
*/5 * * * * cd /home/pi/ipond-local/i-pond-frontend && /usr/bin/npm run sync-worker >> /home/pi/logs/sync-worker.log 2>&1
```

- [ ] Save: `Ctrl+O`, `Enter`, `Ctrl+X`.

### 10.1 Test the sync job immediately

```bash
cd $APP_DIR
npm run sync-worker
```

> **You should see one of:**
> - `sync: ok — synced N, 0 pending` — working
> - `sync: nothing_to_sync — ...` — working, no new readings yet
> - `sync: offline — ...` — the Pi has no internet **(this is not a failure;
>   readings are kept and sent when the connection returns)**
> - `sync: server_unreachable — ...` — internet is up but seeme-db.com is not
>   responding
> - `sync: not_configured — ...` — `SYNC_TOKEN` is missing from `.env`

- [ ] Confirm the log is being written:

```bash
tail -5 /home/pi/logs/sync-worker.log
```

---

## 11. Point the ESP32 at the Pi

Until now the sensors have been sending to the cloud. They must now send to the
Pi instead.

### 11.1 Find the Pi's address

```bash
hostname -I
```

> **You should see:** something like `192.168.1.50`

- [ ] Make sure this address is **reserved** on the router (step 0.2). If it
      changes later, the sensors silently stop reporting.

### 11.2 Update the firmware

In the Arduino IDE, open the gateway sketch
(`esp32_iotgateway_new_soletronix.ino`) and change line 13:

```cpp
// from:
const char *serverName = "https://seeme-db.com/api/send-sensor-data";
// to (use YOUR Pi's address):
const char *serverName = "http://192.168.1.50/api/send-sensor-data";
```

⚠️ Note `http`, not `https` — the Pi serves plain HTTP on the local network.

- [ ] Confirm the `API_TOKEN` in the firmware matches the one in `.env` exactly.
- [ ] Upload to each ESP32 gateway.

### 11.3 Verify a real reading arrives

Wait for one reporting interval (up to 15 minutes), then:

```bash
docker exec soletronix-timescaledb psql -U soletronix -d soletronix \
  -c "SELECT time, pond_id, temperature, ph FROM sensor_readings ORDER BY time DESC LIMIT 5;"
```

> **You should see:** rows with recent timestamps.

You can also watch every incoming request — including rejected ones — at
**`http://ipond.local/admin/logs`**.

### 11.4 Test without waiting (optional)

To confirm the endpoint works before the sensors report:

```bash
cd $APP_DIR
TOKEN=$(grep '^API_TOKEN=' .env | cut -d= -f2)
curl -s -X POST http://localhost:3000/api/send-sensor-data \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data":{"pnd":1,"rtd":28.5,"ph":7.2,"sal":15.0,"dox":6.8}}'
```

> **You should see:** `{"ok":true}`
> - `{"error":"unauthorized"}` → the token does not match
> - `{"error":"unknown_pond"}` → you skipped step 6.4

---

## 12. Final acceptance test

Tick every box. If any fails, do not hand the system over.

- [ ] **Dashboard loads, styled** — `http://ipond.local` shows the sidebar and
      pond cards in colour
- [ ] **Ponds are listed** — the dashboard shows your ponds, not "No ponds"
- [ ] **Live data** — at least one pond shows a recent reading
- [ ] **Charts draw** — click a pond, then a sensor; a line chart appears
- [ ] **Licence valid** — `curl localhost:3000/api/license` → `"valid":true`
- [ ] **Sync status visible** — bottom-left of the sidebar shows
      *"Last synced …"* or *"Not synced — no internet"*
- [ ] **Manual sync works** — click **Sync to Cloud**; it reports a result
- [ ] **Survives reboot** — `sudo reboot`, wait 2 min, dashboard loads with no
      intervention
- [ ] **Cron is scheduled** — `crontab -l` shows both lines
- [ ] **Logs are filling** — `ls -l /home/pi/logs/` shows both files growing
- [ ] **Database port is closed to the outside** —
      `sudo ss -tlnp | grep 5432` shows it bound only to `127.0.0.1` or the
      docker bridge, never `0.0.0.0`

### Hand-over notes for the site

- Dashboard: **`http://ipond.local`** (or the IP from 11.1)
- There is **no login** — anyone on the site network can view it. This is
  intentional for a single-operator appliance. Keep the Pi on a trusted network.
- Data is stored on the Pi and pushed to the cloud automatically when internet
  is available. **Losing internet does not lose data.**
- Support: **sales@soletronix.com**

---

## Routine maintenance

### Updating to a new version

```bash
cd /home/pi/ipond-local
git pull
cd $APP_DIR
npm install
npm run build
cp -r public .next/standalone/            # ⚠️ do not skip
cp -r .next/static .next/standalone/.next/ # ⚠️ do not skip
sudo systemctl restart ipond
```

If the update notes mention a new database migration:

```bash
cd $APP_DIR
docker exec -i soletronix-timescaledb \
  psql -U soletronix -d soletronix < db/migrations/0XX_name.sql
```

Apply migrations **before** restarting the service.

### Backing up the database

```bash
mkdir -p /home/pi/backups
docker exec soletronix-timescaledb \
  pg_dump -U soletronix -d soletronix | gzip > /home/pi/backups/ipond-$(date +%F).sql.gz
```

- [ ] Copy backups off the Pi periodically. An SD card is not a safe archive.

### Useful commands

| Task | Command |
|---|---|
| Is the app running? | `sudo systemctl status ipond` |
| App logs, live | `sudo journalctl -u ipond -f` |
| Restart the app | `sudo systemctl restart ipond` |
| Is the database up? | `docker ps` |
| Database logs | `docker logs soletronix-timescaledb --tail 50` |
| Sync log | `tail -20 /home/pi/logs/sync-worker.log` |
| Alert log | `tail -20 /home/pi/logs/alert-worker.log` |
| How many readings? | `curl -s localhost:3000/api/health` |
| How many awaiting sync? | `curl -s localhost:3000/api/sync/status` |
| Free disk space | `df -h` |

---

## 12. Troubleshooting

### Dashboard shows "No Licence Found" / "Licence Expired"

```bash
curl -s localhost:3000/api/license
```

Read the `reason` field:

| reason | Meaning | Fix |
|---|---|---|
| `missing` | No file at the path | Check `LICENSE_PATH` in `.env` matches the real file location; confirm with `ls -l` |
| `bad_signature` | File was edited or corrupted | Re-copy the original from Soletronix. Never open and re-save it |
| `serial_mismatch` | Signed for a different Pi | Compare `cat /proc/cpuinfo \| grep Serial` with what you sent. A replaced Pi needs a new licence |
| `expired` | Licence period ended | Contact sales@soletronix.com |
| `malformed` | File is not valid JSON | The transfer truncated it; re-copy |

### Page loads but has no styling / no images

You skipped **step 7.4**. Run the two `cp -r` commands and
`sudo systemctl restart ipond`.

### `no matching manifest for linux/arm64`

The pinned TimescaleDB image has no build for this Pi's architecture. Confirm
you are on 64-bit (`uname -m` → `aarch64`). If you are, contact Soletronix
before changing anything — the app needs TimescaleDB specifically and swapping
in plain PostgreSQL will break the charts and utilization pages.

### Dashboard says "No ponds" / ESP32 gets `unknown_pond`

The seed did not run. Redo **step 6.4**, and check you used
`002_local_appliance.sql`.

```bash
docker exec soletronix-timescaledb psql -U soletronix -d soletronix \
  -c "SELECT id, pond_code, name FROM ponds ORDER BY id;"
```

### `db":"disconnected"` in the health check

```bash
docker ps                                    # is the container listed?
docker compose up -d                         # start it if not
docker logs soletronix-timescaledb --tail 30 # why did it stop?
```

Most common cause: `POSTGRES_PASSWORD` and the password inside `DATABASE_URL`
do not match. Re-run the check in **step 4.3**.

⚠️ If you change `POSTGRES_PASSWORD` **after** the first start, the database
keeps the *old* password — it is only read when the data volume is first
created. Either set the old password back, or destroy and recreate the database
(**this deletes all readings**):

```bash
cd $APP_DIR && docker compose down -v && docker compose up -d
# then redo step 6.4
```

### Build is killed / "out of memory"

Add swap — **step 7.2** — then build again.

### Service will not start

```bash
sudo journalctl -u ipond -n 50 --no-pager
```

- `status=203/EXEC` → the path in `ExecStart` is wrong, or you never built
- `Cannot find module` → run `npm install` then `npm run build` again
- Exits immediately → run it by hand (**step 7.5**) to see the real error

### Sync always says `offline`

The Pi has no working internet connection (it can still serve the dashboard on
the LAN perfectly well). Test:

```bash
ping -c 3 1.1.1.1
curl -sI https://seeme-db.com/api/health | head -1
```

Readings accumulate safely and upload when the connection returns — check the
backlog with `curl -s localhost:3000/api/sync/status`.

### Cannot reach `ipond.local` from a laptop

Use the IP address instead (`hostname -I` on the Pi). Some networks and Windows
setups do not resolve `.local` names.

---

## Appendix: what is installed where

| Thing | Location |
|---|---|
| Repository root | `/home/pi/ipond-local` |
| Application | `/home/pi/ipond-local/i-pond-frontend` |
| Settings | `/home/pi/ipond-local/i-pond-frontend/.env` |
| Licence | `/home/pi/ipond-local/license.json` |
| Server that actually runs | `…/i-pond-frontend/.next/standalone/server.js` |
| Database files | Docker volume `i-pond-frontend_timescaledb_data` |
| Job logs | `/home/pi/logs/` |
| Service definition | `/etc/systemd/system/ipond.service` |
| Web server config | `/etc/nginx/sites-available/ipond` |

### Ports

| Port | Purpose | Exposed to |
|---|---|---|
| 80 | Dashboard (nginx) | Site network |
| 3000 | The app itself | Pi only |
| 5432 | Database | Pi only — **never open this to the internet** |

---

*Soletronix iPond — local appliance. Support: sales@soletronix.com*
