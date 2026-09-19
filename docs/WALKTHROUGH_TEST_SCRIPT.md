# Walkthrough test script — every screen, by hand, the way it will run for the DRM

This is the human check. The automated rehearsal (`bash scripts/demo-day.sh`)
proves every claim in DEMO_DAY.md against the screen; this script is for a
person to walk every screen with their own hands and eyes, on the machines
the demonstration will use, and tick each line. Roughly ninety minutes the
first time, forty after that.

Tick each line only when you saw it. If a line does not match, photograph
the screen and note the step number — that is the bug report.

## 0. How it runs on the day

There is no "localhost vs something else" choice to make — it is both, at once:

- **The demonstration laptop runs the server** (`START.cmd`). On that laptop,
  the presenter opens **`https://localhost:3000`**. This is the screen that
  goes on the projector.
- **The tablet opens the same server over the laptop's Wi‑Fi**, at
  `https://<laptop address>:3000` — `START.cmd` prints that address under
  "From a tablet". Laptop and tablet must be on the same network: either the
  shop Wi‑Fi, or the laptop's own hotspot (Windows: *Settings → Network →
  Mobile hotspot*; the tablet joins it). No internet is needed on either.
- The **shop PC**, after a yes, runs exactly the same folder the same way;
  the tablets then use the shop PC's address instead.

While rehearsing on a Mac with `KEEP=1 bash scripts/demo-day.sh`, the
address is `https://localhost:3200` and the tablet uses the Mac's Wi‑Fi
address with `:3200`.

**The certificate warning.** The first time a browser opens the address it
warns that the certificate is not trusted. On the laptop click *Advanced →
Proceed* once. On the tablet install `server\certs\lan-cert.crt` once
(TABLET_TRUST.md) — without that the tablet's camera will not open. Do this
the evening before, never in the room.

## 1. Before signing in

| # | Do | Must see |
|---|---|---|
| 1.1 | Open the address on the laptop | Sign-in page; the language toggle (हिंदी) top right; no console of errors, no blank page |
| 1.2 | Tap हिंदी, then English | Every label on the sign-in page changes language, both ways |
| 1.3 | Sign in with a wrong password | A plain refusal, in the chosen language; nothing else leaks |
| 1.4 | **First install the certificate on the tablet** (TABLET_TRUST.md) **and turn its mobile data off.** Then open the address | Same page with no warning; the browser offers "Add to home screen" (or the install icon) — accept it, so the app has its own icon. *Without the certificate the page opens but nothing below works offline and the camera stays shut.* |
| 1.5 | On the tablet, turn Wi‑Fi off, reopen the app icon | The app still opens (it is installed); an "offline" indicator appears. Turn Wi‑Fi back on — it reconnects within seconds. *If it "stops loading" after Wi‑Fi returns, the tablet has switched to mobile data: see TABLET_TRUST.md.* |

## 2. Inspector — on the tablet

Sign in as **`inspector1` / `password123`**.

| # | Do | Must see |
|---|---|---|
| 2.1 | Home | Two large cards, both always visible: **Springs** (sort on the bench, or measure one) and **A wagon** (checklist, wheels, photographs, parts). Under Springs: *Your record today* — count, bands, and the day's list |
| 2.2 | **Sorting** | Bogie type, condition (Used/New), position (Outer/Inner/Snubber) selectors; the band strip: **six coloured buttons for a used spring** (Blue, Green, Yellow, Orange, White, Red) each with its height range and Roman numeral; three for a new one |
| 2.3 | Tap Green, Yellow, Blue | The session total rises by one each time; *Your record today* below the strip shows the three, newest first, with time, height and gauge |
| 2.4 | Tap **Undo last** | Total goes down by one; the undone spring is named |
| 2.5 | Gauge picker | The gauges named (OSG‑01, OSG‑02, ISG‑01, SSG‑02). Choose position *Snubber* → SSG‑02 → the amber note "no calibration date is recorded" |
| 2.6 | The red bar under the strip: **Condemn this spring** | A reason must be chosen (crack, corrosion, deformation, under height…); a photograph is asked for if photographing is on; the spring is recorded CONDEMNED with the reason and appears red in *Your record today*. Cancel and confirm both work |
| 2.7 | Tick **Photograph springs while sorting** | The live camera opens right under the tick box, large, with a green *Photographing* badge. Nothing else to choose: keep sorting by tapping bands and each tap saves a photo. Put your hand in front: the screen says a person is excluded; it never says "spring 98%". Everything under *Teach the camera (advanced)* is folded away and not part of the day's work |
| 2.8 | Change bogie type to LWLH25 or LCCF20 | The strip disappears; a height is typed instead; the condemning height shown comes from WMM §309C / G‑112 |
| 2.9 | Hindi toggle on this screen | Band names in Hindi with the same colours; numbers unchanged |
| 2.10 | **Single Spring** — this is one spring *on a wagon*, so it first asks which wagon and bogie; scroll to **Free height** | Type 258.5 (NLB outer used) → band Green, Table 28. Type 244 → CONDEMNED with the reason. Type 263.1 → over-height, condemned. Type "abc" → refused, no crash |
| 2.11 | **A wagon → All wagons** | The list of wagons in the shop with their stage. Type `WR/BCNHL/40112` → it opens |
| 2.12 | Wagon → **Checklist** | Categories as tabs; items with Pass / Fail / Condemn; a condemned item asks for a note. The springs section links to the sorting records |
| 2.13 | Wagon → **Photos** | Four assembly frames with pocket counts. Bogie 1·A: two counts agree. Bogie 2·B: "counted by Praveen Singh — a blind recount by someone else is needed" and **no figures**. Open the counter: tap pockets, the expected number is **not** shown. Close |
| 2.14 | Wagon → **Parts** — the wagon's parts ledger: what was taken **off** the wagon, what was fitted **on**, and what was **scrapped**, by position (Bogie 1 / 2, left / right) | The three lists; *Add a part* asks which position and where the part came from (new from Stores, reconditioned, or from another wagon) |
| 2.15 | Wagon → **Air‑brake test** tab (the Single Wagon Test) | The 14-row proforma; each row judged against the WMM limit as you type |
| 2.16 | Wagon → **Timeline** | The stage history with dates and who moved it |
| 2.17 | Wagon → Checklist → **Wheels** (on a BOXN wagon, e.g. `SER/BOXNHL/30914`). Tap a wheel | One large box: the tread diameter chalked on the disc. Type 917 → *below issue limit* against 919 / 906, with the drawing and rule beneath. The flange figures are folded under *optional* — only if the tyre defect gauge was used |
| 2.18 | Read a wagon number with the camera (A wagon → camera icon) | Point at any printed number; it proposes the text; you confirm or correct — it never records unconfirmed |
| 2.19 | **Manual** | Ask "brake block condemning limit" → **Answer — in the document's own words**, large, with *Source:* the manual and page beneath; further passages under *Also in*. Ask "wheel diameter variation same axle bogie" → IRCA Part III appears, cited by name. It quotes; it never paraphrases — that is deliberate |
| 2.20 | Wi‑Fi **off** on the tablet. Sort three springs. Wi‑Fi **on**. | The three sort while offline (a queued count shows); within a minute the queue empties and they appear on the laptop's records — exactly three, no duplicates |
| 2.21 | Try to open the DRM dashboard or Audit chain URL by hand | Refused — an inspector does not have those screens |
| 2.22 | Sign out | Back to the sign-in page; the back button does not reopen a signed-in screen |

## 3. Supervisor — on the laptop (projector)

Sign in as **`supervisor1` / `password123`**.

| # | Do | Must see |
|---|---|---|
| 3.1 | **Wagons Pipeline** | Thirteen wagons across the seven stages; each card with its stage, days in shop and target date |
| 3.2 | Register a wagon | Number, type, railway; a duplicate number is refused; a nonsense type is refused |
| 3.3 | Open `WR/BCNHL/40112` → **Photos** → *Pocket counts* | This is the same screen the inspector saw in 2.13, seen as a supervisor: three frames complete, and on **Bogie 2 · Side B** the figures the inspector was not shown — *6 of 7 outer counted* — because a supervisor may see a first count before the blind recount |
| 3.4 | → **Release checks** | The short count listed as an advisory, by name. Cannot release: the advisory must be acknowledged |
| 3.5 | Open `SER/BOXNHL/30914` → **Release checks** | Blockers: a condemned spring; wheel axle 3 left and right at 917.5 mm below the 919 last-shop-issue diameter; one bearing rotation check pending. The Authorise button is disabled |
| 3.6 | → **Checklist → Wheels** | The eight chalk figures with the limit and drawing number beside each; axle 3 flagged |
| 3.7 | → **Condition report** | A printable one-page report of the wagon's state |
| 3.8 | Open `SECR/BOXNHL/10492` (released) → **Release Certificate** | The certificate with its number, date (weeks ago, not today), TAT, the eight component categories, and a QR. **Scan the QR with a phone on the same Wi‑Fi**: it opens `/verify.html` on this server and shows **VERIFIED** — the signature checked in the phone's browser. *Print* gives a clean page |
| 3.9 | → **Passport** → *Export the passport* | A `.jsonl` file downloads — that file is for the **next workshop's software**, not for reading. Under the button: *What the passport holds* — how many stage moves, spring readings, checklist verdicts, parts, tests, photographs, and the sign‑off, with the dates and who sealed it |
| 3.10 | Pick a new date in the *Due out* box on a wagon in progress | A box opens asking **why** (it goes on the audit trail); *Move the date* is disabled until a reason is typed; afterwards a green line says *Due‑out moved 19 → 22, with the reason, on the audit trail*. Cancel discards |
| 3.11 | *(moved to Admin 5.9 — the pilot keeps Stores off the supervisor's menu on purpose, `pilotScope.ts`)* | — |
| 3.12 | *(moved to Admin 5.10 — same reason)* | — |
| 3.13 | *(moved to Admin 5.11 — same reason)* | — |
| 3.14 | *(moved to DRM 4.3 — the supervisor's pilot menu is the shop floor only)* | — |
| 3.15 | **Ask the Manual** | As 2.19 |
| 3.16 | *(moved to DRM 4.4)* | — |
| 3.17 | **Shadow Run** | A week of the log; the verdict panel; the line "the snubber on NR/BOXN/60334 — the register would have passed it". Record a new discrepancy and a shift summary; both appear |
| 3.18 | **Ask the Records** | "which wagon type condemns the most snubbers this quarter" → an answer with the count → *How this was computed* shows the SQL and rows. "is any gauge reading high" → OSG‑02, 1.1 mm, with the reading counts. A question it cannot answer → it says so, no guess |
| 3.19 | **Audit Chain** → *Verify chain again* | The green card pulses once and gains a line *Re‑derived just now — at HH:MM:SS, in N ms (check 2 this session)*; the count of entries checked |
| 3.20 | **Single Spring** → fill wagon, bogie, height → at the bottom next to *Save*, the amber button **Supervisor override — change the band** | Asks the new band, a reason and the one‑time code; the record shows both the original and the overridden band |
| 3.21 | Hindi toggle on the pipeline and release checks | Everything translated; wagon numbers and figures unchanged |

## 4. DRM — on the laptop

Sign in as **`drm1` / `password123`**.

| # | Do | Must see |
|---|---|---|
| 4.1 | **DRM Dashboard** — *Shop Floor — Right Now* | When does today's pile finish; how many bogies can we build; what Stores will need — each a figure with its basis, none "Not yet known" |
| 4.2 | Scroll: turnaround, where wagons wait, what keeps coming back, inspector quality, gauge exposure | Every rate carries its count; the band pie shows **six** colours with the bench included in its total |
| 4.3 | **Spring Analytics** | Bench totals today/week; **tap a day's bar** → that day's figures read out beneath; stock by band; the standard report ("against the standard") with **n** on every figure; **Gauge drift** panel naming OSG‑02 |
| 4.4 | **System Learning** → *Run Analysis* | Each subsystem with its measured agreement and count; the camera says it has been taught nothing yet and auto‑commit is off. After *Run Analysis* a green line: *Analysed at HH:MM — N observations, 0 new proposals (nothing worth changing yet)* |
| 4.5 | **Shadow Run** | Visible, read-only (no record buttons) |
| 4.6 | **Ask the Records** | As 3.18 |
| 4.7 | **Audit Chain** → Verify | As 3.19 |
| 4.8 | Wagons Pipeline | **No *Register New Wagon* button** for the DRM; the server refuses the DRM too. (A supervisor typing a junk number like `ADSFADS` is refused: "not a wagon number". A supervisor who registers a wagon by mistake opens it → *Registered in error?* → reason → one‑time code → it leaves the pipeline; the record stays) |
| 4.9 | Open `SECR/BOXNHL/10492` → *Release Certificate* → **scan the QR with the phone** (same Wi‑Fi) | The phone opens the verify page and shows **VERIFIED** — the certificate's signature checked against the shop's key, in the phone's browser. (The same page also accepts a certificate *file* handed over on paper/USB, with no server at all — that is what another railway would do) |

## 5. Admin — on the laptop

Sign in as **`admin1` / `password123`**.

| # | Do | Must see |
|---|---|---|
| 5.1 | **User Accounts** | The roster; create an account (one-time code asked); deactivate it → it cannot sign in; reactivate → it can |
| 5.2 | **Roster import** — three ways to make accounts: one at a time (the form at the top), paste from a spreadsheet, or **open the office's CSV file** | Paste or open three lines (name, ID, role) → preview → confirm → three printable slips with passwords |
| 5.3 | *What each role holds* table | Read‑only by design (the note above it says why): who may do what, fixed in the system; the admin **cannot** release a wagon. To change a person's access, change their role on their row |
| 5.4 | **Checklist Rules** | The blue box says what it is (the list every wagon of that type is checked against), what you can do (add a shop line with reason and source; withdraw one), and when (rarely). Pick a wagon type; add a line; withdraw it — each recorded under your name |
| 5.5 | Gauge Register (bottom of **User Accounts**) — the instruments on the bench and their calibration papers | Four gauges; SSG‑02 shows its certificate number and *NOT RECORDED* because its label has no dates; *Record calibration* → the dates from certificate 1251122‑04‑125 → amber note goes. The drift box above lists **one line per finding** ("the two gauges on this kind disagree by 1.5 mm — put both against the master") |
| 5.6 | **DRM Dashboard** as admin — *Deployment readiness* and *Storage* are now the **first two panels** | Every row a plain sentence: backup (where, how old), cloud copy (not configured), manual (green, each document named), demo passwords (red on the demo record, saying why they still sign in), restarts, audit chain, storage |
| 5.7 | Top right: **Password** (key icon, now labelled) | The panel opens in full over the page (it used to be cut off under the header). Old password stops working; new one works. Same for every role |
| 5.8 | Top right: **Authenticator** (shield icon, now labelled) | The panel opens in full; a QR to scan; a wrong code refused; a right code enrols; the account then needs the code at sign‑in |
| 5.9 | **Stores & Inventory** | Parts with stock; **+ Add a part** → code, name, category, bin → it appears in the list; restock 10 → stock rises by 10; restock 1.5 → refused |
| 5.10 | **Component Passports** | Serialised wheelsets and bearings; paste `WRS-PASSPORT\|WHL-RWF-2023-8841\|WHEELSET\|RWF_YELAHANKA` → its history |
| 5.11 | **History & Logs** | Pick a band or status → the list narrows at once; type part of a wagon number → narrows as you type; the count line says *N records matching …* with *Clear filters*. Export CSV asks for the one‑time code |

## 6. Failure drills — once, on the machine you are rehearsing on

Every one of these is one command on the Mac, and one action on the laptop.
Open a terminal in the project folder (`cd ~/Desktop/WRS_Raipur`).

| Mac (rehearsal) | Demo laptop (Windows) |
|---|---|
| `bash scripts/rehearsal.sh start` — package, seed, start on :3200, keep running | double‑click `START.cmd` |
| `bash scripts/rehearsal.sh stop` | close the `START.cmd` window |
| `bash scripts/rehearsal.sh status` — the two addresses | the addresses `START.cmd` prints |
| `bash scripts/rehearsal.sh log` | open `logs\wrs-<today>.log` in Notepad |
| `bash scripts/rehearsal.sh backup` | wait for 02:00, or run `server\scripts\backup-db.mjs` per INSTALL §7 |
| `bash scripts/rehearsal.sh restore` | RESTORE_DRILL.md |

| # | Do | Must see |
|---|---|---|
| 6.1 | On the phone, sign in as `inspector1`, open **Sorting**. On the Mac: `bash scripts/rehearsal.sh stop`. On the phone, tap two bands. | The phone shows *offline* / *waiting to send*; the taps are accepted and counted. Then `bash scripts/rehearsal.sh start` (a minute or two). The phone reconnects on its own; the queue empties; *Your record today* shows the two taps once each |
| 6.2 | On the Mac, turn Wi‑Fi off. Use the laptop's own screen; look at the phone. | The Mac's own `https://localhost:3200` keeps working; the phone goes offline and queues. Wi‑Fi back on → the phone reconnects |
| 6.3 | `bash scripts/rehearsal.sh log` | Lines for every start; every request with its status; the stop from 6.1 written with its reason |
| 6.4 | `bash scripts/rehearsal.sh backup` | A `…db.enc` and its `.hmac` listed in `backups-elsewhere/`, with the time. As admin, the *Deployment readiness* row for the backup shows *newest 0 hours ago* |
| 6.5 | `bash scripts/rehearsal.sh restore` | The newest backup restored into a second folder, and a table: wagons, inspections, sorting records, audit entries — **live and restored counts equal** |
| 6.6 | *(Plan B, only if a phone must join on its own internet)* `bash scripts/rehearsal.sh tunnel` | A public `https://…trycloudflare.com` address that opens on any phone with no certificate warning. Demonstration only: the data crosses Cloudflare, so never for the shop's live record |

## 7. What must NOT happen, anywhere

- No screen ever says "spring 98%" or shows a confidence number a person did not enter.
- No inspector ever sees a pocket count's figures before the blind recount.
- No record can be edited or deleted — only added to. Try; the trigger refuses.
- No page reaches the internet. On the laptop, open the browser's network panel: every request goes to `localhost` or the laptop's own address.
- Nothing asks for an email, a phone number, or a photograph of a person.

## 8. When you have ticked everything

Write the date and your initials at the top of your printed copy. That
copy goes in the folder with the stick. If any line failed, the step number
and the photograph come to the developer the same day; the fix, the gate
(`bash scripts/preflight.sh`, 16 steps) and a fresh stick follow within the day.
