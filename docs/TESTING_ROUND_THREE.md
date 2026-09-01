# Testing, round three

What changed since your last session, and how to check each of it. Roughly
forty minutes if you do all of it.

Everything below has been driven in a browser here already. The point of you
doing it is that a real person on a real screen finds things a script never
does — the last two rounds proved that twice over.

---

## Before you start

```bash
cd ~/Desktop/WRS_Raipur
nvm use 22
npm run dev
```

Then open http://localhost:5173.

The four logins are unchanged: `inspector1`, `supervisor1`, `admin1`, `drm1`,
all with `password123`. Those exist in development only now — a production
build refuses to create them, which is one of the things this round fixed.

---

## 1. The two things that were still broken last time

**1.1 — The tab inside a wagon survives a refresh.**
Sign in as `supervisor1` → Wagons Pipeline → open any wagon → click
**Timeline & Dwell Times** → press F5.

You should come back on Timeline, not on the checklist. That is the one you
reported twice; I had remembered the screen and the wagon but not the tab
inside the wagon.

**1.2 — History & Logs is no longer only springs.**
Sign in as `drm1` → **History & Logs** → click **Everything else**.

You should see sign-ins, wagon registrations, stage moves, checklist entries —
each with the person, their employee ID, the time, and the address they came
from. Try the filters: pick **Supervisors**, then pick **Signed in**. Click any
row to open everything recorded for that action.

---

## 2. Where each role lands

Sign in as each of the four and note the first screen:

| Login | Should open on |
|---|---|
| `inspector1` | their own task screen |
| `supervisor1` | Wagons Pipeline — that is their work |
| `admin1` | DRM Dashboard |
| `drm1` | DRM Dashboard |

The DRM used to land on the wagons pipeline and have to go and find the
dashboard named after them.

---

## 3. The gauge — new, and the biggest change

**3.1 — Naming the instrument.**
Sign in as `inspector1` → Springs → **Spring Sorting**.

Below the colour bands there is now a **Gauge** row. SSG-02 should already be
selected, with an amber line: *"No calibration date is recorded for this
gauge."* That is not a bug — it is what the label on your actual gauge says.

Sort a spring. Then check it stuck: the gauge stays selected for the rest of
the session and across a refresh.

**3.2 — What an unverified gauge does and does not do.**
Confirm it does **not** stop you sorting. It should never block the work; it
only records the fact.

**3.3 — Recording a real calibration.**
Sign in as `admin1` → **User Accounts** → scroll to **Gauge register**.

You will see SSG-02 marked NOT RECORDED, and a line saying how many recorded
springs were judged on an instrument whose calibration is not established.

Click **Record calibration**, put in a date and an expiry, save. The gauge
should flip to IN CALIBRATION.

**Now the important bit:** the count of affected springs should **not** drop.
Readings already taken keep the calibration state they had at the time.
Calibrating the gauge today must not retrospectively make last week's readings
look verified. If that number falls, something is wrong — tell me.

**3.4 — The officer's view.**
Sign in as `drm1`. If any springs were judged on an unverified instrument, a
panel says so near the top of the dashboard. It stays silent when everything
is in order, on purpose.

---

## 4. Condemning a spring now asks why

Sign in as `inspector1` → Spring Sorting.

The red button now says **Condemn this spring** rather than "Off the strip".
Tap it. You should get: Off the strip (height), Crack, Corrosion, Deformation,
Something else.

Tap **Crack**. The spring is condemned and the record says it was a crack, not
a height failure. That distinction was wrong before: a spring that measured
perfectly and was thrown out for a crack went into the record as off the strip.

Check a pass is still **one tap** — that matters at your volume. Only a
condemnation costs the second tap.

**Also check the undo message.** Tap a band, then **Undo last spring**. It
should name what it took back: *"Took back GREEN · Band II · 258.5 mm."*

---

## 5. The acoustic tool — read this one carefully

Sign in as `supervisor1` → open a wagon → the **Acoustic** tab.

**5.1 — Air leak.** Press *Simulate Air Leak Hiss*. It should detect an air
leak and show a frequency near 6,500 Hz. That number is now **measured**, so it
will vary a little each time. If it were fake it would be identical every run.

**5.2 — Bearing knock.** Press *Simulate Bearing Knock*. It will say
**"Nothing detected in this recording"**.

That is not a bug, and it is the most useful thing in this round. The bearing
detector genuinely does not fire on a bearing signal — it wants a crest factor
above 3.8 and gets 2.31. That was invisible before, because the screen used to
report the answer it had been handed rather than measuring anything.

I have deliberately not adjusted the threshold to make it pass. Tuning a
detector until it agrees with a test signal I wrote proves nothing. It needs a
recording of a genuinely defective CTRB from your floor.

**5.3** — Confirm the screen no longer says "CLEAR / NOMINAL — Zero Acoustic
Anomalies". It should say what it listened for and state that bearing detection
is unvalidated. It should not show a confidence percentage when nothing was
detected.

---

## 6. The authenticator

Sign in as `supervisor1`. Next to your name in the header there is a shield.
Click it — the authenticator setup should open.

Before this round only an administrator could reach that screen, which meant
the one role that signs wagons onto the line could not set up a second factor
at all.

You do not have to enrol. If you do, that person's authenticator becomes
mandatory for gate sign-off from then on, so decide before you scan.

---

## 7. Security — four checks with curl

Run these with the server up. Each should refuse.

```bash
# The whole inspection record, with no login at all. Must be 401.
curl -s -o /dev/null -w "%{http_code}\n" \
  "localhost:3000/api/inspections/export?format=csv"

# Named inspector performance data, no login. Must be 401.
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/analytics/inspectors

# The wagon list, no login. Must be 401.
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/wagons

# The activity ledger as an inspector. Must be 403.
TOK=$(curl -s -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"inspector1","password":"password123"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/audit/activity \
  -H "Authorization: Bearer $TOK"
```

Expected: `401`, `401`, `401`, `403`.

Until this round the first one returned the entire inspection record — every
wagon number, height, verdict, inspector name and audit hash — as a CSV to
anyone who asked, with no account.

---

## 8. Offline — still the least tested part

This is the one area nothing has properly exercised, and it is where losing
work would actually hurt. Worth a deliberate twenty minutes.

1. Sign in as `inspector1`, open Spring Sorting.
2. Turn off wifi.
3. Sort **twelve** springs. Note the count and the bands as you go — write
   them on paper, because the point is to compare afterwards.
4. Condemn one of them for a crack.
5. Close the browser tab entirely.
6. Reopen it, still offline. The pending count should still be there.
7. Turn wifi back on. Watch them drain.
8. Sign in as `drm1` → History & Logs → Everything else.

**What to check:** all twelve arrive, exactly once each, with the right bands,
and the condemned one still says crack. None duplicated, none missing.

If any number disagrees with your paper note, that is the most important bug
you can find and I want to know immediately.

**This drill already found two.** Running it here, twelve springs sorted
offline sat at "12 pending" through a reconnect and never sent. Two separate
faults stacked on each other: the drain asked "is anything pending for *this*
batch" while the batch id was minted fresh on every page load, so a reload
orphaned the previous session's work — and underneath that, the drain only
ran while the Spring Sorting screen was open, so coming back into signal on
any other screen never tried at all. Both fixed; the drill now ends at zero
pending with exactly twelve records and no duplicates.

There is a scripted version of this at `scripts/offline-drill.mjs` if you want
it run automatically rather than by hand.

---

## What I still need from the floor

Not blocking a demo, but each one unblocks real work:

- **Does SSG-02 give the band, or does the banded reading come off the coloured
  strip?** If they are two instruments, the register should hold both and the
  app should know which produced which reading.
- **The other gauges.** SSG-02 implies at least an SSG-01. A photograph of each
  label and they all go in the register.
- **Is there a calibration certificate on file** with real dates, even though
  the label is blank? Certificate 1251122-04-125 exists somewhere.
- **What "repair" means for a spring** in your process — evidence of a previous
  repair spotted visually, or something else.
- **The gauge post dimensions and what the red band marks.**
- **Twenty photographs of springs against the gauge.** These are the input to
  reading the band automatically, which is the real labour reduction.
- **A recording of a genuinely defective CTRB**, for the bearing detector.
- **BFKN spring counts, and whether BRN carries twelve or fourteen outers.**
