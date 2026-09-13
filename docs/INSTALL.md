# Installing on the workshop PC

From a bare machine to a working installation, in about an hour. Every command
below was run end to end on 8 September 2026 and the output quoted is real; the
one exception is marked.

The result is **one process on one port**. The server serves the API and the app
itself, so there is nothing else to run and nothing to keep in sync.

---

## 1. What the machine needs

- **Node 22 or later, and nothing else.** The server runs TypeScript directly
  with `--experimental-strip-types`, and older releases reject the flag with
  `node: bad option`. An older Node earlier on the PATH gives a stranger error
  still — `ERR_UNKNOWN_BUILTIN_MODULE` from `node:sqlite` — so check the
  version rather than assuming.
- **A PC that stays on.** This is the system of record for wagon releases; it
  should not be somebody's laptop that goes home.

```
node -v          # must be v22 or later
```

> **Windows.** Everything below works on Windows, Linux and macOS. The backup
> is a Node script needing no `sqlite3` or `openssl` binary. There are older
> shell versions of the backup scripts in `server/scripts/*.sh` — they do the
> same job and are kept for Linux hosts that prefer them, but on Windows use
> the `.mjs` one. Both write the same file format, so a backup taken by either
> can be restored by either, or by plain `openssl` on any machine.

**WRS Raipur runs Windows**, so the commands below give the Windows form
first.

## 2. Install and configure

```bash
npm ci
npm ci --prefix server
npm ci --prefix client
```

Create `.env` in the repository root. **Generate the secret — do not copy one
from anywhere, including this file:**

```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('base64'))" >> .env
```

Then add the rest:

```
NODE_ENV=production
PORT=3000
CORS_ORIGIN=http://<the address the tablets use>:3000
# Where backups go. MUST be a different disk from the database — a second
# drive, a USB disk kept in another room, or a network share. The dashboard
# looks here, and flags the default (beside the database) as not protection.
WRS_BACKUP_DIR=D:\wrs-backups
OTP_DELIVERY=INLINE

# Optional. Everything works without it — Ask the Manual stays keyword search
# and voice entry uses the built-in parser.
ZAPHEIT_API_KEY=
ZAPHEIT_BASE_URL=https://api.zapheit.com/v1
ZAPHEIT_MODEL=gpt-4o-mini
```

**Keep a copy of `JWT_SECRET` somewhere other than this machine.** It also signs
release certificates: change it and every certificate already issued stops
verifying.

## 3. Build the app

```bash
npm run build
```

### The camera's weights must be inside the build

The camera does not download anything at the moment it is used. Two model
files are served by this application itself, from `client/public/models/`:

| Folder | Size | What it does |
|---|---|---|
| `coco-ssd/` | 18 MB | Finds the people and clutter in a frame so they can be cut away |
| `mobilenet/` | 13 MB | Turns the remaining crop into the 1280 numbers the camera compares |

Both are committed to the repository, so a normal checkout already has them
and **nothing further is needed**. Confirm before you leave the office:

```bash
ls client/public/models/mobilenet/     # model.json + 4 shards
ls client/public/models/coco-ssd/      # model.json + 5 shards
```

If either folder is empty — a shallow clone, or a copy made by hand that
skipped large files — fetch them **on a machine that has internet**, before
going to the shop:

```bash
node scripts/vendor-vision-models.mjs
```

A shop LAN commonly has no route to the internet, and the one moment the
camera is needed is the moment somebody is standing at a bogie holding a
part. A model that is fetched on first use is a model that does not exist in
the shed.

## 4. First start, and the first administrator

A production start creates **no accounts at all**. The demonstration logins are
deliberately not seeded, so there is nobody to sign in as until you make
somebody. That is what the bootstrap variables are for — a way in, not a
standing account:

```bash
BOOTSTRAP_ADMIN_USERNAME=wrsadmin \
BOOTSTRAP_ADMIN_PASSWORD='<at least 12 characters>' \
BOOTSTRAP_ADMIN_NAME='WRS Raipur Administrator' \
npm start
```

The log says what happened:

```
[seed] Production start with no accounts. The demo logins are deliberately not
       created here. Create the first administrator with BOOTSTRAP_ADMIN_USERNAME
       and BOOTSTRAP_ADMIN_PASSWORD, then add the roster from the User Accounts screen.
[seed] Created the first administrator "wrsadmin". Change this password after signing in.
```

Open `http://localhost:3000` and sign in. A password shorter than 12 characters
is refused outright rather than weakened.

**Then, in this order:**

1. Change that password (key icon in the header).
2. Create the real roster under **User Accounts** — inspectors, supervisors, the
   DRM. Each gets a generated password shown once, to hand over directly.
3. Remove the bootstrap variables from however you start the server. They do
   nothing once a real account exists, and leaving them in a startup script
   leaves a password in a file.

## 5. Index the manual

Two documents. The first is the one everything cites; the second ships with the
repository:

```bash
npm run index-manual -- "/path/to/Vol-I (System Documentation).pdf"
npm run index-manual -- "docs/Quality_Audit_check-sheet_for_Wagon_Depot.pdf" ROH_AUDIT
```

Needs `pdftotext` (poppler). If it is not installed, extract the text yourself
and pass the `.txt` — the indexer only ever needs text.

## 6. The gauges

Under **User Accounts → Gauge Register**, enter the instruments actually on the
bench. There is no national list to copy from: WMM p.191 records that only local
colour coding is in practice across zonal railways, so these codes belong to this
workshop. Outer, inner and snubber are different strips and each needs its own
entry, with its calibration date.

## 7. Backups

Create a key **once**, and keep it off the backup volume — a key stored beside
the thing it encrypts protects against nothing.

**Windows** (PowerShell, as Administrator):

```powershell
New-Item -ItemType Directory -Force C:\wrs | Out-Null
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[System.IO.File]::WriteAllText('C:\wrs\backup.key', (($bytes | ForEach-Object { $_.ToString('x2') }) -join ''))
icacls C:\wrs\backup.key /inheritance:r /grant:r "SYSTEM:R" "Administrators:R"
```

Keep a copy of `C:\wrs\backup.key` somewhere that is not this PC — a
password manager, or a sealed envelope in the office. **A backup whose key was
only ever on the formatted machine cannot be opened.**

**Linux/macOS:**

```bash
umask 077
openssl rand -hex 32 > /etc/wrs/backup.key
chmod 400 /etc/wrs/backup.key
```

Prove the whole round trip before trusting it. This works in a temporary
directory with a throwaway key and never touches the real database:

```
bash scripts/backup-drill.sh
```

That drill needs bash, so run it on any machine — it proves the code, not the
host. It exercises both the Node and shell implementations, and checks that a
backup written by one opens with the other and with plain `openssl`.

It should end `All checks passed. A backup taken now would come back.`

Then schedule it.

**Windows** — Task Scheduler, weekly, running whether or not anybody is logged
in. Three things in this command are there because leaving them out produces a
task that reports success and backs up nothing:

- The key path is passed **inline**. The task runs as SYSTEM, and SYSTEM never
  sees a variable you set with `setx` in your own session — so without this
  the script exits at 2 am with "WRS_BACKUP_KEY_FILE is not set" and nobody is
  there to read it.
- `node.exe` is given by **full path**, because SYSTEM's PATH may not include
  it.
- The destination is a **different drive**, and it is the same `WRS_BACKUP_DIR`
  you put in `.env` — that is where the dashboard looks, and the two must
  agree. The application refuses to call a same-disk copy a backup: format the
  PC and the records and every copy of them go together. `D:` here is a second
  internal drive, a USB disk kept in another room, or a mapped network share —
  anything that is not `C:`.

```
schtasks /Create /TN "WRS backup" /SC WEEKLY /D SUN /ST 02:00 /RU SYSTEM ^
  /TR "cmd /c set WRS_BACKUP_KEY_FILE=C:\wrs\backup.key && set WRS_BACKUP_DIR=D:\wrs-backups && ^
       \"C:\Program Files\nodejs\node.exe\" C:\wrs-raipur\server\scripts\backup-db.mjs"
```

Then **run it once by hand and look**, rather than trusting the schedule:

```
schtasks /Run /TN "WRS backup"
dir D:\wrs-backups
```

A file named `wrs_inspections_<timestamp>.db.enc` should be there. If it is not,
open Task Scheduler, find "WRS backup", and read the **Last Run Result** —
`0x0` is success; anything else is the exit code of the script, and the reason
is in the History tab. Once it has run by hand, the admin dashboard's readiness
panel should show the backup row green with "on a different disk".

**Linux** — `crontab -e`:

```
0 2 * * 0 WRS_BACKUP_KEY_FILE=/etc/wrs/backup.key node /path/to/server/scripts/backup-db.mjs >> /var/log/wrs-backup.log 2>&1
```

On macOS use `launchd` rather than `cron`.

**To restore**, on any platform:

```
node server/scripts/backup-db.mjs --restore <file.db.enc> [target_db]
```

## 8. Check your work

Sign in as an administrator, open the dashboard, and press **Check now** on
"Ready to be used". Every item is measured on this machine when you press it —
the Zapheit row is a live call, the audit row recomputes every hash, the password
row hashes real passwords. Nothing is read back from a setting.

A fresh installation that has done steps 1–4 and nothing else reports:

```
5 passed, 3 warned, 1 failed
  FAIL  A recent encrypted backup exists      → step 7
  WARN  A calibrated gauge for every position → step 6
  WARN  The manual is indexed and searchable  → step 5
  WARN  Zapheit answers from this machine     → optional; see below
```

Work down that list until it is green. A Zapheit warning can also be a passing
network blip — press **Check now** again before investigating.

## 9. Keeping it running

The server must come back after a power cut without anybody logging in.

**Windows** — run it as a service. Task Scheduler with "At startup", running as
SYSTEM, restarting on failure, is enough:

```
schtasks /Create /TN "WRS Raipur" /SC ONSTART /RU SYSTEM /TR "npm start" /RL HIGHEST
```

**Linux** — `systemd` with `Restart=always`. **macOS** — `launchd`.

> This is the one section not exercised end to end here, because it depends on
> the machine you install on. Verify it the only way that means anything: pull
> the power, and check the app is answering when the PC comes back.

A minimal systemd unit:

```ini
[Unit]
Description=WRS Raipur wagon QC
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/wrs-raipur
EnvironmentFile=/opt/wrs-raipur/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=wrs

[Install]
WantedBy=multi-user.target
```

## 10. Updating

```bash
git pull
npm ci && npm ci --prefix server && npm ci --prefix client
npm run build
# restart the service
```

Migrations run automatically at startup and are additive. Take a backup first
anyway — the point of having one is not needing to decide whether this is the
time you need it.

## If something is wrong

- **Server will not start, no message about why** — check Node is 22+.
- **"Refusing to start with the default development secret"** — `JWT_SECRET`
  is missing from `.env`.
- **Nobody can sign in and there are no accounts** — step 4. Production seeds
  none on purpose.
- **An inspector's password is refused with a message about a demonstration
  password** — that account still holds `password123`, which production logins
  refuse. Set a real one from User Accounts.
- **Certificates stop verifying after a change** — `JWT_SECRET` changed. Restore
  the previous one.
