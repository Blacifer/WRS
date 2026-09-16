# The DRM's mirror — the shop's record, readable from headquarters

The live system stays on the shop's PC. The DRM sits at division
headquarters. This is how the DRM reads the shop's dashboards from there
without the live system ever leaving the shop.

## How it works

1. The shop's server takes its encrypted backup every night (it schedules
   itself) and, with the cloud settings in `.env`, pushes it to the bucket.
2. A second copy of the same bundle runs where the DRM is — a small VM from
   the railway's cloud, or a PC at HQ — started with two extra settings:
   ```
   WRS_READ_ONLY_MIRROR=true
   WRS_BACKUP_SCHEDULE=off
   ```
   plus the same `WRS_CLOUD_*` four and a copy of the shop's backup key in
   `WRS_BACKUP_KEY_FILE`.
3. A scheduled task on the mirror runs, hourly or nightly:
   ```
   node --experimental-strip-types server\scripts\mirror-refresh.mjs
   ```
   It lists the bucket, takes the newest backup, restores it beside the
   mirror's database, swaps it in, and the mirror server reopens it within
   seconds.

## What the mirror can and cannot do

- The DRM signs in with the same account as in the shop — accounts come with
  the restored copy.
- Every dashboard, report, question and certificate reads as it does in the
  shop, as of the backup's time. A band across the top says when that was.
- **Nothing can be recorded.** Every write is refused by the server with
  `READ_ONLY_MIRROR`; the middleware does not depend on the screen behaving.
- It never writes to the bucket. The shop pushes; the mirror only reads.

## What it needs

- A machine that can reach the bucket (the shop PC cannot be reached from
  outside, and should not be).
- The same key the shop backs up with. Keep it where the shop's copy of the
  key is kept — the office, not the mirror's disk, if the mirror is a VM
  somebody else administers.
