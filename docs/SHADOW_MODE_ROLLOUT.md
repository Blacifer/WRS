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

## What counts as a blocking discrepancy (extend shadow mode, don't go live)

- Any case where the app said PASS and the paper record (or a re-measurement) says CONDEMNED, or vice versa — a real classification disagreement, not just a rounding difference.
- Any wagon where the exit-gate let something through that the paper checklist would have caught, or blocked something that paper would have passed.
- Any audit-log gap — an inspection that happened but didn't get recorded, or got recorded against the wrong wagon/inspector.

## What doesn't block, but should still get logged

- OCR misreads that the inspector caught and corrected via manual entry (expected — this is what the manual fallback is for; frequency worth tracking to judge lighting/caliper conditions).
- Minor UI confusion or workflow friction — feed this into the quick-start doc and inspector training, not a go/no-go blocker.
