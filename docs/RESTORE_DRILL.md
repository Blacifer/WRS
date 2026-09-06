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

It ran on the same machine, from a backup taken minutes earlier. Before the
pilot carries real inspections, run it once **onto a different machine**,
from a backup at least a day old, with the key fetched from wherever it will
actually live. That is the version that tests the thing most likely to fail:
not the script, but whether the key is somewhere a person can reach at the
moment they need it.


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
