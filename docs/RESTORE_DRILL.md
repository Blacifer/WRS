# The restore drill, and its result

A backup nobody has restored is a hope, not a backup. This is the drill, and
the outcome of running it on 31 August 2026 — and again on 6 September 2026,
which is the run that matters, because it found a real fault.

## Running it

```bash
# 1. A key. Losing this loses every backup — there is no way around it.
openssl rand -hex 32 > /secure/place/backup.key
chmod 600 /secure/place/backup.key

# 2. Take one.
WRS_BACKUP_KEY_FILE=/secure/place/backup.key \
  bash server/scripts/backup-db.sh server/data/wrs_inspections.db /backups

# 3. Restore it somewhere ELSE. Never over the live database.
WRS_BACKUP_KEY_FILE=/secure/place/backup.key \
  bash server/scripts/restore-db.sh /backups/wrs_inspections_<stamp>.db.enc /tmp/restored.db
```

The restore script refuses to write over an existing file. Restoring onto a
live database would destroy everything recorded since the backup was taken,
which here means real inspections that exist nowhere else.

## What a pass looks like

Decrypting is not passing. These four are.

**Every table matches.**

| table | live | restored |
|---|---|---|
| inspections | 41 | 41 |
| spring_sorting_records | 42 | 42 |
| inspection_audit_log | 6 | 6 |
| users | 9 | 9 |
| checklist_items | 574 | 574 |
| wagons | 14 | 14 |
| manual_passages | 2359 | 2359 |
| spring_images | 3 | 3 |

**The audit chain still verifies.** Every hash recomputed, chain unbroken. A
file can decrypt cleanly and still have been altered before it was backed up;
this is what would show that.

**The immutability triggers survived the round trip.** All five refused:

```
UPDATE an inspection      refused
DELETE an inspection      refused
UPDATE the audit log      refused
UPDATE a sorted spring    refused
UPDATE spring evidence    refused
```

Worth checking explicitly, because triggers are schema objects and a restore
that brought back the rows without them would look perfect and quietly leave
the record editable.

**It serves a real session.** Boot the server against the restored file:

```bash
DB_PATH=/tmp/restored.db JWT_SECRET=$(openssl rand -hex 32) npm run dev --prefix server
```

Then sign in as a real account and call `/api/audit/verify`. On 31 August
2026 that returned an unbroken chain and the three stored spring photographs
were intact.

## What this drill has not proved

The first two runs were on the same machine, from a backup taken minutes
earlier. The 15 September run below restored onto a **separate installation
of the shipped bundle**, with the key fetched from a directory neither
machine's backup volume held. What is still not proved: a backup at least a
day old, and two physically separate PCs — the "second machine" was a copy
of the USB bundle in its own directory, run exactly as `START.cmd` runs it,
but on the developer's laptop. Before the pilot carries real inspections,
run the 15 September procedure once more with the second PC being the second
PC. The script is now proven; the remaining question is whether the key is
somewhere a person can reach at the moment they need it.


## The 6 September 2026 run

Run against a copy of the pilot database (4.0 MB) with a fresh key.

**The backup and restore path is sound.** All 30 tables matched exactly —
checklist_items 574, inspection_audit_log 476, manual_passages 2359, wagons
14, and the rest. All 23 triggers came back with the schema, and every one of
them still refused: UPDATE an inspection, DELETE an inspection, UPDATE the
audit log, DELETE from the audit log, UPDATE a sorted spring, UPDATE a gate
sign-off. The restored file served a real signed-in session.

**The audit chain did not verify — and it had not been the backup.** The
restored copy reported the same two breaks at the same row as the live file,
which is how the backup was cleared: it had faithfully copied a database that
was already broken.

The cause was in the writer, not in anything malicious. Rows 152 and 153
carried the same `previous_hash` and the same millisecond timestamp: two
writers had each read the same "last hash" and each appended. The chain
forked. Two people had signed in at the same moment.

Reproduced deliberately — four processes appending 240 entries to one
database file produced 3 forks. With the append wrapped in `BEGIN IMMEDIATE`,
the same test produces none.

Two things changed as a result:

- The append takes the write lock *before* it reads the last hash, so a
  second writer waits instead of reading a hash that is about to be
  superseded. This is the fix; the fork cannot recur.
- The verifier now separates a fork from a removal. They have different
  signatures — a fork leaves the parent and both children present, a removal
  leaves an entry pointing at a parent that is nowhere in the log — and
  reporting the first as "an entry was removed or inserted" was a false
  accusation that sent a reader hunting a crime that had not occurred. Both
  are still reported as breaks: a chain that forked is a chain somebody must
  look at.

**The existing break stays.** The log is append-only and history is not
rewritten to make a report look better. The pilot database still fails
verification, and now says why in words that are true: two entries were
appended at the same moment, both are present, nothing was removed.

This is what a drill is for. Nothing in the test suite would have found it,
because every suite writes from a single process.

## The 15 September 2026 run — onto the shipped bundle, as a second machine

**Machine one** was the developer database (`server/data/`, 33 wagons, 494
sorting records, 2,897 audit entries) with photographs beside it. **Machine
two** was `dist-shop/wrs-raipur/` — the folder the USB stick carries — copied
to a directory with no access to the repository, configured and started the
way `START.cmd` does: `.env` from the template with a generated secret, a
certificate made by `server/scripts/make-lan-cert.mjs`, the server over
`https`, output to `logs/wrs-2026-09-15.log`. The key lived in a third
directory, on neither the database's nor the backup's path.

What was done, and what each step showed:

```
MACHINE ONE  backup-db.mjs <db> <backup_dir> <photo_dir>
  Verified: encrypted, decrypts, and the result is a valid database (6.9M plaintext)
  Photographs: 1 carried this run, 0 already there            <- a photograph taken that day

MACHINE TWO  backup-db.mjs --restore <file.db.enc> server/data/wrs_inspections.db
  ERROR: server/data/wrs_inspections.db already exists. A restore never writes
  over a database that is there; move it aside first, on purpose.
                                                              <- see the fault below
  (moved aside)
  HMAC verified.
  Restored to server/data/wrs_inspections.db
             backup-db.mjs --restore-photos <backup_dir>/photos server/data/photos
  Photographs: 1 restored, 45 already present and identical, 0 different, 0 refused.

  sign in over https as admin.shop           an account created on machine one that day: ok, ADMIN
  sign in as admin1 (demo)                   DEMO_CREDENTIAL_REFUSED — production, correctly
  GET /api/photos/photo_5fecb095-…            imageVerified: true, imageSource: FILE,
                                              sha256 3abeb9d02c32fb4c… — the same hash machine one recorded
  GET /api/audit/verify                       verified: false, entries 2897, first break rowid 153,
                                              CONCURRENT_APPEND, 2026-09-05
  readiness                                   "The server has not been restarting": WARN,
                                              started 5 times in the last 24 hours
```

**The chain result is a pass, read carefully.** Machine one's chain, checked
directly before the backup, breaks at the same rowid 153 for the same reason:
a fork on 5 September, from before concurrent appends were serialised (commit
`aebf996`), which the verifier names and says "nothing has been removed". The
restore carried the record across in exactly the state it left — a restore
that came back *cleaner* would be the alarming one. The shop's own database
will have no such fork; it starts after that fix.

**The restarts figure is a pass too.** The server was started five times on
machine two during the drill; the panel said five. That check exists so that
a crash `START.cmd` keeps recovering from is visible somewhere.

**The fault this run found.** `backup-db.mjs --restore` — the one Windows
uses — copied straight over the database that machine two's first start had
made. The shell restore had always refused this, and this document said the
restore "refuses to write over an existing file" as if both did. It refuses
now, `scripts/backup-drill.sh` checks that it does, and the bundle carries
the fixed script from this commit on. Anyone restoring with an older bundle
should move the live database aside themselves before running it.

**Also noted.** Forty-five orphan photograph files from test runs made before
the temporary-directory guard existed were carried in the first backup of the
day and restored alongside. Harmless — no row points at them — and cleaned
from machine one afterwards. A photograph directory is only ever what the
rows say it is.

## Photographs

Since photographs became files beside the database (`server/src/db/photoStore.ts`),
a database restore alone brings back every row and every hash but not the
pictures. `scripts/backup-drill.sh` now also carries three photographs, adds
one, carries only that one, restores them byte for byte, and proves a restore
over a live directory with a differing file names it and leaves it alone.
The command is `backup-db.mjs --restore-photos`; see `INSTALL.md` §7. The
next real drill should restore both halves and open a wagon's photographs in
the app — `imageVerified: true` on each is the row vouching for the file.
