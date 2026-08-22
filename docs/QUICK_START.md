# WRS Raipur QC App — Quick Start

One page per role. The app has an English/Hindi toggle (top of screen) — use whichever is easier.

---

## Inspector — Springs

1. **Log in** with your username/password. Tap **Spring Batch Inspection** (or "Smart Vision" on the home screen).
2. Enter the **wagon number**, pick **bogie type** and **condition** (Used/New) — you only do this once per wagon.
3. For each of the 6 springs (Outer/Inner/Snubber × Bogie 1/2, shown one at a time):
   - Tap **Take Photo** and frame the caliper's digital display in the box. The app reads the number automatically.
   - If the photo doesn't read cleanly (bad lighting, glare), a **manual entry box** appears — type the reading straight from the caliper.
   - The PASS/CONDEMNED result and color band show instantly, with a sound cue (chime = pass, buzz = condemned).
   - If you see a visible crack, corrosion, or deformation, tap **+ Flag a visible defect** and pick the type — this overrides the measurement and condemns the spring regardless of height.
   - Tap **Save & Next Spring**.
4. After all 6, you get a pass/condemn summary for that bogie. Tap **Start Next Wagon** to continue, or **Done** to exit.

**No signal / offline:** the app keeps working — readings are queued on the device and sync automatically once you're back online. You don't need to do anything differently.

## Inspector — Wagon Checklist

1. From the wagon list, open the wagon you're working on.
2. The **Checklist** tab shows every part grouped by category (Springs, Wheels & Axles, Bearings, Brake System, Couplers, Bogie Frame, Friction Wedges, Body). Items marked **MANDATORY** must all be addressed before the wagon can leave.
3. For each part: mark **PASS**, **FAIL**, **CONDEMNED**, **REPAIRED**, or **REPLACED**. Add a note if useful. Attach a photo with the camera icon if you want visual evidence on record.
4. **Voice mode**: tap the microphone icon and just say what you're doing — e.g. *"Brake beam repaired and tested"* — hands-free for when you're mid-repair and your gloves are greasy. It'll read back what it understood; say "undo" if it got it wrong.
5. You cannot mark the wagon ready for release until every mandatory item is addressed — this is enforced by the app, not just a reminder.

## Supervisor

- Everything an inspector can do, plus:
- **Override a spring's band**: opens an OTP-verification step — you'll need a one-time code before the override is recorded. Every override is logged with your name and reason.
- **Gate & Release** tab on a wagon: shows exactly what's still blocking release (in plain language, e.g. *"Mandatory component X has not been inspected"*). Once the list is empty, you can digitally sign off and generate the release certificate.
- **Scan a component QR code** (wheelset, bearing, draft gear, etc.) to pull up its full service history across every wagon it's been fitted to.

## Everyone

- **Everything you do is logged permanently** — who, what, when — and cannot be edited or deleted afterward, including by an administrator. This is by design: it's what makes the record trustworthy.
- If something looks wrong (a reading, a checklist state), don't try to "fix" it by re-entering — flag it to your supervisor. The record should show what actually happened, corrections included, not be silently overwritten.
- The app works offline. If you lose signal mid-shift, keep working normally — it'll catch up once you're connected again.
