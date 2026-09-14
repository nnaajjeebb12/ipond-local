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
| [11. Connect the gateway](#11-connect-the-esp32-gateway-usb) | USB serial listener | 20 min |
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
- [ ] The ESP32 gateway, plus a **USB data cable** long enough to reach the Pi
- [ ] **Strongly recommended:** an external SSD or USB drive for the database.
      SD cards wear out under constant database writes.

### 0.2 Information to collect

Write these down now. You cannot finish without them.

- [ ] **`API_TOKEN`** — any long random token. It guards the ingest endpoint
      on the Pi's own network; the gateway no longer needs to know it (the
      serial listener on the Pi supplies it).
- [ ] **`SYNC_TOKEN`** — a **new, different** token for cloud sync. Ask
      Soletronix for it, or generate one in step 4 and send it to them.
      ⚠️ **It must not be the same as `API_TOKEN`.** They are deliberately
      separate so a compromised pond sensor cannot rewrite historical data, and
      a leaked sync token cannot impersonate a sensor.
- [ ] **Client / site name** — as it should appear on the licence.
- [ ] **`SYNC_OWNER_ID`** — this site's owner UUID on seeme-db.com. Ask
      Soletronix. Without it the Pi can store readings but cannot sync them.
- [ ] **Number of ponds** at this site (1–10).
- [ ] **Repository URL** for this project.
- [ ] A **fixed IP address** for the Pi, or a DHCP reservation on the router
      *(recommended, so staff can bookmark the dashboard — the gateway itself
      does not need it, it is wired by USB)*.

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
openssl rand -hex 32   # use this for API_TOKEN
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
DATABASE_URL=postgresql://soletronix:<DB-PASSWORD>@localhost:5432/ipond

POSTGRES_USER=soletronix
POSTGRES_PASSWORD=<DB-PASSWORD>
POSTGRES_DB=ipond
DB_DATA_PATH=/mnt/ipond-data/timescaledb

API_TOKEN=<any long random token — see 4.1>
SERIAL_PORT=/dev/ttyUSB0            # you will replace this in step 11.2

TZ=Asia/Manila
APP_TIMEZONE=Asia/Manila
NEXT_PUBLIC_APP_TIMEZONE=Asia/Manila

SYNC_TOKEN=<the 64-character token from 4.1 — NOT the same as API_TOKEN>
MAIN_SERVER_URL=https://seeme-db.com
SYNC_OWNER_ID=<owner UUID from Soletronix>

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

### 6.0 Prepare the data drive

The database writes constantly, and SD cards die under that load. Put the data
on an external SSD/USB drive if you have one; if not, the Pi's card will do for
a small site but expect to replace it.

**With an external drive** (mounted at `/mnt/ipond-data`; ask Soletronix for a
mounting guide if unsure):

```bash
sudo mkdir -p /mnt/ipond-data/timescaledb
sudo chown -R 1000:1000 /mnt/ipond-data
```

**Without one** — edit `.env` and change `DB_DATA_PATH` to:

```bash
DB_DATA_PATH=/home/pi/ipond-data/timescaledb
```

then:

```bash
mkdir -p /home/pi/ipond-data/timescaledb
```

### 6.1 Start the container

```bash
cd $APP_DIR
docker compose up -d
```

- [ ] The first run downloads about 400 MB. Allow **5–15 minutes**.

> **You should see:** `Container ipond-timescaledb  Started`
>
> ⚠️ **If you see `no matching manifest for linux/arm64`**, this Pi's
> architecture has no prebuilt TimescaleDB image for the pinned version.
> Stop and contact Soletronix — do **not** switch to plain PostgreSQL, the app
> requires TimescaleDB's hypertable features. See
> [Troubleshooting](#12-troubleshooting).

### 6.2 Wait for it to be ready

```bash
docker exec ipond-timescaledb pg_isready -U soletronix
```

Repeat until it responds. The first start also creates all the database tables,
which takes an extra 10–30 seconds after the container appears.

> **You should see:** `/var/run/postgresql:5432 - accepting connections`

### 6.3 Confirm the tables were created

```bash
docker exec ipond-timescaledb \
  psql -U soletronix -d ipond -c "\dt"
```

> **You should see:** a table listing including `sensor_readings`, `ponds`,
> `owners`, `sensor_alerts`, `maintenance_requests` — 10 tables in total.

### 6.4 Seed the ponds

The database now has the right *shape* but is **completely empty** — no ponds.
Until you do this step every ESP32 reading is rejected with `unknown_pond`.

```bash
cd $APP_DIR
docker exec -i ipond-timescaledb \
  psql -U soletronix -d ipond < db/seeds/002_local_appliance.sql
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

**You must repeat this after every single build.** From now on you can let
`./scripts/deploy.sh` do 7.3 and 7.4 together (it also restarts the app once
the service in section 8 exists).

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

## 11. Connect the ESP32 gateway (USB)

The gateway has **no Wi-Fi**. It sends readings to the Pi down a USB cable, and
a small program on the Pi — the *serial listener* — forwards each reading into
the app. Nothing needs the Pi's IP address any more.

### 11.1 Plug it in and find it

- [ ] Connect the ESP32 gateway to any USB port on the Pi with a **data** cable
      (some cheap cables are charge-only and will not work).

```bash
ls -l /dev/serial/by-id/
```

> **You should see:** one entry, something like
> `usb-Silicon_Labs_CP2102_USB_to_UART_Bridge_Controller_0001-if00-port0 -> ../../ttyUSB0`
>
> If the folder is empty or missing: unplug, wait 5 seconds, plug back in, run
> again. Still nothing → try a different cable.

- [ ] Copy the **full `by-id` name** — the long `usb-…` part. You will use it
      in the next step.

⚠️ **Do not use `/dev/ttyUSB0` directly.** That number can change when other
USB devices are plugged in or after a reboot. The `by-id` name is tied to the
specific gateway and never changes.

### 11.2 Tell the app which port to use

```bash
cd $APP_DIR
nano .env
```

Find the `SERIAL_PORT=` line and set it to the by-id path:

```bash
SERIAL_PORT=/dev/serial/by-id/usb-Silicon_Labs_CP2102_USB_to_UART_Bridge_Controller_0001-if00-port0
```

- [ ] Save: `Ctrl+O`, `Enter`, `Ctrl+X`.

### 11.3 Let the `pi` user talk to serial devices

```bash
sudo usermod -aG dialout pi
```

- [ ] **Log out and back in** (`exit`, then `ssh pi@ipond.local`) — the change
      does not apply to the current session.

```bash
groups | grep -c dialout
```

> **You should see:** `1`. If `0`, you did not log out and back in.

### 11.4 Test the listener by hand

```bash
cd $APP_DIR
npm run serial-listener
```

> **You should see:** `listening on /dev/serial/by-id/... @ 9600 baud`
>
> Then, within one reporting interval (up to 15 minutes), a line per reading:
> `pond 3 -> 201 (1 total)`

Leave it running until you see at least one `-> 201`, then press `Ctrl+C`.

If you see `cannot open ...: Permission denied` → step 11.3.
If you see `cannot open ...: No such file` → the by-id path in `.env` is wrong;
re-check step 11.1.
If it says `listening` but nothing ever arrives → the gateway is not sending.
Its LCD should show *"Sent to Pi (USB)"* after each reading; if it shows
*"Json String Fail"* the sensor board is the problem, not the Pi.

### 11.5 Run the listener as a service

```bash
sudo nano /etc/systemd/system/ipond-serial.service
```

Paste **exactly**:

```ini
[Unit]
Description=Soletronix iPond USB serial listener
After=ipond.service
Requires=ipond.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/ipond-local/i-pond-frontend
EnvironmentFile=/home/pi/ipond-local/i-pond-frontend/.env
ExecStart=/usr/bin/node /home/pi/ipond-local/i-pond-frontend/scripts/serial-listener.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

- [ ] Save: `Ctrl+O`, `Enter`, `Ctrl+X`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ipond-serial
sudo systemctl status ipond-serial
```

> **You should see:** `Active: active (running)`. Press `q` to exit.

> **Why `Restart=always` matters here:** if the USB cable is knocked out or the
> gateway resets, the listener deliberately **exits**. systemd then restarts it
> every 3 seconds until the port is back. Plug the cable back in and it recovers
> on its own — no one has to touch the Pi.

### 11.6 Verify readings are landing

```bash
sudo journalctl -u ipond-serial -f
```

Wait for a `-> 201` line, then `Ctrl+C`. Then confirm in the database:

```bash
docker exec ipond-timescaledb psql -U soletronix -d ipond \
  -c "SELECT time, pond_id, temperature, ph FROM sensor_readings ORDER BY time DESC LIMIT 5;"
```

> **You should see:** rows with recent timestamps.

Every forwarded reading — including rejected ones — is also visible at
**`http://ipond.local/admin/logs`**.

### 11.7 Test without the gateway (optional)

The listener can read from the keyboard instead of the USB port, which lets you
prove the whole pipeline before the gateway is even wired up:

```bash
cd $APP_DIR
echo '{"data":{"pnd":1,"rtd":28.5,"ph":7.2,"sal":15.0,"dox":6.8}}' \
  | SERIAL_PORT=- npm run serial-listener
```

> **You should see:** `pond 1 -> 201 (1 total)`
> - `-> 401 {"error":"unauthorized"}` → `API_TOKEN` in `.env` is missing or malformed
> - `-> 404 {"error":"unknown_pond"}` → you skipped step 6.4
> - `POST failed (is the app running?)` → `sudo systemctl status ipond`

---

## 12. Final acceptance test

Tick every box. If any fails, do not hand the system over.

- [ ] **Dashboard loads, styled** — `http://ipond.local` shows the sidebar and
      pond cards in colour
- [ ] **Ponds are listed** — the dashboard shows your ponds, not "No ponds"
- [ ] **Serial listener running** — `sudo systemctl status ipond-serial` is
      `active (running)`
- [ ] **Live data** — at least one pond shows a recent reading
- [ ] **Charts draw** — click a pond, then a sensor; a line chart appears
- [ ] **Licence valid** — `curl localhost:3000/api/license` → `"valid":true`
- [ ] **Sync status visible** — bottom-left of the sidebar shows
      *"Last synced …"* or *"Not synced — no internet"*
- [ ] **Manual sync works** — click **Sync to Cloud**; it reports a result
- [ ] **Survives reboot** — `sudo reboot`, wait 2 min, dashboard loads with no
      intervention
- [ ] **Unplug test** — pull the gateway's USB cable, wait 10 s, plug it back
      in; `sudo systemctl status ipond-serial` returns to `active (running)`
      by itself
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

### If this Pi was set up before September 14, 2026

The database compose file moved from the repository root into
`i-pond-frontend/`. Docker names its project after the directory, so the old
container must be released once. **Your data is safe** — it lives in
`/mnt/ipond-data`, not inside the container.

```bash
cd /home/pi/ipond-local
docker compose -p ipond-local down
cd i-pond-frontend
grep POSTGRES_PASSWORD .env      # must be the password the DB was created with
docker compose up -d
```

Do this once, then use the normal update steps below.

### Updating to a new version

```bash
cd $APP_DIR
git pull
./db/run_remaining.sh 017      # apply new migrations FIRST (safe to re-run)
docker compose up -d                       # only needed if docker-compose.yml changed
./scripts/deploy.sh                        # build, copy static files, restart
```

`deploy.sh` does the build, the two copy steps from 7.4, and the restart. It
prints the newest migration number at the end — if you have not applied that
one, run `run_remaining.sh` with that number and deploy again.

Apply migrations **before** deploying: the app expects the tables and views
they create.

### If this Pi was set up before September 14, 2026 — performance update

The dashboard was slow because every chart re-read every raw sensor reading on
every refresh. This update adds a pre-computed 15-minute summary table, turns
on compression for old data, and tunes the database for the Pi. Three one-time
steps, in this order:

```bash
cd $APP_DIR
git pull
docker compose up -d                  # recreates the database container with the tuned settings
./db/run_remaining.sh 017  # builds the summary table — allow a few minutes on a big DB
./scripts/deploy.sh                   # rebuild and restart the app
```

> **You should see** after the migration: `ALL MIGRATIONS COMPLETE`, and
> `docker exec ipond-timescaledb psql -U soletronix -d ipond -c "SELECT count(*) FROM sensor_readings_15m"`
> returns a number greater than zero.

### Adding a pond later

1. Dashboard → **+ Add Pond** (next to "Pond Network"). Give it a name; the
   code is assigned automatically (`PND-011`, `PND-012`, …).
2. Set the sensor board / gateway for that pond to post the matching number
   (`PND-011` → `pnd: 11`).
3. Ask Soletronix to create the same pond code under this site's account on
   the main server. Until that is done the sidebar shows "pond not found under
   this owner" and the pond's readings wait on the Pi — nothing is lost.

### Checking the license and the cloud owner

Sidebar → **Appliance**. The license card shows who it is licensed to, the
days remaining and the expiry date — always, not only near expiry. The cloud
owner card shows which main-server account this Pi's data goes to.

To set the owner's name, or change the owner (rare — only when Soletronix
tells you to):

- [ ] Click **Admin login** — username `soletronix`, password
      `Soletronix@pi2026`.
- [ ] Type the owner name and paste the owner ID **exactly** as Soletronix
      gave them, then click **Save owner**. The ID is not checked online — if
      it is wrong, the sidebar will say "pond not found under this owner" on
      the next sync; correct it here and sync resumes. Nothing is lost.

### Backing up the database

```bash
mkdir -p /home/pi/backups
docker exec ipond-timescaledb \
  pg_dump -U soletronix -d ipond | gzip > /home/pi/backups/ipond-$(date +%F).sql.gz
```

- [ ] Copy backups off the Pi periodically. An SD card is not a safe archive.

### Useful commands

| Task | Command |
|---|---|
| Is the app running? | `sudo systemctl status ipond` |
| App logs, live | `sudo journalctl -u ipond -f` |
| Restart the app | `sudo systemctl restart ipond` |
| Is the gateway being heard? | `sudo journalctl -u ipond-serial -n 20` |
| Restart the listener | `sudo systemctl restart ipond-serial` |
| Is the database up? | `docker ps` |
| Database logs | `docker logs ipond-timescaledb --tail 50` |
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

### No readings arriving

```bash
sudo systemctl status ipond-serial
sudo journalctl -u ipond-serial -n 30 --no-pager
```

| Log says | Meaning | Fix |
|---|---|---|
| `cannot open ...: No such file` | Wrong `SERIAL_PORT` | Step 11.1 – 11.2 |
| `cannot open ...: Permission denied` | `pi` not in `dialout` | Step 11.3, then log out/in |
| `listening on ...` but nothing else | Gateway not sending | Check its LCD; check the cable is a data cable |
| `not JSON, skipped` repeatedly | Baud mismatch | Firmware uses 9600 — do not change `SERIAL_BAUD` |
| `-> 404 unknown_pond` | Ponds not seeded | Step 6.4 |
| `POST failed (is the app running?)` | App down | `sudo systemctl status ipond` |

### Sync says `pond_mismatch`

The main server does not recognise this site's ponds. Nothing has been lost —
the readings stay pending on the Pi. Either `SYNC_OWNER_ID` in `.env` is wrong,
or Soletronix has not yet created ponds `PND-001`… under that owner on
seeme-db.com. Contact them with the value in your `.env`.

### Dashboard says "No ponds" / listener gets `unknown_pond`

The seed did not run. Redo **step 6.4**, and check you used
`002_local_appliance.sql`.

```bash
docker exec ipond-timescaledb psql -U soletronix -d ipond \
  -c "SELECT id, pond_code, name FROM ponds ORDER BY id;"
```

### `db":"disconnected"` in the health check

```bash
docker ps                                    # is the container listed?
docker compose up -d                         # start it if not
docker logs ipond-timescaledb --tail 30 # why did it stop?
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
| Database files | `DB_DATA_PATH` from `.env` (default `/mnt/ipond-data/timescaledb`) |
| Serial listener service | `/etc/systemd/system/ipond-serial.service` |
| Job logs | `/home/pi/logs/` |
| Service definition | `/etc/systemd/system/ipond.service` |
| Web server config | `/etc/nginx/sites-available/ipond` |

### Ports

| Port | Purpose | Exposed to |
|---|---|---|
| 80 | Dashboard (nginx) | Site network |
| 3000 | The app itself | Pi only |
| 5432 | Database | Bound to `127.0.0.1` only — **never open this to the internet** |
| USB | ESP32 gateway → serial listener | Physical cable only |

---

*Soletronix iPond — local appliance. Support: sales@soletronix.com*
