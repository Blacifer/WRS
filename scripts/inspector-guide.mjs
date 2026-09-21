#!/usr/bin/env node
/**
 * The inspector's walkthrough as a page: every step of section 2 with the
 * phone screenshot the machine took, the exact taps, what must be on the
 * screen, what the machine saw (from scripts/inspector-walk.mjs's
 * result.json) and what to do when it is not there.
 *
 *   node scripts/inspector-walk.mjs            # the walk, → docs/artifacts/inspector-walk/
 *   node scripts/inspector-guide.mjs           # this page, → docs/artifacts/inspector-guide/index.html
 *
 * The words a person reads here are written by hand below; the evidence is
 * the machine's and is never edited.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const WALK = 'docs/artifacts/inspector-walk';
const OUT = 'docs/artifacts/inspector-guide';
mkdirSync(`${OUT}/shots`, { recursive: true });
const result = JSON.parse(readFileSync(`${WALK}/result.json`, 'utf8'));

// Lighter copies of the screenshots for the page (full-page PNGs run to 1 MB each).
for (const s of result.steps) for (const f of s.shots) {
  const jpg = `${OUT}/shots/${f.replace(/\.png$/, '.jpg')}`;
  if (!existsSync(jpg)) execSync(`sips -Z 1600 --setProperty format jpeg --setProperty formatOptions 70 "${WALK}/${f}" --out "${jpg}"`, { stdio: 'ignore' });
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const when = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const day = new Date(result.startedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

/*
 * The guide, by hand. `do` is the taps in order; `see` is what must be on the
 * screen; `why` is what the step proves to the room; `ifNot` is the fault to
 * suspect. Keep every button name exactly as the screen prints it.
 */
const GUIDE = {
  '2.1': { title: 'The inspector\'s home screen', group: 'bench',
    do: ['Sign in as <b>inspector1</b> / password123.', 'Stay on the first screen — do not tap anything yet.'],
    see: ['Two large cards under <em>What are you working on today?</em>: <b>Springs</b> and <b>A wagon</b>.', 'Under them, <b>Your record today</b>: how many springs, how many passed, the band tallies and the newest few with a time each.', 'A green <b>Online</b> dot and <em>Nothing waiting to send</em>.'],
    why: 'The first person to use this screen asked for two things: to see at once whether they are on springs or a wagon, and to see what they have logged. Both are here before a single tap.',
    ifNot: ['No <b>Your record today</b> box: the phone is not reaching the server — check the address and that the certificate was installed (section 1.4).', 'A red <b>Offline</b> dot: Wi‑Fi is off, or the phone has switched to mobile data — turn mobile data off.'] },
  '2.2': { title: 'The sorting bench', group: 'bench',
    do: ['Tap <b>Sorting</b> in the bar (or the <b>Springs</b> card, then <b>Sort springs</b>).'],
    see: ['<b>Bogie type</b> CASNUB 22 NLB, <b>Condition</b> Used (6 bands), <b>Spring position</b> Outer.', 'The strip: six coloured buttons — <span class="band blue">Blue I 263–260</span> <span class="band green">Green II 260–257</span> <span class="band yellow">Yellow III 257–254</span> <span class="band orange">Orange IV 254–251</span> <span class="band white">White V 251–248</span> <span class="band red">Red VI 248–245</span> mm.', 'Below the strip a red <b>Condemn this spring</b> bar and the <b>Gauge</b> picker.'],
    why: 'These are the six bands of the shop\'s own G‑95 Rev‑II (Tables 28–33), not a five-band draft from the internet. The Roman numerals and heights should match the strip on the bench exactly.',
    ifNot: ['Three buttons, not six: <b>Condition</b> is on New — set it to Used.', 'No strip at all, a height box instead: <b>Bogie type</b> is on LWLH25 or LCCF20 (see 2.8).'] },
  '2.3': { title: 'Three springs by the band', group: 'bench',
    do: ['Tap <b>Green</b>, then <b>Yellow</b>, then <b>Blue</b>, a second apart.'],
    see: ['<em>This session:</em> rises 1 → 2 → 3, <em>Passed: 3</em>, and <em>Last:</em> names the band just tapped.', 'A short chime on each tap.', 'In <b>Your record today</b> under the strip: the three new lines at the top, newest first — Blue, then Yellow, then Green — each with the time, ≈height, position, bogie and gauge.'],
    why: 'One tap per spring is the whole bench workflow. At 700 springs a shift nothing else is fast enough, and the record under the strip is how an inspector proves their own count at the end of the day.',
    ifNot: ['The count rises but the record does not change: the record box is fetched from the server after each tap — if the phone is offline it says so and fills in when the network returns (see 2.20).'] },
  '2.4': { title: 'Undo the last tap', group: 'bench',
    do: ['Tap <b>↩ Undo last spring</b> (right, under the strip).'],
    see: ['<em>This session</em> drops by one.', 'A line names what was taken back: <em>Took back BLUE · Band I · 261.5 mm. 2 left in this session.</em>', 'The line disappears from <b>Your record today</b>.'],
    why: 'A wrong tap is a certainty at bench speed, so the undo is one tap and says exactly what it undid. The record keeps a "taken back" mark internally — nothing is silently deleted.',
    ifNot: ['<b>Undo last spring</b> greyed out: the session is empty, or the last tap is still sending — wait a second.'] },
  '2.5': { title: 'Which gauge — and one with no calibration date', group: 'bench',
    do: ['Open the <b>Gauge</b> picker and read the list.', 'Set <b>Spring position</b> to Snubber.', 'Pick <b>SSG‑02</b> in the gauge picker.'],
    see: ['The gauges are named: <b>ISG‑01</b>, <b>OSG‑01</b>, <b>OSG‑02</b>, <b>SSG‑02</b>, each with what it measures.', 'On SSG‑02 an amber note: <em>No calibration date is recorded for this gauge. Readings will be marked accordingly.</em>'],
    why: 'Every reading carries the gauge it was made with, so a drifting gauge can be found later (the admin sees this on the gauge register). An uncalibrated gauge does not stop work — it marks the readings.',
    ifNot: ['No amber note on SSG‑02: the gauge register has a date for it — the admin can check under Gauges; the demo seed leaves it blank on purpose.', 'Set <b>Spring position</b> back to <b>Outer</b> before the next step.'] },
  '2.6': { title: 'Condemn a spring on sight', group: 'bench',
    do: ['Tap the red <b>Condemn this spring</b> bar.', 'Read the panel, tap <b>Back</b> — nothing is recorded.', 'Tap <b>Condemn this spring</b> again, then tap <b>Crack</b>.'],
    see: ['The panel asks <em>What did you see?</em> with <b>Off the strip (height)</b>, <b>Crack</b>, <b>Corrosion</b>, <b>Deformation</b>, <b>Something else</b> and <b>Back</b>.', 'An amber note says that for a crack, corrosion or deformation the photograph is the evidence — switch on photographing (2.7).', 'The tap on <b>Crack</b> records it: <em>Condemned: 1</em>, a low buzz, and in <b>Your record today</b> a red line — <b>Condemned Crack · outer · 22 NLB · OSG‑01</b>.', 'No question about re‑measuring — nothing was measured.'],
    why: 'The reason is the record. A spring condemned for a crack must never be filed as "200 mm" — the record shows the word, not an invented height.',
    ifNot: ['The record line shows a height instead of the reason, or a yellow <em>Worth a second look</em> panel appears asking you to re-measure: the phone is showing an old build — pull down to reload the page once.'] },
  '2.7': { title: 'Photographing while sorting', group: 'bench',
    do: ['Tick <b>Photograph springs while sorting</b>.', 'Put a spring in front of the camera and tap its band.', 'Put your hand in front of the lens and watch the badge.'],
    see: ['The live camera opens directly under the tick box, large (not a thumbnail), with a green <b>Photographing</b> badge.', 'Each band tap saves a frame against the spring — no extra taps.', 'A hand in front → <em>person excluded</em>. It never says "spring 98 %".', '<b>Teach the camera (advanced)</b> stays folded — it is not part of the day\'s work.'],
    why: 'The camera records evidence; it does not decide. The photograph is what a supervisor opens months later to see the crack that condemned the spring.',
    ifNot: ['No camera, a grey box: the browser has no camera permission or the page is on plain http — the address must start with <b>https://</b> and the certificate must be installed (section 1.4).', 'The camera opens somewhere else on the page: reload once.'],
    byHandNote: 'The machine ran this with a fake camera: it proved the camera opens where it should, large, with the badge. The spring and the hand are yours.' },
  '2.8': { title: 'A bogie with no band table', group: 'bench',
    do: ['Untick photographing.', 'Set <b>Bogie type</b> to <b>LWLH25 (BOXNS)</b>.', 'Then set it back to <b>CASNUB 22 NLB</b>.'],
    see: ['The six-button strip disappears; a single <em>Free height — how many mm?</em> box appears.', 'A note: <em>No band table is published for this bogie — serviceable / condemn only. WMM 2.0 §309C</em>.', 'The snubber position splits into Snubber outer / inner (G‑112 Table 26).'],
    why: 'Where the standard publishes no bands, the app refuses to invent them. LWLH25 springs are judged serviceable or condemned against §309C, by a typed height.',
    ifNot: ['A six-button strip on LWLH25: that would be an invented table — report it at once.'] },
  '2.9': { title: 'The bench in Hindi', group: 'bench',
    do: ['Tap <b>हिंदी</b> top right.', 'Look at the strip, then tap <b>EN</b> to come back.'],
    see: ['<b>स्प्रिंग छँटाई</b> as the title; the bands read <b>नीला · हरा · पीला · नारंगी · सफ़ेद · लाल</b> in the same colours, with BAND I–VI and the same millimetres.', 'The gauge names (OSG‑01 …) stay as printed on the gauges.'],
    why: 'Numbers and colours are the shared language of the bench; the words follow whoever is holding the phone.',
    ifNot: ['A line still in English inside a Hindi screen: note which one — it is a missing translation, not a fault in the record.'] },
  '2.10': { title: 'One spring, on a wagon — Single Spring', group: 'single',
    do: ['Tap <b>Single Spring</b> in the bar.', 'Note it first asks which wagon and bogie.', 'Scroll to the height box and type <b>258.5</b>, then <b>244</b>, then <b>263.1</b>, then try to type <b>abc</b>.'],
    see: ['258.5 → <b>Green</b>, Band II, <em>Table 28</em> cited.', '244 → <b>CONDEMNED</b> with the reason (below the condemning limit).', '263.1 → over height, condemned.', '"abc" cannot be typed at all — the box only takes a number; nothing crashes.'],
    why: 'The same tables as the bench, but tied to one wagon and bogie so the spring can be traced. Every verdict quotes its table.',
    ifNot: ['A verdict without a table reference: report it — a verdict must always say where it came from.'] },
  '2.11': { title: 'Choosing a wagon', group: 'wagon',
    do: ['Tap <b>Tasks / Home</b>, then the <b>A wagon</b> card.', 'Tap <b>All wagons</b>.', 'Type <b>WR/BCNHL/40112</b> in <em>Or enter the number</em> and tap <b>Select</b> (or pick it from the list).', 'Tap <b>Continue checklist</b>.'],
    see: ['The picker lists the wagons in the shop with their stage; WR/BCNHL/40112 is at <b>Reassembly</b> (stage 5 of 7 on the stage bar).', 'The wagon opens with its tabs: Checklist · Condition report · Release checks · Passport · Parts · Photos (4) · Timeline · Air‑brake test · Sound.'],
    why: 'One wagon is "active" on the phone until you switch; every photograph, reading and part event lands on it.',
    ifNot: ['"No such wagon": check the slashes — WR/BCNHL/40112, capital letters.', 'The picker shows a different set of wagons: the demo data was not seeded — run DEMO‑DATA.cmd (laptop) or <code>bash scripts/rehearsal.sh start</code> (Mac).'] },
  '2.12': { title: 'The checklist', group: 'wagon',
    do: ['Tap the <b>Checklist</b> tab.', 'Pick a category chip (Springs, Wheels & Axles, Bearings …).'],
    see: ['Each item has <b>Pass</b> / <b>Fail</b> / <b>Condemn</b>.', 'Condemning an item asks for a note; a mandatory item cannot be skipped.'],
    why: 'The eight CASNUB categories from the WMM, item by item, with the standard each item cites.',
    ifNot: ['Buttons greyed out: the wagon is already released, or you are signed in as a role that cannot inspect.'] },
  '2.13': { title: 'Photographs and the blind pocket count', group: 'wagon',
    do: ['Tap the <b>Photos (4)</b> tab.', 'Read the four <b>Pocket counts</b> lines.', 'Tap <b>Recount</b> on Bogie 2 · Side B and look at the counter, then close it.'],
    see: ['Four frames: Bogie 1 · Side A/B, Bogie 2 · Side A/B.', 'Bogie 1 · Side A: <b>7⁄7⁄2 and 7⁄7⁄2 — agree</b>.', 'Bogie 2 · Side B: <em>Counted by Praveen Singh — a blind recount by someone else is needed</em>, and <b>no figures</b>.', 'The counter never shows the expected number — you count what is in the photograph.'],
    why: 'A second person counts without seeing the first count. Only a supervisor sees "6 of 7 outer — one pocket may be empty". This is how a short bogie is caught before the exit gate, without anyone being led.',
    ifNot: ['The inspector\'s screen shows "6 of 7" or "short": that is a leak of the supervisor\'s view — report it.', 'The counter shows "expected 7": same — report it.'] },
  '2.14': { title: 'Parts in, parts out', group: 'wagon',
    do: ['Tap the <b>Parts</b> tab.', 'Read the balance line and open <b>Show every entry</b>.', 'Look at the form: <b>Came off · Went back on · Replaced with new · Scrapped · Not being refitted</b>, then Category, Position, Part, How many.'],
    see: ['The heading <b>Parts in, parts out</b> and a balance such as <em>40 off · 40 back on · 20 % of 41 expected positions covered</em>.', 'In the list: the springs off at Dismantling, one outer spring <b>Replaced with new — crack at the second coil, new from Stores</b>, the rest back on at Reassembly. No warning box about a position with more back on than came off.', 'Recording a part asks which position; Scrapped and Not being refitted ask for a reason.'],
    why: 'Months after the wagon has gone, this list answers "was anything missing" — with the person and the time against each entry.',
    ifNot: ['A red box saying the wagon has no parts record at all: the demo data on this server predates this build — re-seed (DEMO‑DATA.cmd / rehearsal.sh start).'] },
  '2.15': { title: 'The air-brake test proforma', group: 'wagon',
    do: ['Tap the <b>Air‑brake test</b> tab.', 'Type <b>3.2</b> in row 1 <em>Pressure in BP</em>, watch the box, then clear it.'],
    see: ['<b>Single Wagon Test (air brake)</b> — WMM 2.0 §720‑C — 14 rows: 12 readings with the specified range beside each, 2 yes/no rows (<b>As specified</b> / <b>Not</b>).', '3.2 against 4.9–5.1 turns the box red as you type.', 'The foot says how many rows are still blank; <b>Record test</b> refuses until every row is answered.'],
    why: 'The proforma the WMM requires after POH, with each limit beside the box so the person testing does not have to remember it.',
    ifNot: ['The <b>Not</b> button cut off at the right edge: an old build on the phone — reload once.'] },
  '2.16': { title: 'The wagon\'s timeline', group: 'wagon',
    do: ['Tap the <b>Timeline</b> tab.'],
    see: ['Every stage the wagon has passed, with the date and who moved it: Entry registration → Dismantling → Component inspection → Repair → Reassembly.'],
    why: 'Turnaround and "which stage is slow" on the DRM dashboard are computed from exactly these lines — nothing is estimated.',
    ifNot: [] },
  '2.17': { title: 'A wheel, from the chalk on the disc', group: 'wagon',
    do: ['Home → <b>Switch wagon</b> → <b>All wagons</b> → <b>SER/BOXNHL/30914</b> → Continue checklist.', 'On the Checklist tab scroll to the wheels (Axle 1 · bogie 1 … Axle 4 · bogie 2).', 'Tap <b>Axle 1 · Left</b>. Type <b>917</b>.'],
    see: ['One large box: <em>Tread diameter (mm) — the figure chalked on the disc</em>.', 'Under it, as you type: <b>below issue limit</b> — <em>Tread diameter 917 mm — last shop issue 919 mm, condemn 906 mm (WD‑97037‑S‑01 (WMM Ch.6, WD‑88089/S‑1))</em>.', 'Flange figures are folded under <em>Flange and tread figures, if the tyre defect gauge was used (optional)</em>.', 'Axle 3 already reads 917.5 / 917.8 in amber — this is the pair that blocks the wagon at the gate (section 3).'],
    why: 'The one number every wheel has is the chalked diameter; the rest is optional and stays out of the way. The limit and its drawing are quoted, never remembered.',
    ifNot: ['A row of six empty boxes with no verdict: an old build — reload.', 'Tap <b>Cancel</b> — do not record 917 on axle 1; the demo relies on axle 3 being the blocked pair.'] },
  '2.18': { title: 'Reading a wagon number with the camera', group: 'camera',
    do: ['Home → <b>Switch wagon</b> → <b>All wagons</b> → tap the camera icon <b>Read the number painted on the wagon</b>.', 'Point at any printed wagon number (a sheet of paper with <b>SER/BOXNHL/30914</b> in large letters is enough).'],
    see: ['The camera opens with a frame guide.', 'It proposes the text it read; you <b>confirm</b> or correct it. Nothing is recorded until you confirm.'],
    why: 'Eleven characters with gloves on, standing at the wagon, is exactly what a camera is for — but the person, not the camera, commits the number.',
    ifNot: ['Reads nothing after ten seconds: more light, closer, hold still; typing the number is always there beneath.'],
    byHandNote: 'The machine proved the camera opens and the confirm-or-correct wording is there; it had no painted number to read.' },
  '2.19': { title: 'Ask the Manual', group: 'camera',
    do: ['Tap <b>Manual</b> in the bar.', 'Search <b>brake block condemning limit</b>.', 'Then search <b>wheel diameter variation same axle bogie</b>.'],
    see: ['The first hit is labelled <b>ANSWER — IN THE DOCUMENT\'S OWN WORDS</b>, large, with the page number, and a <em>Source:</em> line naming the manual and page.', 'More hits under <b>ALSO IN</b>.', 'The wheel question names <b>IRCA Part III</b> as its source.'],
    why: 'It quotes; it never paraphrases. 8,200 passages from the shipped manuals, on the phone, with no internet. If a passage does not exist it says so rather than inventing one.',
    ifNot: ['"Manual not indexed": run INDEX‑MANUALS.cmd on the laptop (the Mac does this in rehearsal.sh start).'] },
  '2.20': { title: 'Working with no network', group: 'edge',
    do: ['Turn the phone\'s Wi‑Fi off (mobile data is already off).', 'On <b>Sorting</b>, tap three bands.', 'Turn Wi‑Fi back on and wait up to a minute.'],
    see: ['The three record with the usual chime; a banner: <em>3 springs are held on this tablet and will send themselves when the network is back. Nothing is lost.</em>', 'With Wi‑Fi back the banner clears and <b>Your record today</b> gains exactly three lines — no duplicates.'],
    why: 'The shed has dead spots. Work continues; the record catches up; nothing doubles when the network flickers.',
    ifNot: ['The page will not open with Wi‑Fi off: the app was never installed for offline use — that needs the certificate and one visit over https first (section 1.4).', 'Six lines instead of three: report it with the time — that would be a duplicate on resend, which the server is built to refuse.'] },
  '2.21': { title: 'Screens an inspector does not have', group: 'edge',
    do: ['In the address bar add <b>/dashboard</b> to the app address and open it.', 'Do the same with <b>/audit</b>.'],
    see: ['Only the inspector\'s own screens appear — there is no DRM dashboard or audit page to reach by typing.', 'On the server the DRM\'s analytics and the audit data answer <b>403 refused</b> to an inspector\'s sign-in.'],
    why: 'Roles are enforced on the server by capability, not by hiding buttons.',
    ifNot: ['A dashboard with figures on an inspector\'s phone: report it — that is a permission fault.'] },
  '2.22': { title: 'Sign out', group: 'edge',
    do: ['Tap the red <b>Logout</b> in the bar.', 'Press the phone\'s back button.'],
    see: ['The sign-in page.', 'Back does not reopen a signed-in screen.'],
    why: 'A phone left on the bench must not carry a live session.',
    ifNot: [] }
};

const GROUPS = [
  ['bench', 'The bench — springs', '2.1 – 2.9', 'Sign in as inspector1. Everything here is one tap per spring.'],
  ['single', 'One spring on a wagon', '2.10', 'The same tables, tied to a wagon and bogie.'],
  ['wagon', 'A wagon — WR/BCNHL/40112 and SER/BOXNHL/30914', '2.11 – 2.17', 'Checklist, photographs, parts, the brake proforma, the timeline, a wheel.'],
  ['camera', 'The camera and the manual', '2.18 – 2.19', 'Reading a painted number; asking the manual in its own words.'],
  ['edge', 'No network, no permission, sign out', '2.20 – 2.22', 'What must keep working and what must be refused.']
];

const matched = result.steps.filter((s) => s.ok).length;
const byHand = result.steps.filter((s) => s.byHand).length;
const total = result.steps.length;

const stepHtml = (s) => {
  const g = GUIDE[s.num];
  const shots = s.shots.map((f) => { const jpg = `shots/${f.replace(/\.png$/, '.jpg')}`; const cap = f.replace(/^\d+-/, '').replace(/\.png$/, '').replace(/-/g, ' '); return `<figure><a href="${jpg}" target="_blank" rel="noopener"><img src="${jpg}" alt="Step ${s.num} — ${esc(cap)}" loading="lazy"></a><figcaption>${esc(cap)} · tap to open in full</figcaption></figure>`; }).join('');
  const id = s.num.replace('.', '-');
  return `
<article class="step" id="s-${id}" data-num="${s.num}">
  <header class="step-head">
    <div class="step-num">${s.num}</div>
    <h3>${esc(g.title)}</h3>
    <div class="step-tick">
      <label><input type="checkbox" id="chk-${id}" aria-label="Step ${s.num} seen"> <span>Seen it</span></label>
      <button type="button" id="bad-${id}" aria-pressed="false">Didn't match</button>
    </div>
  </header>
  <div class="note" hidden><textarea id="note-${id}" placeholder="What you saw instead — and the screen you photographed"></textarea></div>
  <div class="step-body">
    <div class="shots">${shots}</div>
    <div class="text">
      <section class="do"><h4>Do</h4><ol>${g.do.map((d) => `<li>${d}</li>`).join('')}</ol></section>
      <section class="see"><h4>You must see</h4><ul>${g.see.map((d) => `<li>${d}</li>`).join('')}</ul></section>
      <section class="why"><h4>What it proves</h4><p>${g.why}</p></section>
      <section class="machine ${s.ok ? 'ok' : 'bad'}">
        <h4>The machine saw <span class="stamp">${s.ok ? 'matched' : 'did not match'} · ${when(s.startedAt)}</span></h4>
        <ul>${s.saw.map((x) => `<li class="${x.ok ? 'ok' : 'bad'}">${esc(x.text)}</li>`).join('')}</ul>
        ${s.byHand ? `<p class="byhand"><b>By hand:</b> ${esc(g.byHandNote || s.byHand)}</p>` : ''}
      </section>
      ${g.ifNot.length ? `<section class="ifnot"><h4>If it is not there</h4><ul>${g.ifNot.map((d) => `<li>${d}</li>`).join('')}</ul></section>` : ''}
    </div>
  </div>
</article>`;
};

const groupHtml = ([key, title, range, who]) => {
  const steps = result.steps.filter((s) => GUIDE[s.num].group === key);
  return `<section class="group" id="g-${key}">
  <div class="group-head"><h2>${esc(title)}</h2><span class="range">${esc(range)}</span><button type="button" class="sec-clear" data-sec="${key}">Clear these ticks</button></div>
  <p class="who">${esc(who)}</p>
  ${steps.map(stepHtml).join('')}
</section>`;
};

const html = `<title>Inspector Walk</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root{
    --ground:#eef0f2; --paper:#ffffff; --ink:#1b2027; --ink-2:#48525c; --ink-3:#7a8590; --line:#d5d9de;
    --accent:#1f4e79; --accent-soft:#e3ecf5; --ok:#2e7d4f; --ok-soft:#e2f1e7; --bad:#b3261e; --bad-soft:#fbe7e5; --warn:#8a6100; --warn-soft:#fff3d6;
    --shot-frame:#0f1216;
  }
  @media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
    --ground:#14181c; --paper:#1c2228; --ink:#eceef0; --ink-2:#b7bfc7; --ink-3:#86909b; --line:#2e3740;
    --accent:#82b3e4; --accent-soft:#1c2e41; --ok:#6fcf97; --ok-soft:#1b3226; --bad:#f28b82; --bad-soft:#3c1f1d; --warn:#f2c14e; --warn-soft:#3a2f10;
    --shot-frame:#000;
  }}
  :root[data-theme="dark"]{
    --ground:#14181c; --paper:#1c2228; --ink:#eceef0; --ink-2:#b7bfc7; --ink-3:#86909b; --line:#2e3740;
    --accent:#82b3e4; --accent-soft:#1c2e41; --ok:#6fcf97; --ok-soft:#1b3226; --bad:#f28b82; --bad-soft:#3c1f1d; --warn:#f2c14e; --warn-soft:#3a2f10;
    --shot-frame:#000;
  }
  body{background:var(--ground);color:var(--ink);font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;line-height:1.5;margin:0;padding-block:0 56px;padding-inline:16px}
  .wrap{max-width:1080px;margin:0 auto}
  header.top{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--ground);border-bottom:1px solid var(--line);padding:12px 0 10px;margin-bottom:18px}
  .top-row{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 16px}
  .eyebrow{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
  h1{font-size:21px;font-weight:700;margin:0;letter-spacing:-.01em;text-wrap:balance}
  .progress{display:flex;align-items:center;gap:10px;font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--ink-2);font-variant-numeric:tabular-nums}
  .bar{width:160px;max-width:38vw;height:8px;background:var(--line);border-radius:4px;overflow:hidden}
  .bar i{display:block;height:100%;background:var(--ok);width:0%}
  .intro{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-bottom:22px}
  @media (max-width:760px){ .intro{grid-template-columns:1fr} }
  .card{background:var(--paper);border:1px solid var(--line);padding:16px 18px}
  .card h2{font-size:15px;margin:0 0 8px}
  .card p{margin:0 0 8px;max-width:70ch}
  .card ol,.card ul{margin:6px 0 0;padding-left:20px}
  .card li{margin-bottom:4px}
  code{font-family:"IBM Plex Mono",monospace;font-size:13px;background:var(--accent-soft);color:var(--accent);padding:1px 6px;border-radius:3px}
  .run{border-left:4px solid var(--ok)}
  .run .big{font-size:30px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
  .run .big small{font-size:14px;font-weight:500;color:var(--ink-2)}
  .run dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:10px 0 0;font-size:13px}
  .run dt{color:var(--ink-3)} .run dd{margin:0;font-family:"IBM Plex Mono",monospace;font-size:12.5px;word-break:break-all}
  .toc{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 22px}
  .toc a{font-size:13px;text-decoration:none;color:var(--accent);background:var(--paper);border:1px solid var(--line);padding:6px 10px}
  .group{margin-bottom:30px}
  .group-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px 14px;border-bottom:2px solid var(--ink);padding-bottom:6px;margin-bottom:6px}
  .group-head h2{font-size:18px;margin:0;text-wrap:balance}
  .range{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--ink-3)}
  .who{font-size:13px;color:var(--ink-2);margin:0 0 12px}
  .sec-clear{margin-left:auto;font:inherit;font-size:11px;border:1px solid var(--line);background:transparent;color:var(--ink-3);padding:2px 8px;cursor:pointer}
  .sec-clear.danger,.foot button.danger{background:var(--bad);color:#fff;border-color:var(--bad)}
  .step{background:var(--paper);border:1px solid var(--line);margin-bottom:14px}
  .step.done{border-color:var(--ok)} .step.bad{border-color:var(--bad)}
  .step-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:12px 16px;border-bottom:1px solid var(--line)}
  .step.done .step-head{background:var(--ok-soft)} .step.bad .step-head{background:var(--bad-soft)}
  .step-num{font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--accent);font-weight:500;min-width:36px}
  .step-head h3{font-size:16px;margin:0;flex:1 1 200px;text-wrap:balance}
  .step-tick{display:flex;align-items:center;gap:10px;font-size:13px}
  .step-tick label{display:flex;align-items:center;gap:6px;cursor:pointer}
  .step-tick input{width:20px;height:20px;accent-color:var(--ok);margin:0}
  .step-tick button{font:inherit;font-size:12px;border:1px solid var(--line);background:transparent;color:var(--ink-2);padding:4px 8px;cursor:pointer}
  .step-tick button[aria-pressed=true]{background:var(--bad);color:#fff;border-color:var(--bad)}
  .note{padding:10px 16px 0}
  .note textarea{width:100%;box-sizing:border-box;font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--bad);background:var(--paper);color:var(--ink);min-height:48px;resize:vertical}
  .step-body{display:grid;grid-template-columns:230px 1fr;gap:18px;padding:14px 16px 16px}
  @media (max-width:640px){ .step-body{grid-template-columns:1fr} .shots{display:flex;gap:10px;overflow-x:auto} .shots figure{flex:0 0 200px} }
  .shots{display:flex;flex-direction:column;gap:10px}
  .shots figure{margin:0}
  .shots img{display:block;width:100%;max-width:100%;max-height:520px;object-fit:cover;object-position:top;background:var(--shot-frame);border:6px solid var(--shot-frame);border-radius:14px;box-sizing:border-box}
  .shots figcaption{font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--ink-3);margin-top:4px;text-align:center}
  .text{display:flex;flex-direction:column;gap:12px;min-width:0}
  .text h4{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin:0 0 4px;font-weight:500}
  .text ol,.text ul{margin:0;padding-left:20px}
  .text li{margin-bottom:3px;max-width:70ch}
  .text p{margin:0;max-width:70ch}
  .see li{list-style:none;position:relative;padding-left:0;margin-left:-20px}
  .see li::before{content:"▸";color:var(--accent);margin-right:6px}
  .why p{color:var(--ink-2);font-size:14px}
  .machine{border:1px solid var(--line);padding:10px 12px;background:var(--ground)}
  .machine.ok{border-color:var(--ok)} .machine.bad{border-color:var(--bad)}
  .machine h4 .stamp{float:right;text-transform:none;letter-spacing:0;color:var(--ok);font-variant-numeric:tabular-nums}
  .machine.bad h4 .stamp{color:var(--bad)}
  .machine ul{padding-left:0;list-style:none;font-size:13px}
  .machine li{padding-left:20px;position:relative;font-family:"IBM Plex Mono",monospace;font-size:12px;line-height:1.45;word-break:break-word}
  .machine li::before{position:absolute;left:0;font-weight:700}
  .machine li.ok::before{content:"✓";color:var(--ok)} .machine li.bad::before{content:"✗";color:var(--bad)}
  .byhand{font-size:13px;color:var(--warn);margin-top:8px!important}
  .ifnot{border-left:3px solid var(--warn);padding-left:12px}
  .band{display:inline-block;padding:0 6px;border-radius:3px;font-size:12.5px;font-weight:600;border:1px solid var(--line);white-space:nowrap}
  .band.blue{background:#1d4ed8;color:#fff} .band.green{background:#15803d;color:#fff} .band.yellow{background:#ca8a04;color:#fff} .band.orange{background:#ea580c;color:#fff} .band.white{background:#f1f5f9;color:#1b2027} .band.red{background:#dc2626;color:#fff}
  .foot{margin-top:26px;font-size:13px;color:var(--ink-2);max-width:72ch}
  .foot button{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--paper);color:var(--ink);padding:6px 10px;cursor:pointer;margin-right:8px}
  .summary{font-family:"IBM Plex Mono",monospace;font-size:13px;white-space:pre-wrap;background:var(--paper);border:1px solid var(--line);padding:12px;margin-top:10px;display:none}
  :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  @media print{ header.top{position:static} .step-tick,.foot,.sec-clear{display:none} .step{break-inside:avoid} .shots img{max-height:none} }
  @media (prefers-reduced-motion:reduce){ *{transition:none!important} }
</style>

<div class="wrap">
  <header class="top">
    <div class="top-row">
      <div>
        <div class="eyebrow">WRS Raipur · Walkthrough section 2 · the inspector, on a phone</div>
        <h1>Inspector walk — every screen, with the machine's own photographs</h1>
      </div>
      <div class="progress"><span id="count">0 / ${total}</span><div class="bar"><i id="fill"></i></div><span id="badcount"></span></div>
    </div>
  </header>

  <div class="intro">
    <div class="card">
      <h2>Before you start — five minutes, once</h2>
      <ol>
        <li>On the Mac: <code>bash scripts/rehearsal.sh start</code>, then <code>bash scripts/rehearsal.sh status</code> for the two addresses. On the demo laptop: double‑click <b>START.cmd</b>; it prints the address.</li>
        <li>On the phone, turn <b>mobile data off</b> and join the same Wi‑Fi as the server.</li>
        <li>Install the certificate on the phone once — <b>lan‑cert.crt</b>, as in TABLET_TRUST.md — so the address opens with no warning and the camera and offline mode are allowed. Without it the page opens but 2.7, 2.18 and 2.20 cannot pass.</li>
        <li>Open <b>https://&lt;the Wi‑Fi address&gt;:3200</b> and accept <em>Add to home screen</em>.</li>
        <li>Sign in as <b>inspector1</b>, password <b>password123</b>.</li>
      </ol>
      <p style="margin-top:10px">Then go step by step. Each step shows the phone screenshot the machine took on this build, the taps in order, what must be on your screen, and what to suspect when it is not. Tick <b>Seen it</b> only when you saw it; <b>Didn't match</b> and a note is the bug report.</p>
    </div>
    <div class="card run">
      <h2>The machine's run of these 22 steps</h2>
      <div class="big">${matched} / ${total} <small>matched</small></div>
      <dl>
        <dt>When</dt><dd>${esc(day)}, ${when(result.startedAt)} – ${when(result.finishedAt)}</dd>
        <dt>Against</dt><dd>${esc(result.base)} (the packaged bundle, seeded by DEMO‑DATA's command)</dd>
        <dt>As</dt><dd>a 412 × 915 phone, touch, camera allowed</dd>
        <dt>By hand</dt><dd>${byHand} steps need a real object in front of the camera (2.7, 2.18) — the machine proved the screen, you supply the spring and the number</dd>
        <dt>Page errors</dt><dd>${result.consoleErrors.length ? esc(result.consoleErrors.join('; ')) : 'none'}</dd>
        <dt>Rerun</dt><dd>node scripts/inspector-walk.mjs · node scripts/inspector-guide.mjs</dd>
      </dl>
    </div>
  </div>

  <nav class="toc">${GROUPS.map(([k, t, r]) => `<a href="#g-${k}">${esc(r)} · ${esc(t)}</a>`).join('')}</nav>

  <div id="sections">${GROUPS.map(groupHtml).join('')}</div>

  <div class="foot">
    <p>When you finish, press <b>Show summary</b> and send the text to Pratik's chat — the "did not match" lines with their notes are what gets fixed. Ticks live only in this browser.</p>
    <button type="button" id="summarise">Show summary</button>
    <button type="button" id="reset">Clear all ticks</button>
    <span id="reset-confirm" hidden>Clear every tick and note on this page? <button type="button" id="reset-yes" class="danger">Yes, clear all</button> <button type="button" id="reset-no">Keep them</button></span>
    <div class="summary" id="summary"></div>
  </div>
</div>

<script>
const KEY='wrs-inspector-walk-v1';
let state={};
try{ state=JSON.parse(localStorage.getItem(KEY)||'{}')||{}; }catch(e){ state={}; }
function save(){ try{ localStorage.setItem(KEY,JSON.stringify(state)); }catch(e){} }
const steps=[...document.querySelectorAll('.step')];
const rows={};
const total=steps.length;
for(const row of steps){
  const num=row.dataset.num, id=num.replace('.','-');
  const chk=document.getElementById('chk-'+id), btn=document.getElementById('bad-'+id), noteWrap=row.querySelector('.note'), ta=document.getElementById('note-'+id);
  const st=state[num]||{done:false,bad:false,note:''};
  const paint=()=>{ row.classList.toggle('done',st.done&&!st.bad); row.classList.toggle('bad',st.bad); chk.checked=st.done; btn.setAttribute('aria-pressed',String(st.bad)); noteWrap.hidden=!st.bad; ta.value=st.note||''; };
  chk.addEventListener('change',()=>{ st.done=chk.checked; if(st.done) st.bad=false; state[num]=st; save(); paint(); refresh(); });
  btn.addEventListener('click',()=>{ st.bad=!st.bad; if(st.bad) st.done=false; state[num]=st; save(); paint(); refresh(); if(st.bad) ta.focus(); });
  ta.addEventListener('input',()=>{ st.note=ta.value; state[num]=st; save(); });
  rows[num]=()=>{ st.done=false; st.bad=false; st.note=''; paint(); };
  paint();
}
function refresh(){
  let done=0,bad=0;
  for(const n in rows){ const st=state[n]; if(st&&st.done) done++; if(st&&st.bad) bad++; }
  document.getElementById('count').textContent=done+' / '+total+' seen';
  document.getElementById('fill').style.width=Math.round(done/total*100)+'%';
  document.getElementById('badcount').textContent=bad?bad+" didn't match":'';
}
function clearSteps(nums){ for(const n of nums){ delete state[n]; if(rows[n]) rows[n](); } save(); try{ if(!Object.keys(state).length) localStorage.removeItem(KEY); }catch(e){} refresh(); }
refresh();
// No browser pop-ups anywhere on this page: the frame it is shown in swallows them.
for(const b of document.querySelectorAll('.sec-clear')){
  b.addEventListener('click',()=>{
    const nums=[...document.querySelectorAll('#g-'+b.dataset.sec+' .step')].map((r)=>r.dataset.num);
    if(b.dataset.armed!=='1'){ b.dataset.armed='1'; b.textContent='Really clear '+nums.length+' ticks? Click again'; b.classList.add('danger'); setTimeout(()=>{ b.dataset.armed=''; b.textContent='Clear these ticks'; b.classList.remove('danger'); },4000); return; }
    b.dataset.armed=''; b.textContent='Clear these ticks'; b.classList.remove('danger');
    clearSteps(nums);
  });
}
document.getElementById('reset').addEventListener('click',()=>{ document.getElementById('reset-confirm').hidden=false; });
document.getElementById('reset-no').addEventListener('click',()=>{ document.getElementById('reset-confirm').hidden=true; });
document.getElementById('reset-yes').addEventListener('click',()=>{ clearSteps(Object.keys(rows)); document.getElementById('reset-confirm').hidden=true; document.getElementById('summary').style.display='none'; window.scrollTo({top:0}); });
document.getElementById('summarise').addEventListener('click',()=>{
  const lines=['WRS Raipur — inspector walk (section 2) — '+new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})];
  let done=0,bad=[];
  for(const row of steps){ const n=row.dataset.num, st=state[n]; if(st&&st.done) done++; if(st&&st.bad) bad.push(n+' '+row.querySelector('h3').textContent+' — '+(st.note||'(no note)')); }
  lines.push(done+' of '+total+' steps seen; '+bad.length+' did not match.');
  if(bad.length){ lines.push(''); lines.push('Did not match:'); lines.push(...bad.map((b)=>'  - '+b)); }
  const el=document.getElementById('summary'); el.textContent=lines.join('\\n'); el.style.display='block';
});
</script>
`;
writeFileSync(`${OUT}/index.html`, html);
console.log(`${OUT}/index.html — ${matched}/${total} matched, ${byHand} by hand, ${result.steps.reduce((n, s) => n + s.shots.length, 0)} screenshots`);
