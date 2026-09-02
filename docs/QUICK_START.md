# WRS Raipur QC App — Quick Start

One page per role. The app has an English/Hindi toggle (top of screen) — use whichever is easier.

---

## Inspector — Springs

1. **Log in** with your username and password. Tap **Spring Batch**.
2. Enter the **wagon number** once, then pick the **bogie type**, whether the springs are **used or new**, and the **axle load**. The app tells you how many springs that configuration has — for a 20.32t NLB bogie it is 12 outer, 8 inner and 4 snubber, so 48 for the wagon.
3. The app then walks you through them one at a time, showing which spring you are on (e.g. *Bogie 1 · Outer Spring 5 / 12*). For each one:
   - Check the spring against the **strip**, exactly as you do now.
   - **Tap the band the strip shows** — the six colours are on screen with their height ranges. That is the whole entry: one tap, no typing.
   - The result and the band appear straight away, with a sound cue (chime = pass, buzz = condemned), and it tells you which colour to paint.
   - If the spring is **off the strip** — below the lowest band or above the highest — tap **Off the strip — condemn**.
   - If you need to record an exact measurement instead (a borderline spring, or a disputed reading), switch to the **Exact height** tab and type it. Both routes reach the same verdict.
   - If you can see a crack, corrosion or deformation, tap **+ Flag a visible defect**. That condemns the spring whatever its height.
   - Tap **Save & Next Spring**.
4. A condemned spring asks for a **photo** before you can move on — that photograph is the evidence behind the condemnation. It also tells you what the replacement must be: not just "a good spring", but the band and millimetre range that keeps the nest matched.
5. When the wagon is done you get a summary — how many passed, how many were condemned — and **Start Next Wagon**.

**If you are interrupted:** close the app, lock the tablet, or lose the page — it comes back on the same spring with your counts intact.

**No signal:** keep working normally. Readings are held on the device and sync by themselves once you are back in range. Nothing is lost and nothing is recorded twice.

**Note on the camera:** there is no photographing of springs or calipers. The strip already tells you the band, so the app just asks you to tap it. The camera is only for photographing a defect.

## Inspector — Spring Sorting (the loose-spring pile)

This is the bulk job — roughly **700 springs a shift** — and it is different from Spring Batch above. There is no wagon number here. These are dismantled springs going back into stock, and they become a wagon's springs later, when an assembly draws on them.

1. **Log in** and tap **Spring Sorting**.
2. Set the three things at the top once, then leave them: **Bogie type**, **Condition** (used or new), and **Spring position** (outer, inner or snubber). Sort one position at a time — mixing them up as you go is what makes the tallies useless.
3. Name the **gauge** you are using. If the gauge on the bench is not in the list, say so rather than picking the nearest name — a reading that names the wrong gauge is worse than one that names none.
4. For each spring: check it against the strip and **tap the band the strip shows**. One tap per spring. The chime means serviceable, the buzz means condemned.
   - Off the strip entirely? **Condemn this spring**, then say what you saw — crack, corrosion, deformation, or something else.
   - Need an exact figure instead? Use **What is the free height? (mm)**.
5. **Tapped the wrong band?** **Undo last spring** puts it right. Use it freely — at 700 a shift a wrong tap is certain, and undo does not delete anything, it records the correction.
6. **Finish sorting session** when you stop. That writes one entry for the session.

### "Worth a second look" — the amber box

Sometimes after you record a spring an **amber box** appears. It means the reading does not look like the others of its kind — most often because a digit got typed in the wrong order, so 260.5 became 206.5.

**Nothing has gone wrong, and nothing is blocked.** The spring is already recorded and the band above it stands. The box is a question, not a verdict.

- Gauge it again. If the reading **changed**, tap **Re-measured — it was wrong**, then use **Undo last spring** to correct the record.
- If the reading **was right all along**, tap **The reading stands**.

**Please answer it either way, including when the app was wrong.** "The reading stands" is not a complaint — it is how the app learns it is asking too often, and it is the only way that ever gets fixed. A box nobody answers stays exactly as annoying as it is today.

The box stays quiet until it has seen about a dozen springs of that kind, so it will say nothing at all early in a new batch.

### "Complete bogies from stock"

The panel above the tallies says how many **whole bogies** the sorted pile can actually supply, and — more usefully — **which position is holding that number down**.

Set **Building for** to the wagon you are supplying. If it says the outer springs are the limit, sorting more outers raises the number and sorting more snubbers does not. It also tells you how many springs are **stranded** — sorted, but with too few of their band to fill a group, so they sit in the bin until more of that band turn up.

## Inspector — Wagon Checklist

1. From the wagon list, open the wagon you're working on.
2. The **Checklist** tab shows every part grouped by category (Springs, Wheels & Axles, Bearings, Brake System, Couplers, Bogie Frame, Friction Wedges, Body). Items marked **MANDATORY** must all be addressed before the wagon can leave.
3. For each part: mark **PASS**, **FAIL**, **CONDEMNED**, **REPAIRED**, or **REPLACED**. Add a note if useful. Attach a photo with the camera icon if you want visual evidence on record.
4. **Voice mode**: tap the microphone icon and just say what you're doing — e.g. *"Brake beam repaired and tested"* — hands-free for when you're mid-repair and your gloves are greasy. It'll read back what it understood; say "undo" if it got it wrong.
5. You cannot mark the wagon ready for release until every mandatory item is addressed — this is enforced by the app, not just a reminder.

## Supervisor

- Everything an inspector can do, plus:
- **Override a spring's band**: opens an OTP-verification step — you'll need a one-time code before the override is recorded. Every override is logged with your name and reason.
- **Gate & Release** tab on a wagon: shows exactly what's still blocking release (in plain language, e.g. *"Mandatory component X has not been inspected"*). Once the list is empty you can sign off, which needs a **one-time code**: tap **Send OTP**, enter the code, tap **Verify OTP**, then authorise. The certificate is issued in your name and carries a signature that can be checked later.
- Some findings are **advisories** rather than blockers — most often a spring nest whose springs each pass but which are not matched as a set. These do not stop a release, but you have to **tick each one to accept it**, and your acceptance is recorded on the certificate. A wagon can leave with a mismatched nest only because a named person decided it should.
- **Scan a component QR code** (wheelset, bearing, draft gear, etc.) to pull up its full service history across every wagon it's been fitted to.

## DRM / Administrator — Stores planning

The **Analytics** screen carries a table headed *Expected spring replacements*. It is a shopping list for the next fortnight, and it is worth knowing exactly how it is built before ordering against it:

- **Handled** comes from the shop's own out-turn return — 5,747 wagons last year, of which BOXNHL alone was 2,503 — multiplied by the spring counts RDSO publishes for each wagon.
- **Condemned %** is measured here, from your own inspections. Nothing is assumed.
- **Order** is those two multiplied, rounded up. A shortfall stops a wagon; a surplus sits on a shelf.
- **From** is how many inspections the percentage rests on. Read this column before believing the row.

A spring type with **fewer than 30 condemnations** on record is listed as *not forecast yet* rather than given a number. That is deliberate. An order quantity invented from four observations is worse than a blank, because somebody acts on it. Early in the pilot most types will sit in that list, and the table will fill in as the record builds.

## Everyone

- **Everything you do is logged permanently** — who, what, when — and cannot be edited or deleted afterward, including by an administrator. This is by design: it's what makes the record trustworthy. A supervisor can check the log is intact at any time from the audit verification view; it will say so if a single entry has been altered.
- If something looks wrong (a reading, a checklist state), don't try to "fix" it by re-entering — flag it to your supervisor. The record should show what actually happened, corrections included, not be silently overwritten.
- The app works offline. If you lose signal mid-shift, keep working normally — it'll catch up once you're connected again.
