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
| 1.4 | Open the same address on the tablet | Same page; the browser offers "Add to home screen" (or the install icon) — accept it, so the app has its own icon |
| 1.5 | On the tablet, turn Wi‑Fi off, reopen the app icon | The app still opens (it is installed); an "offline" indicator appears. Turn Wi‑Fi back on |

## 2. Inspector — on the tablet

Sign in as **`inspector1` / `password123`**.

| # | Do | Must see |
|---|---|---|
| 2.1 | Home | Three or four large choices: sort springs, a wagon, a single spring, photographs. Big enough to hit with a gloved thumb |
| 2.2 | **Sorting** | Bogie type, condition (Used/New), position (Outer/Inner/Snubber) selectors; the band strip: **six coloured buttons for a used spring** (Blue, Green, Yellow, Orange, White, Red) each with its height range and Roman numeral; three for a new one |
| 2.3 | Tap Green, Yellow, Blue | The session total rises by one each time; the last tap is shown; the pace readout moves |
| 2.4 | Tap **Undo last** | Total goes down by one; the undone spring is named |
| 2.5 | Gauge picker | The gauges named (OSG‑01, OSG‑02, ISG‑01, SSG‑02). Choose position *Snubber* → SSG‑02 → the amber note "no calibration date is recorded" |
| 2.6 | **Off the strip** (condemn) | A reason must be chosen; a photograph is asked for; the spring is recorded CONDEMNED with the reason. Cancel and confirm both work |
| 2.7 | Photograph springs while sorting (toggle) → camera | The camera opens on the tablet. Put your hand in front: the screen says a person is excluded. Point at the bench: "target region", **never** "spring 98%" |
| 2.8 | Change bogie type to LWLH25 or LCCF20 | The strip disappears; a height is typed instead; the condemning height shown comes from WMM §309C / G‑112 |
| 2.9 | Hindi toggle on this screen | Band names in Hindi with the same colours; numbers unchanged |
| 2.10 | **Single Spring** | Type a height (e.g. 258.5, NLB outer used) → band Green, Table 28. Type 244 → CONDEMNED with the reason. Type 263.1 → over-height, condemned. Type "abc" → refused, no crash |
| 2.11 | **A wagon → All wagons** | The list of wagons in the shop with their stage. Type `WR/BCNHL/40112` → it opens |
| 2.12 | Wagon → **Checklist** | Categories as tabs; items with Pass / Fail / Condemn; a condemned item asks for a note. The springs section links to the sorting records |
| 2.13 | Wagon → **Photos** | Four assembly frames with pocket counts. Bogie 1·A: two counts agree. Bogie 2·B: "counted by Praveen Singh — a blind recount by someone else is needed" and **no figures**. Open the counter: tap pockets, the expected number is **not** shown. Close |
| 2.14 | Wagon → **Parts** | The parts ledger: off / on / scrapped per position; adding a part asks position and source |
| 2.15 | Wagon → **SWT** (air brake) | The 14-row proforma; each row judged against the WMM limit as you type |
| 2.16 | Wagon → **Timeline** | The stage history with dates and who moved it |
| 2.17 | Wagon → Checklist → **Wheels** (on a BOXN wagon, e.g. `SER/BOXNHL/30914`) | Eight wheels; type a diameter → judged live against 919 / 906 with the drawing number and the IRCA rule quoted beneath |
| 2.18 | Read a wagon number with the camera (A wagon → camera icon) | Point at any printed number; it proposes the text; you confirm or correct — it never records unconfirmed |
| 2.19 | **Manual** | Ask "brake block condemning limit" → the manual's words with page number. Ask "wheel diameter variation same axle bogie" → IRCA Part III, cited by name |
| 2.20 | Wi‑Fi **off** on the tablet. Sort three springs. Wi‑Fi **on**. | The three sort while offline (a queued count shows); within a minute the queue empties and they appear on the laptop's records — exactly three, no duplicates |
| 2.21 | Try to open the DRM dashboard or Audit chain URL by hand | Refused — an inspector does not have those screens |
| 2.22 | Sign out | Back to the sign-in page; the back button does not reopen a signed-in screen |

## 3. Supervisor — on the laptop (projector)

Sign in as **`supervisor1` / `password123`**.

| # | Do | Must see |
|---|---|---|
| 3.1 | **Wagons Pipeline** | Thirteen wagons across the seven stages; each card with its stage, days in shop and target date |
| 3.2 | Register a wagon | Number, type, railway; a duplicate number is refused; a nonsense type is refused |
| 3.3 | Open `WR/BCNHL/40112` → **Photos** | Now the supervisor sees "6 of 7 outer counted" on Bogie 2·B — what the inspector could not |
| 3.4 | → **Release checks** | The short count listed as an advisory, by name. Cannot release: the advisory must be acknowledged |
| 3.5 | Open `SER/BOXNHL/30914` → **Release checks** | Blockers: a condemned spring; wheel axle 3 left and right at 917.5 mm below the 919 last-shop-issue diameter; one bearing rotation check pending. The Authorise button is disabled |
| 3.6 | → **Checklist → Wheels** | The eight chalk figures with the limit and drawing number beside each; axle 3 flagged |
| 3.7 | → **Condition report** | A printable one-page report of the wagon's state |
| 3.8 | Open `SECR/BOXNHL/10492` (released) → **Release Certificate** | The certificate with its number, date (weeks ago, not today), TAT, QR code, and the eight component categories. *Print* gives a clean page |
| 3.9 | → **Passport** → Export | A file downloads; the note says where to verify it |
| 3.10 | Move a target date (a wagon in progress) | A reason is required; the new date shows on the card; the Audit chain later shows the change with the reason |
| 3.11 | **Stores & Inventory** | Parts with stock; restock 10 of a part → stock rises by 10; restock 1.5 → refused; an inspector account cannot restock |
| 3.12 | **Component Passports** | Serialised wheelsets and bearings; scan/paste `WRS-PASSPORT\|WHL-RWF-2023-8841\|WHEELSET\|RWF_YELAHANKA` → its history |
| 3.13 | **History** | Filter by wagon, band, status, date; export CSV (asks for the one-time code) |
| 3.14 | **Spring Analytics** | Bench totals today/week, band shares, the standard report ("against the standard") with **n** on every figure, gauge drift with OSG‑02 named |
| 3.15 | **Ask the Manual** | As 2.19 |
| 3.16 | **System Learning** | Each subsystem with its measured agreement and count; the camera says it has been taught nothing yet and auto-commit is off |
| 3.17 | **Shadow Run** | A week of the log; the verdict panel; the line "the snubber on NR/BOXN/60334 — the register would have passed it". Record a new discrepancy and a shift summary; both appear |
| 3.18 | **Ask the Records** | "which wagon type condemns the most snubbers this quarter" → an answer with the count → *How this was computed* shows the SQL and rows. "is any gauge reading high" → OSG‑02, 1.1 mm, with the reading counts. A question it cannot answer → it says so, no guess |
| 3.19 | **Audit Chain** → Verify chain again | "Chain intact", the count of events, the time taken |
| 3.20 | Supervisor override on a spring (Single Spring → override) | Asks a reason and the one-time code; the record shows original and overridden band, both |
| 3.21 | Hindi toggle on the pipeline and release checks | Everything translated; wagon numbers and figures unchanged |

## 4. DRM — on the laptop

Sign in as **`drm1` / `password123`**.

| # | Do | Must see |
|---|---|---|
| 4.1 | **DRM Dashboard** — *Shop Floor — Right Now* | When does today's pile finish; how many bogies can we build; what Stores will need — each a figure with its basis, none "Not yet known" |
| 4.2 | Scroll: turnaround, where wagons wait, what keeps coming back, inspector quality, gauge exposure | Every rate carries its count; the band pie shows **six** colours with the bench included in its total |
| 4.3 | **Spring Analytics** | As 3.14 |
| 4.4 | **System Learning** | As 3.16 — read-only for the DRM |
| 4.5 | **Shadow Run** | Visible, read-only (no record buttons) |
| 4.6 | **Ask the Records** | As 3.18 |
| 4.7 | **Audit Chain** → Verify | As 3.19 |
| 4.8 | Try the Wagons → register, or Stores → restock | Not offered; if reached by URL, refused. The DRM reads; he does not write |
| 4.9 | A released wagon's certificate → scan the QR with a phone, or open `/verify.html` and paste the certificate JSON | **VERIFIED** — with the laptop's Wi‑Fi off. Change one character → NOT VERIFIED |

## 5. Admin — on the laptop

Sign in as **`admin1` / `password123`**.

| # | Do | Must see |
|---|---|---|
| 5.1 | **User Accounts** | The roster; create an account (one-time code asked); deactivate it → it cannot sign in; reactivate → it can |
| 5.2 | **Roster import** | Paste three lines (name, ID, role) → preview → confirm → three slips with passwords, printable |
| 5.3 | Capability matrix | Which role may do what; the admin **cannot** release a wagon |
| 5.4 | **Checklist Rules** | The 41 CASNUB items; add a shop item with a reason; withdraw it |
| 5.5 | Gauge Register (bottom of **User Accounts**) | The four gauges; SSG‑02 with its certificate number and blank dates; add a gauge; enter a calibration date → the amber note goes |
| 5.6 | **Deployment readiness** and **Storage** panels (bottom of the **DRM Dashboard**, admin only) | Every row with a plain sentence: backup (where, how old), cloud copy (not configured), manual indexed (green, naming each document), demo passwords (red on the demo record — and it says why they can still sign in), restarts, audit chain, storage |
| 5.7 | Change own password (key icon) | Old password stops working; new one works |
| 5.8 | Authenticator enrolment (shield icon top right, or the panel on User Accounts) | A QR to scan; a wrong code refused; a right code enrols; the account then needs the code at sign-in |

## 6. Failure drills — do these once, on the laptop

| # | Do | Must see |
|---|---|---|
| 6.1 | Close the `START.cmd` window while a tablet is mid-checklist | The tablet shows offline and keeps working. Double-click `START.cmd` → within ten seconds the tablet reconnects and syncs |
| 6.2 | Pull the laptop's network cable / turn Wi‑Fi off | The laptop's own screens keep working (localhost). The tablet goes offline and queues |
| 6.3 | `logs\wrs-<today>.log` | Every start and stop is written with a reason |
| 6.4 | Run the backup (`server\scripts\backup-db.mjs` or wait for 02:00) | A `.db.enc` and `.hmac` appear in the backup folder; the readiness row updates |
| 6.5 | Restore that backup onto a second folder (RESTORE_DRILL.md) | The restored copy opens and shows the same wagons |

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
