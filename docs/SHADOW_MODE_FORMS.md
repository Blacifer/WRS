# Shadow Mode — Discrepancy Log & Daily Summary

`SHADOW_MODE_ROLLOUT.md` asks for the discipline of cross-checking the app
against the existing paper process. These are the two forms that discipline
needs. Print them, or keep them as a shared sheet — either works, the point is
that disagreements get written down at the moment they happen rather than
remembered at the end of the shift.

Shadow mode means the app and the register run side by side and the **register
still governs**. Nothing the app says releases a wagon during this period.

---

## Form 1 — Discrepancy Log

One line per disagreement. Fill it in when the app and the inspector reach
different answers, or when the app cannot answer at all.

| # | Date | Shift | Inspector | Wagon | Bogie / position / spring no. | Register says | App says | Who was right | Why they differed | Reported by |
|---|------|-------|-----------|-------|-------------------------------|---------------|----------|---------------|-------------------|-------------|
| 1 |      |       |           |       |                               |               |          |               |                   |             |
| 2 |      |       |           |       |                               |               |          |               |                   |             |
| 3 |      |       |           |       |                               |               |          |               |                   |             |

**"Who was right" is the important column.** The app being wrong is a defect to
fix. The app being right is the case for using it. Both need recording, and a
log that only captures the app's failures will quietly argue against itself.

Categories to use in "Why they differed" — these are the ones that actually
occur with band-first entry:

- **Band misread** — the strip was read as one band, recorded as another.
- **Wrong spring** — the reading was entered against a different spring than
  the one in hand (queue position lost, or interrupted mid-nest).
- **Off-strip judgement** — disagreement about whether a spring was condemnable.
- **Configuration** — the wagon's actual spring count differed from what the
  app expected (this is the one to watch on RFT bogies, where no published
  count exists).
- **Nest grouping** — the app flagged a nest as mismatched and the fitter
  disagreed, or vice versa.
- **App could not answer** — a component with no approved limit, an
  unindexed manual query, a feature that failed.
- **Device** — camera, microphone, network, battery, glare.

---

## Form 2 — Daily Summary

One per shift, filled in by the supervisor at the end.

**Date:** ____________  **Shift:** ____________  **Supervisor:** ____________

| Measure | Count |
|---|---|
| Wagons swept in the app | |
| Springs recorded | |
| Springs condemned | |
| Nests flagged as mismatched | |
| Discrepancies logged today | |
| …of those, the app was wrong | |
| …of those, the register was wrong | |

**Time comparison** — take one wagon and time it both ways:

| | Minutes |
|---|---|
| Register, one wagon, all springs | |
| App, one wagon, all springs | |

**Three questions, answered in a sentence each:**

1. What did the app get wrong today?
2. What did the app catch that the register would have missed?
3. What slowed anyone down?

**Anything that would have stopped a wagon leaving, and did not:**

_______________________________________________________________

---

## Reading the log after a week

The decision to trust the app is not a feeling, it is these numbers. Before
moving out of shadow mode, expect to see:

- Discrepancies falling week on week, with the residue explained rather than
  unexplained.
- **Zero cases where the app passed a spring the register condemned.** This is
  the only category that is not negotiable — the app being over-cautious is an
  annoyance, the app being under-cautious is the thing that must never happen.
- Every "app could not answer" case either fixed or written down as a known
  limitation someone has accepted.

Keep the completed logs. When CRIS or an RDSO reviewer asks how the system was
validated, this is the answer, and it is a much better one than a test suite.
