# Site visit — what the floor showed, and what it changed

Photographs taken at WRS Raipur, September 2026, read against the application.
The point of this page is the last column of each section: what the picture
made us build, fix, or write down.

## The sorting bench

**Seen.** Springs stacked on a steel table; the inspector drops each over a
gauge post and reads the free height against the post's collar. The snubber
gauge on the bench is **SSG-02** — an ASKIB "at lab / on site" label, issued to
SSE/CWM RWSS Raipur SECR, certificate no. 1251122-04-125, and both
*Calibrated on* and *Calibration valid upto* **blank**. Sorted springs get a
painted ring on a coil in the band colour; green and yellow rings are visible
on springs already in a bogie.

**Confirms.** The gauge register's shipped entry for SSG-02 is exact, blank
dates included, and the "calibration not established" note the analytics page
raises is about a real instrument. Reading a band off a post is the one-tap
strip the sorting screen already is.

**Changes.** The painted ring means the band survives onto the wagon —
so a nest's bands can be checked by eye at reassembly, which is what the nest
grouping advisory asks the supervisor to do. Nothing to build; written into the
advisory's wording is enough.

## The CBC and draft-gear section

**Seen.** A long run of wall charts above the reconditioning benches: the
reconditioning flow (knuckle, coupler body, draft gear and yoke — each
condemned if manufacturer, year built or material grade cannot be read; each
marked with workshop code, dispatch number and POH date before refitting), and
**thirty-odd numbered gauges with GO / NO GO values** for the RF-361 and
MARK-50 draft gears — housing width 320.66 / 315.89, housing height 465.15 /
461.90, wall thickness NO GO 15.88, wedge lug width 39.68 / 38.1, shoe
thickness 54.64 / 52.27, preshortening length 558.8, a 0.38 mm gap rule on
plates, wedges, shoes and seats, spring free heights 342 / 286 / 123. Cut-away
models of MK-50, RF-361, MK70E, MK325, Power Guard and F-325 G on the bench.

**Confirms.** The checklist's COUPLERS_DRAFT_GEAR items are the right items.

**Changes.** The app cited RDSO standards for those items and knew none of the
shop's own gauge numbers or limits. Now:

- [`docs/shop-floor/cbc-draft-gear-wall-charts.txt`](shop-floor/cbc-draft-gear-wall-charts.txt)
  is the transcription, one board per page, indexed under the source label
  **CBC_WALL** so *Ask the Manual* answers "housing wall thickness no go" with
  the board and the figure, and nothing else. The demo seed indexes it; a
  production installation indexes it with
  `npm run index-manual -- docs/shop-floor/cbc-draft-gear-wall-charts.txt CBC_WALL`.
- The two draft-gear checklist items now cite the shop gauges by number in
  their standard reference, so the line an inspector ticks names the gauge
  they used.
- One gauge number (shoe outside width, read as 27216) was not fully legible;
  it is marked *confirm on the board* in the transcription rather than guessed.

## The bogies and the wheelsets

**Seen.** CASNUB bogies rolled out with brake gear on, spring nests visible
through the side-frame window from floor level; wheelsets in a row with the
tread diameter and date **chalked on the disc** (e.g. 980.65 / 24); a slack
adjuster with its number painted on (K-1894); yellow paint marks on a side
frame; red and blue paint on adapter fixings.

**Confirms.** The assembly-frame protocol's "photograph from the marked floor
position, side frame window in frame" is what the floor already lets you do;
the side view in the first photograph is close to the frame the pocket counter
expects.

**Changes.** The wheel measurements were recorded on the wheel in chalk and
nowhere else; the checklist had "Wheel Tread Diameter (Axle 1-4)" as a verdict
and never took the number. A number without the limit it is judged against is
one nobody can act on, so the limits came first — from Indian Railways' own
training material (IRIMEE, rskr.irimee.in), which publishes the tread-diameter
table by wheel type with its drawing number (BCN/BOXN on CASNUB: new 1000,
last shop issue 919, condemn 906 — WD-97037 S-01), the permitted variation
within an axle (0.5), a bogie (13) and a wagon (25), and the flange and tread
condemning limits. They are in
[`shared/classification/wheelLimits.ts`](../shared/classification/wheelLimits.ts)
with the source on every figure, and as a citable document
([`docs/shop-floor/wheel-limits-irimee.txt`](shop-floor/wheel-limits-irimee.txt),
indexed as WHEEL_LIMITS). The wagon's checklist tab now has **Wheels — what
the gauge read**: eight wheels, the chalk figure typed once per wheel, judged
as it is typed and recorded with the verdict it earned; the two wheel
checklist items follow the readings the way the spring items follow the
spring measurements; and a wheel below the issue limit, a condemned flange,
or a set outside the variation rule holds the wagon at the gate by name.
Three verdicts, because the workshop has its own figure: a wheel at 912 mm is
legal on the line and may not leave a POH. The figures should be confirmed
against IRCA Part III before a release relies on them, and the screen says so.

## The shop as an environment

**Seen.** Bodies on trestles with the bogies out; the floor under them thick
with cut-off steel, plastic sheet, cotton waste and cable; motorcycles ridden
through the bay; light from roof panels that changes across the day; cranes
overhead; hand-painted Hindi notices.

**Confirms.** The offline-first design, the 44 px targets, the Hindi.

**Warns.**
- **Lighting is not constant** across the bay. The pocket-count protocol's
  "same lighting every shift" will need a lamp at the marked position, not
  the roof.
- **Backgrounds are cluttered.** The assembly frame should be taken tight on
  the side frame window; the counter counts what is in the frame, and a
  spring lying on the floor behind the bogie is in the frame.
- **Tablets will be handled in cotton waste and grease.** A case with a
  strap, and the sorting screen's one-tap strip, are the right shape; the
  drop-down-heavy screens (checklist configuration, user accounts) are office
  screens and should stay on the PC.
- **The audit trail is chalk.** Wheel sizes, adjuster numbers, band rings —
  the shop already records on the object. The app's job is to make the same
  record survive the wash and the wagon leaving; it should never ask for a
  number the inspector has not already written somewhere.

## Not changed by the visit

The G-95 band tables, the exit-gate rules, the certificate and passport, the
shadow-run forms. Nothing seen contradicts them. The four things still
unproven (camera on real springs, pocket model, bearing detector, shadow-run
verdict) are unchanged: they need the floor's data, and the visit produced
photographs of the floor, not of springs under the sorting camera.

## Addendum, 18 Sep 2026 — the wheel limits against the manual

The Wagon Maintenance Manual, Chapter 6 §D, carries the wheel table (RDSO
Drg. WD-88089/S-1) and agrees with the IRIMEE figures on every diameter,
the same-axle variation, the 60 mm flat, the 16 mm thin flange and the 5 mm
sharp flange. One correction: the 25 t CASNUB 22NLC wheel is condemned at
950 mm and last-shop-issued at 963 mm (the IRIMEE bogie table printed only
"955 minimum"). Still resting on IRIMEE, because the manual sends them to
IRCA Part III cl. 2.8.14.2: deep flange 35, root radius 13, hollow tyre 5,
and the 13 / 25 mm variation within a bogie / a wagon. On the next visit:
photograph the wheel shop's IRCA page for those four.

## Addendum, 18 Sep 2026 — the documents, read against the code

Pratik found the RDSO documents online — IRCA Part III (2020 edition), G-95
(1997 and a 124-page Revision-2 text), G-112, G-81, the air-brake handbook,
02-ABR-02, WMM Vol-II — and photographed the shop's own printed copy of
G-95 Revision-II (135 pages, received on the visit, stamped 10.04.2026).

- **The band tables are exactly right, and the shop's printed copy is the
  authority.** Its pages 107–108 print Tables 28–33 with six bands for an
  in-service spring — Blue 263–260 on top — and three for a new one; every
  one of the 81 cells matches `shared/classification/tables.ts`. The 124-page
  Revision-2 text found online is a different draft (five bands, Tables
  27–32, top band "Above 257"); for half a day the code was changed to
  match it, and reverted when the shop's copy was photographed. **The
  document the shop holds governs, not the one the internet holds.**
- **IRCA Part III Rule 2.8.9.2** gives the diameter variation: 0.5 mm on an
  axle, **13 mm within a bogie, 25 mm within a wagon** for four-wheeled
  bogies — and **5 / 13 mm for BLC**, which the IRIMEE notes did not carry.
  Note 4: the same-axle figure applies only at turning; in service the tyre
  defect gauge governs. Corrected in the code.
- **IRCA Plate 52** (the tyre defect gauge drawing, Rule 3.3.5 / S 4.19.1)
  carries the last four figures: deep flange 35, thin flange 16, sharp flange
  5 R, root radius 13 R, flat 60 for BG wagons (note 4). Every wheel figure
  on the screen now has a rule number; only the hollow-tyre depth still rests
  on the IRIMEE notes.
