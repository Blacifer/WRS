# WRS Raipur QC App — Quick Start

One page per role. Every screen has an **English / हिंदी** toggle at the top right — use whichever is easier. The words below are the words on the buttons.

---

## Inspector — the home screen

Sign in. Two cards: **Springs** (sort on the bench, or measure one) and **A wagon** (checklist, wheels, photographs, parts). Under them, **Your record today** — how many springs you have logged, how many passed, the bands, and the newest few with the time. It is your own count for the day; a supervisor sees the same figures.

The bar at the top: **Tasks / Home · Sorting · Single Spring · Spring Batch · Manual · Logout**.

## Inspector — Sorting (the loose-spring pile)

This is the bulk job — roughly **700 springs a shift**. No wagon number: these are dismantled springs going back into stock.

1. Tap **Sorting**. Set the three things at the top once, then leave them: **Bogie type**, **Condition** (Used / New) and **Spring position** (Outer / Inner / Snubber). Sort one position at a time.
2. Pick the **Gauge** you are using from the list. If the gauge on the bench is not listed, say so rather than picking the nearest name. A gauge with no calibration date shows an amber note; work continues, the readings are marked.
3. For each spring: check it against the strip and **tap the band the strip shows** — six coloured buttons for a used spring (Blue I … Red VI, each with its millimetres), three for a new one. One tap per spring. Chime = serviceable, buzz = condemned.
   - Off the strip, or a crack, corrosion or deformation you can see → **Condemn this spring**, then tap what you saw. The reason is the record.
   - **Bogie type LWLH25 or LCCF20** has no band table: type the **free height** instead and the screen says serviceable or condemn against WMM §309C.
4. **Tapped the wrong band?** **Undo last spring**. Use it freely — it names what it took back and records the correction; nothing is deleted.
5. **Photograph springs while sorting** — tick it once for the session. The camera opens under the tick box; each band tap saves a photograph against that spring. The camera keeps the evidence; it does not decide.
6. **Finish sorting session** when you stop.

### "Worth a second look" — the amber box

After a typed reading an amber box may say the figure does not look like the others of its kind — usually a digit in the wrong order (206.5 for 260.5). Nothing is blocked; the spring is recorded. Gauge it again: if the reading changed, tap **Re-measured — it was wrong** and use **Undo last spring**; if it was right, tap **The reading stands**. Answer it either way — that is how it learns to ask less.

### "Complete bogies from stock"

The panel under the tallies says how many **whole bogies** the sorted pile can supply and **which position is holding that number down**. Set **Building for** to the wagon you are supplying. Springs "stranded" are sorted but too few of their band to fill a group.

## Inspector — Single Spring (one spring, on a wagon)

Tap **Single Spring**. It first asks which wagon and bogie, then the **free height**. The verdict names its table (e.g. *Green, Table 28*). Physical damage condemns regardless of height.

## Inspector — A wagon

Tap the **A wagon** card → the wagons in the shop with their stage → tap one, or **All wagons** and type the number (or the camera icon, **Read the number painted on the wagon** — it proposes the text; you confirm or correct it). Then **Continue checklist**. The wagon's tabs:

- **Checklist** — every part by category (Springs, Wheels & Axles, Bearings, Brake System, Couplers & Draft Gear, Bogie Frame & Bolster, Friction Wedges, Body & Underframe). Each item: **Pass · Fail · Condemned · Repaired · Replaced**; condemning asks for a note; a mandatory item cannot be skipped. Under the list, **the wheels**: tap a wheel and type the **tread diameter** chalked on the disc — the limit and the drawing appear as you type. Flange figures are optional, folded away.
- **Photos** — the four bogie assembly frames and the **pocket counts**. You count what is in the photograph; the expected number is never shown to you. A second person recounts blind.
- **Parts** — *Parts in, parts out*: **Came off · Went back on · Replaced with new · Scrapped · Not being refitted**, by category and position. This is what answers "was anything missing" months later.
- **Air-brake test** — the Single Wagon Test proforma (WMM §720-C), 14 rows, each judged against its limit as you type.
- **Timeline** — every stage with the date and who moved it.
- **Voice**: the microphone reads back what it understood; say "undo" if it got it wrong. Anything a model proposes is shown for you to confirm — it records nothing by itself.

## Inspector — Manual

Tap **Manual** and ask in plain words (*brake block condemning limit*). The answer is **in the document's own words**, with the page and the source beneath. It quotes; it never paraphrases. Works with no internet.

## Everyone — no signal

Keep working. Readings are held on the tablet — the screen says how many are waiting — and send themselves when the network is back. Nothing is lost and nothing is recorded twice. If the app "stops loading" when the Wi‑Fi returns, the tablet has switched to mobile data: turn mobile data off.

## Supervisor

Everything an inspector can do, plus:

- **Wagons Pipeline** — every wagon by stage; **Advance to Next Stage** moves it; the **Due out** date can be changed, with a reason, and the change is on the record.
- **Release checks** on a wagon — what still blocks release, in plain words (a condemned spring, a wheel below the last-shop-issue diameter, a pocket count that fell short, an item not yet inspected). **Advisories** do not block but must each be ticked to accept, and the acceptance is on the certificate. Sign-off needs a **one-time code**.
- **Photos** — the supervisor sees the pocket-count figures the inspector was not shown (*6 of 7 outer — one pocket may be empty*).
- **Supervisor override — change the band** on a single spring: OTP, name and reason, all recorded. **Registered in error?** on a wagon registered by mistake: OTP and a reason; the wagon is marked void, never deleted.
- **Passport** — a wagon's signed, portable history; export it for the next shop. The **certificate** carries a QR that verifies on any phone with no server.
- **Shadow Run** — the register and the app side by side; the disagreement log decides go-live.
- **Ask the Records** — a question in plain words; the answer shows the query and the rows it came from.

## DRM

**DRM Dashboard** — *Shop Floor — Right Now*: when today's pile finishes, how many bogies can be built, where wagons wait, what keeps coming back — every figure with its count. **Spring Analytics** — the shop's springs against the standard; *Expected spring replacements* for the fortnight, with the number of inspections each rate rests on (a type with too few condemnations is listed *not forecast yet* on purpose). **Audit** — *Verify chain*; the record proves nothing was altered after it was written. A DRM cannot register or inspect a wagon.

## Administrator

**People, and what they can reach** — accounts, roles, the capability matrix (read-only), roster import from a CSV. **Checklist rules** — the items, which are mandatory, the expected quantities and where each figure comes from. **Gauges** — the register with calibration dates; a gauge reading systematically high shows up here from the record itself. **Stores** — parts and stock, **+ Add a part**. **History and logs** — filter as you type. **Deployment readiness** — the checks the PC must pass, at the top of the dashboard.

## Everyone

- **Everything you do is logged permanently** — who, what, when — and cannot be edited or deleted afterwards, including by an administrator. Corrections are recorded as corrections.
- If something looks wrong, don't "fix" it by re-entering — tell your supervisor. The record should show what happened.
- A person decides. The camera photographs and counts; it may only sort on its own once blind reads on this shop's springs have earned it, and until then the server refuses it.
