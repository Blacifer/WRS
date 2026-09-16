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
