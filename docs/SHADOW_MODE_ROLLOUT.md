# Shadow-Mode Rollout Plan — WRS Raipur

## What "shadow mode" means here

For the first stretch of live use, inspectors run the app **alongside** the existing paper process, not instead of it. Every spring and every wagon still gets its normal manual record. The app's readings and verdicts are cross-checked against that paper record by a supervisor before anyone treats the app as the system of record.

This is not a statement of distrust in the software — it's the standard way to introduce any new tool into a safety-relevant workflow, so that a data-entry mistake, a misread caliper photo, or an edge case in the RDSO logic gets caught by a human before it affects a real release decision, and so problems get found on paper wagons, not on running trains.

## Duration

**Recommended: 5 working days**, or until at least 3 full shifts and ~500 spring readings have gone through both paths with no discrepancies flagged. Extend if discrepancies keep turning up; don't shorten it just because day 1 looks clean — the point is to sample enough real variation (different inspectors, different caliper conditions, different wagon types) to trust the pattern, not just the first few readings.

## Day-by-day

**Day 0 (before go-live):**
- Real inspector/supervisor/admin accounts created (see Step 3 of the rollout plan), demo accounts deactivated.
- One supervisor designated as the shadow-mode reviewer for the week.
- Quick-start handed to every inspector who'll touch the app (see `QUICK_START.md`).

**Days 1–5:**
- Inspectors log every spring/wagon in the app exactly as they would on paper, in parallel.
- At the end of each shift, the designated supervisor pulls up the app's inspection history and diffs it against the paper log for that shift:
  - Every measured height matches (or the discrepancy is explained — e.g. re-measurement).
  - Every PASS/CONDEMNED verdict matches the paper record's band.
  - No spring or wagon appears on paper but not in the app, or vice versa.
- Any discrepancy gets written down (what, why, which inspector/spring/wagon) — not just quietly corrected. Patterns matter more than one-offs.

**End of week:**
- Supervisor + DRM review the discrepancy log together.
- Decide: clean enough to drop the paper parallel-run, extend shadow mode, or fix something first.

## The app's own check, and why it does not replace this

Since the last revision the sorting screen raises an amber **"Worth a second look"** box when a reading does not resemble others of its kind — chiefly a transposed digit, 260.5 entered as 206.5. It is advisory: the spring is recorded, the RDSO verdict stands, and the inspector answers whether the reading changed on re-measurement.

Two things follow for this week.

**It does not shorten shadow mode.** The check compares a reading against other readings; the paper diff compares it against the spring. Only the second can catch a reading that is wrong in a way that looks perfectly ordinary — the failure mode that matters most, and the one no statistic can see.

**It gives the week a second output.** Alongside the discrepancy log, the reviewer should note, each day:

- how many springs raised the box at all;
- of those, how many the inspector answered **Re-measured — it was wrong** (the check earning its place);
- how many were answered **The reading stands** (a false alarm);
- and how many were **not answered at all**.

That last figure is the important one. An advisory nobody answers is an advisory nobody reads, and if it is high the box is either appearing too often or in the wrong place — a finding about the app, not about the inspectors.

Inspectors should be told plainly, in the day-0 briefing, that answering "the reading stands" is wanted and is not a complaint about them. It is the only evidence that can ever justify making the check less talkative.

## What counts as a blocking discrepancy (extend shadow mode, don't go live)

- Any case where the app said PASS and the paper record (or a re-measurement) says CONDEMNED, or vice versa — a real classification disagreement, not just a rounding difference.
- Any wagon where the exit-gate let something through that the paper checklist would have caught, or blocked something that paper would have passed.
- Any audit-log gap — an inspection that happened but didn't get recorded, or got recorded against the wrong wagon/inspector.
- Any transcription error the paper diff caught that the app's amber check **did not** raise. One is expected and is not a blocker on its own — the check was never meant to catch everything — but a pattern of them means the threshold is set too loose and should be looked at before the paper parallel-run is dropped.

## What doesn't block, but should still get logged

- OCR misreads that the inspector caught and corrected via manual entry (expected — this is what the manual fallback is for; frequency worth tracking to judge lighting/caliper conditions).
- Minor UI confusion or workflow friction — feed this into the quick-start doc and inspector training, not a go/no-go blocker.

---

## The forms

The discrepancy log and daily summary this document asks for are in
[SHADOW_MODE_FORMS.md](SHADOW_MODE_FORMS.md), along with how to read them at
the end of the first week.
