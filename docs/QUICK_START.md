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

## Everyone

- **Everything you do is logged permanently** — who, what, when — and cannot be edited or deleted afterward, including by an administrator. This is by design: it's what makes the record trustworthy. A supervisor can check the log is intact at any time from the audit verification view; it will say so if a single entry has been altered.
- If something looks wrong (a reading, a checklist state), don't try to "fix" it by re-entering — flag it to your supervisor. The record should show what actually happened, corrections included, not be silently overwritten.
- The app works offline. If you lose signal mid-shift, keep working normally — it'll catch up once you're connected again.
