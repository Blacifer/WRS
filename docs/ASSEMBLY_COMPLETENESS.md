# Bogie Assembly Completeness — scope for a visual check

## What this is for

A wagon leaves the shop and something happens on the road. The question that
follows is whether a part was missing when it left. Today the answer rests on a
checklist item somebody ticked. This document scopes the one visual check that
could answer it with a photograph instead — **were all the spring pockets
occupied when the bogie was closed up** — and, just as importantly, fixes the
boundaries it must not cross.

It is a scope, not a plan of work in progress. Nothing here is built. The first
code change is named at the end and needs its own go-ahead.

## Why this check and not a visual verdict

The system already refuses to judge a spring from a photograph, and the reason
is in [`wagonNumberOcr.ts`](../client/src/services/wagonNumberOcr.ts): an image
carries no scale, so free height cannot be recovered from it. Every G-95 verdict
is free height against a table, so no camera can produce one.

Occupancy is a different question in kind. "Is there a spring in this pocket"
needs no datum plane, no reference dimension, and no perspective correction — it
survives the lens distortion and the variable angle that make dimensional work
impossible on a shop floor. It is the one thing in this domain a photograph can
honestly settle.

The distinction is the same one [`zapheit.ts`](../server/src/ai/zapheit.ts)
already draws: **the model finds, the manual states**. Occupancy is finding.

## The count never comes from the model

This is the rule that matters most, and it is easy to get wrong.

The expected number of springs is a property of the **wagon designation**, not
of the bogie, and it is already held — twice, from two independent RDSO sources
that agree — in
[`WAGON_SPRING_CONFIGS`](../shared/classification/wagonTypes.ts). Per bogie:

| Designation | Bogie | Outer | Inner | Snubber |
|---|---|---|---|---|
| BOXN | CASNUB 22 NLB | 12 | 8 | 4 |
| BOXN M1 | CASNUB 22 NLB (Mod) | 14 | 10 | 4 |
| BOXNHS | CASNUB 22 HS | 14 | 12 | 4 |
| BOXNHL | CASNUB 22 HS | 14 | 14 | 4 |
| BOSTHS | CASNUB 22 HS (Mod-I) | 12 | 12 | 4 |
| BOSTHS M2 | CASNUB 22 HS (Mod-II) | 12 | 12 | 4 |
| BOXNS | LWLH25 | 12 | 12 | 8 |

Note what this table shows: there is no such thing as "the CASNUB 22 NLB spring
count". BOXN and BOXN M1 run the same bogie family and differ by four springs.
BOXNS is the only Raipur type with eight snubbers. Any figure written by hand
into a model config, a training label, or a spec paragraph will be wrong for
some wagon that comes through the shop, and wrong in a way nobody notices until
it clears a bogie it should have questioned.

So: the model reports **how many it can see**. `springsPerBogie()` reports how
many there should be. The comparison happens in deterministic code that reads
the registry, exactly as the existing gate does.

## It may raise a question. It may never clear one.

A counting model has two failure directions and they are not symmetric.

Counting **too few** raises a false alarm. An inspector looks, sees the spring,
and moves on. Cost: a few seconds, and some erosion of trust if it happens
often.

Counting **too many** — or counting right when a pocket is actually empty —
certifies a bogie that is short a spring. That is the exact failure this whole
system exists to make impossible, and a model that can produce it must never be
positioned where its silence means "pass".

Therefore the check is **advisory only**, and it is built the way
[`measurementAnomaly.ts`](../shared/analysis/measurementAnomaly.ts) is built:

- It never changes a verdict and never blocks a save.
- A count that matches produces **nothing**. No green tick, no "verified", no
  record that the bogie was visually confirmed. Silence from a model is not
  evidence, and a green tick would be read as one.
- A count that falls short raises an advisory naming the position, which the
  supervisor must acknowledge by name at sign-off — the mechanism already in
  `evaluateExitGate()` in
  [`wagonRepository.ts`](../server/src/db/wagonRepository.ts#L1107).
- The photograph is stored as evidence either way. **The photograph is the
  proof; the model is only what draws attention to it.** If the model is
  removed tomorrow, the evidence trail is unchanged.

That last point is the honest framing of the original goal. What answers "was a
part missing when it left" is a timestamped, hash-chained photograph of the
assembled bogie, taken to a repeatable protocol. That is worth building whether
or not a model is ever trained on it.

## Capture protocol comes before any model

Fixed camera geometry will do more for accuracy than any architecture choice,
and unlike a model it can be set up this month.

What the shop needs to fix:

- **One position per bogie side**, marked on the floor, so every photograph
  frames the same pockets at roughly the same scale and angle.
- **Photograph after spring placement, before the bogie frame is lowered** —
  the only moment when every pocket is simultaneously visible.
- **Both sides, always.** One frame cannot show all pockets on any CASNUB.
- **Lighting that does not change between shifts.** A pocket in shadow and an
  empty pocket look alike, which is the permissive failure again.
- **The wagon designation recorded with the frame**, because it determines the
  expected count and nothing in the image does.

This protocol is the deliverable of the first phase. It produces a labelled
dataset as a side effect of doing the useful thing anyway.

## Data volume: what 70 photographs actually is

Seventy photographs is not a training set. It is not close to one.

For pocket occupancy the useful unit is not the photograph but the **pocket**,
and the rare class is **empty**. In normal operation nearly every pocket is
occupied, so a set gathered by photographing correct assemblies teaches a model
that everything is fine — it will score extremely well and never fire.

Rough shape of what is needed, to be revised once real captures exist:

- **A few hundred bogies** photographed to the protocol, both sides.
- **Deliberate negatives.** Empty pockets staged during assembly, photographed,
  and labelled — because waiting for genuine misassemblies to accumulate means
  waiting for the failures this is meant to prevent.
- **Class balance tracked, not just volume.** The existing
  `GET /api/photos/dataset/defects` in
  [`photos.ts`](../server/src/routes/photos.ts) already reports `labelCounts`
  alongside `totalSamples` for exactly this reason, and its readiness thresholds
  (200 for a baseline, 1000 to attempt a classifier) are the right order of
  magnitude here too.

Before any model, a trivial baseline should be run and published: how often does
"assume every pocket is full" get the right answer? If that number is 99%, any
model must be measured against 99%, not against zero.

## Phasing

**Phase 0 — protocol and collection.** Fix the capture positions. Add an
assembly-stage capture that records wagon designation and bogie side, tagged so
the dataset endpoint can find it. No model, no inference, no advisory. Useful on
day one: it is the photographic proof the original goal asked for.

**Phase 1 — baseline and evaluation.** Once several hundred bogies are on
record, publish the always-full baseline and hand-label a held-out set. Decide
on evidence whether a model can beat the baseline by enough to be worth its
failure modes. **This phase may legitimately end in "no".**

**Phase 2 — model, only if Phase 1 earns it.** Occupancy per pocket, advisory
only, wired to the existing acknowledge-by-name path. Runs where the existing
detector runs — in the browser, weights served by this application, no CDN, per
commit `ae1d7ee`.

## Where it attaches to what exists

Nothing here needs new infrastructure:

- Storage and immutability: `wagon_photos` with its append-only triggers, and
  `evidence_stage` already distinguishes what a photograph is evidence of.
- Dataset export and readiness reporting: `GET /api/photos/dataset/defects`,
  which would gain a sibling rather than be modified.
- Expected counts: `springsPerBogie()` / `springsPerWagon()`.
- Advisory surfacing and acknowledgement: `evaluateExitGate()`.
- Person and clutter exclusion from the stored frame:
  [`objectDetection.ts`](../client/src/services/objectDetection.ts), which
  already crops people out of evidence photographs.

## The first code change

Phase 0 only: an assembly-stage capture path that stores a bogie photograph
tagged with wagon designation and bogie side, plus a dataset sibling endpoint
that reports what has accumulated. It adds no verdict, no advisory and no model,
and it is independently useful if Phases 1 and 2 never happen.

It is not started. It needs its own approval.
