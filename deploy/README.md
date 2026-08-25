# Deployment Guide — WRS Raipur QC Platform

## Where to host: recommendation

You said cloud makes sense, but that the data should stay under your control and in-region — that's exactly right for a government railway system, and both are achievable together. In order of preference:

1. **NIC MeghRaj (GI Cloud)** — the Government of India's own empanelled cloud (run by NIC, under MeitY). If Indian Railways / your zone already has empanelment or an existing MeghRaj account, this is the institutionally correct choice: government-owned infrastructure, physically in India, under government control end to end, and likely the path of least resistance for internal approval. Worth checking with your IT/Railway Board contacts before anything else — this may already be available to you.
2. **A commercial cloud's India region** (AWS `ap-south-1` Mumbai, Azure "Central India", GCP `asia-south1` Mumbai, or an Indian provider) if MeghRaj isn't accessible or is too slow to provision this week. Data physically stays in India; you still own the account, the VM, and all access credentials — "cloud" here just means someone else runs the data center, not that they have access to your data.
3. **The workshop's own on-prem server**, if neither of the above works out — fully under your control by definition, no ongoing hosting cost, but someone locally needs to keep it powered, networked, and maintained (and you'd still need a domain + TLS cert for camera access to work, or accept a more constrained network setup).

Whichever you pick, the deployment artifacts below (Docker image + nginx config) work identically — nothing in the app is tied to a specific provider.

## Backup and restore drill

Last drilled: **25 August 2026** — backup taken from a live WAL database with
the server running, database then deleted, restored from the backup, and the
server brought back up.

Result: all recorded inspections survived, the server returned healthy in WAL
mode, and — the part that matters — `GET /api/audit/verify` reported the hash
chain **unbroken across the restore**. A restored database is not merely
readable; it is still able to prove it has not been altered.

```bash
# take a backup (safe against a live server — uses SQLite .backup, not cp)
server/scripts/backup-db.sh /path/to/wrs_inspections.db /path/to/backups

# restore
cp /path/to/backups/wrs_inspections_YYYYMMDD_HHMMSS.db /path/to/wrs_inspections.db

# then verify, in this order
curl .../api/health                 # healthy, WAL
curl .../api/audit/verify           # must say "unbroken"
```

Re-run this drill whenever the schema changes or the host moves. A backup
nobody has restored from is not a backup.


## Index the maintenance manual (one-off, per deployment)

"Ask the Manual" searches the full RDSO Wagon Maintenance Manual 2.0. The
index is built on the server from the manual itself:

```bash
npm run index-manual -- "/path/to/Vol-I (System Documentation)_merged.pdf"
```

It extracts the text (via `pdftotext`, from poppler), splits it into passages
and builds the FTS5 index — roughly 2,300 passages across 659 pages. Until
this is run, manual search returns a clear "not indexed on this server yet"
error rather than silently finding nothing.

**The manual text is deliberately not committed to this repository.** It is
copyrighted RDSO material and this repository is public. Keep the PDF with the
deployment, not in git.


## What's already offline-first (no extra work needed)

You mentioned wanting the app to work offline and sync once connected — this is already built and doesn't depend on the hosting choice: inspection/checklist data is queued in the browser's IndexedDB when offline (`client/src/services/offlineDb.ts`) and syncs automatically once connectivity returns. A patchy workshop wifi doesn't block an inspector from working.

## Deploying

1. Provision a Linux VM (Ubuntu 22.04+ recommended) with Node 22+ available (or just Docker — the provided `Dockerfile` bundles Node 22 itself, so you don't need to install Node on the host at all).
2. Point a domain (even a subdomain like `wrs-raipur.yourdomain.in`) at the VM's IP — you need this for a real TLS certificate; camera/OCR/QR features require HTTPS.
3. Copy `.env.example` to `.env`, fill in a real `JWT_SECRET` (`openssl rand -hex 32`). The app will refuse to start in production without this — that's intentional, not a bug.
4. `docker compose up -d --build`
5. Set up `deploy/nginx.conf.example` in front of it (instructions in that file) — this is what gets you HTTPS via Let's Encrypt/certbot.
6. Confirm `https://your-domain/api/health` returns `{"status":"healthy",...}` and `https://your-domain/` loads the app.
7. Log in as an admin (a seeded demo admin account initially — see the rollout plan for replacing these with real accounts) and create real inspector/supervisor/DRM accounts via `POST /api/auth/users`, then deactivate the demo ones.

## Backups

`server/scripts/backup-db.sh` takes a safe, integrity-checked backup of the live database (works correctly even while the app is running — it doesn't need to be stopped) and prunes anything older than 30 days. Schedule it:

```bash
# crontab -e (on the host, or inside the container via a sidecar/cron job)
0 2 * * * /path/to/server/scripts/backup-db.sh >> /var/log/wrs-backup.log 2>&1
```

If running via Docker, either run this from the host against the named volume's mount point, or add a small cron sidecar container that shares the `wrs_data` volume — happy to wire that up once you've picked a host and volume layout.

**Also copy backups off the VM periodically** (to a second location — another cloud region, an on-prem NAS, wherever) — a backup that lives only on the same machine as the live database doesn't protect against that machine's disk failing.

## Before this counts as "live"

Run through `docs/SHADOW_MODE_ROLLOUT.md` — parallel-run against the paper process for about a week before treating the app as the system of record.
