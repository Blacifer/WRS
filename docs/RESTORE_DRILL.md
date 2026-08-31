# The restore drill, and its result

A backup nobody has restored is a hope, not a backup. This is the drill, and
the outcome of running it on 31 August 2026.

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
