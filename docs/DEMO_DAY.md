# Demo day — one page

The morning you show this to the shop, the DRM or RDSO. Everything here has a
command or a click; nothing needs the internet.

## The evening before

1. **Build the bundle on your own machine and check it.**
   ```
   bash scripts/preflight.sh        # 13 steps, all PASS
   npm run package:shop             # dist-shop/wrs-raipur
   ```
2. **Copy `dist-shop/wrs-raipur` to the demo PC** (or a USB stick beside the
   Node 22 installer, per `READ-ME-FIRST.txt` in the bundle).
3. **On the demo PC:** run the Node installer, double-click `START.cmd` twice
   (first run writes `.env` and the certificate), then **`DEMO-DATA.cmd`** and
   type `DEMO`. That writes the demonstration record: the demo accounts,
   thirteen wagons across all seven stages, a month of the sorting bench, one
   wagon's parts ledger, air-brake tests, assembly photographs with pocket
   counts, and a week of the shadow run. It refuses if the database already
   holds wagons, so it cannot land on a real record by accident. It also adds
   `SEED_DEMO_USERS=true` to `.env`, because a production build otherwise
   refuses the published demo password at sign-in — **delete that line, and
   the demo accounts, before the shop's real accounts are created.**
4. **Open `https://localhost:3000`**, sign in as `drm1 / password123`, and look
   at the DRM dashboard. The three tiles under *Shop Floor — Right Now* must
   show figures, not "Not yet known". If they do not, the seed did not run.
5. **On the tablet you will hold up:** install `server\certs\lan-cert.crt`
   once ([TABLET_TRUST.md](TABLET_TRUST.md)), open `https://<PC address>:3000`
   from the address `START.cmd` prints, sign in as `inspector1`, and open the
   camera on *Sorting → Photograph springs while sorting*. If the camera does
   not open, the certificate is not trusted yet — fix that tonight, not in the
   room.
6. **Take a backup** (`server\scripts\backup-db.mjs`, or the scheduled task)
   so the morning starts from a known file.

## The accounts

| Sign in as | Password | Shows |
|---|---|---|
| `inspector1` | `password123` | The tablet: sorting bench, single spring, checklist, camera |
| `supervisor1` | `password123` | Wagons pipeline, release checks, shadow run, Ask the Records |
| `drm1` | `password123` | DRM dashboard, spring analytics, learning, audit chain |
| `admin1` | `password123` | Accounts and capabilities, checklist rules, gauge register |

## A walk that takes fifteen minutes

Order matters: the shop floor first, the dashboards second, the proofs last.

1. **Sorting bench** (`inspector1`, tablet). Sort three springs by tapping the
   band on the strip. Undo one. Point out the gauge named on every record and
   the amber note that SSG-02 carries no calibration date — that note is
   transcribed from the real instrument's label.
2. **A wagon** (`inspector1`). Open `WR/BCNHL/40112` → *Photos*. The four
   assembly frames are there with their pocket counts; *Bogie 2 · Side B* is
   short one outer spring. Open the counter: the expected number is not on
   the screen — the person counts what is in the photograph.
3. **Release checks** (`supervisor1`). Same wagon, *Release checks*: the short
   count is waiting there as an advisory, by name. Then `SER/BOXNHL/30914` at
   the final gate — blocked by a condemned spring, and the gate says which.
4. **Ask the Records** (`supervisor1`). Type *which wagon type condemns the
   most snubbers this quarter* and *is any gauge reading high*. Open *How this
   was computed* — the query, its parameters, the rows. OSG-02 reads about a
   millimetre high; that is in the seed on purpose and the drift check finds
   it.
5. **DRM dashboard** (`drm1`). *When does today's pile finish*, *how many
   bogies can we build*, *where wagons wait*, *what keeps coming back*. Every
   figure carries its `n`. Then *Spring Analytics → What this shop's springs
   look like against the standard* — the distribution RDSO has never had.
6. **Audit chain** (`drm1`). *Verify chain again*. Then open a released wagon's
   certificate and its QR at `/verify.html` on the tablet — it verifies with
   no server.
7. **Shadow run** (`supervisor1`). A week of the log with one case the register
   would have passed and the app condemned — the one line that decides
   go-live.

## The questions you will be asked, and the honest answers

- *"Does the camera decide?"* No. It may only auto-commit once blind reads on
  this shop's own springs have earned it, the server refuses it until then,
  and the demo record has zero labelled photographs — the tile says so.
- *"Where do these percentages come from?"* Every rate on screen has a count
  under it. There is no confidence score anywhere that a person did not enter
  or the record did not count. (The old "OMRS AI triage" tiles were removed for
  exactly this reason.)
- *"What happens when the PC dies?"* `START.cmd` restarts the server, the log
  has the reason, the backup is on another disk, and
  [RESTORE_DRILL.md](RESTORE_DRILL.md) records a restore onto a second machine.
- *"What if the wifi drops?"* The tablet keeps working and syncs later without
  duplicating — the offline drill in preflight proves the lost-200 case.
- *"Is this the model's number?"* No model produces a number here. Ask the
  Records lets a model pick *which* question; the arithmetic is fixed SQL.
- *"What is not proven yet?"* The camera on real springs, the pocket model,
  the bearing detector on a real bad CTRB, and the shadow-run verdict. All
  four wait for the shop, and each screen says so where it applies.

## If something breaks in the room

- Screen blank or "cannot reach": on the PC, is the `START.cmd` window still
  open? If not, double-click it. Give it ten seconds.
- Tablet says not secure: the certificate is not installed on that tablet.
  Use the PC's own browser for the rest of the walk.
- Camera will not open on the tablet: same cause. Show the camera on the PC
  with a USB webcam, or skip it — the record does not depend on it.
- A screen says "Not yet known": that is the system refusing to guess. Say
  so; it is the point.
- Anything else: `logs\wrs-<today>.log` on the PC has the reason.
