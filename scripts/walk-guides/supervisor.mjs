/**
 * Section 3 — the supervisor, on the laptop (the projector). The words a
 * person reads in the walk page; the evidence beside them is the machine's
 * (scripts/role-walks.mjs supervisor). Button names exactly as the screen
 * prints them.
 */
export const ROLE = 'supervisor';
export const SECTION = '3';
export const DEVICE = 'laptop';
export const TITLE = 'Supervisor Walk';
export const EYEBROW = 'the supervisor, on the laptop';
export const H1 = { rehearsal: "Supervisor walk — every screen, with the machine's own screenshots", handout: 'Supervisor walk — every screen, step by step' };
export const ACCOUNT = { user: 'supervisor1', handout: 'the supervisor account you were given' };
export const WALK_CMD = 'node scripts/role-walks.mjs supervisor';

export const GUIDE = {
  '3.1': { title: 'The wagons in the workshop', group: 'pipeline',
    do: ['Sign in as <b>supervisor1</b> / password123.', 'Tap <b>Wagons Pipeline</b> in the bar.'],
    see: ['<b>Wagons in the workshop</b>: a tile for each of the seven stages with its count, <b>Total 13</b>.', 'A card per wagon: its stage, <b>days in shop</b> (hours while it is under two days), the bar of progress, <em>In: date · Due: date</em>, and <b>Open →</b>.', 'Above the list, <b>Shift handover</b>: <em>Draft from today\'s records</em> writes a few sentences from the day\'s own record to read, change and sign.'],
    why: 'This is the board the shop keeps on a whiteboard today, computed from the record — which stage each wagon is in, how long it has been there, and when it is due.',
    ifNot: ['Fewer than thirteen wagons or empty stage tiles: the demonstration record was not seeded — DEMO‑DATA.cmd on the PC.'] },
  '3.2': { title: 'Registering a wagon — what is refused', group: 'pipeline',
    do: ['Tap <b>Register New Wagon</b>. Read the form: number, type, railway, due-out date, notes.', 'Try to register <b>WR/BCNHL/40112</b> again; try <b>ADSFADS</b>; try a made-up type.'],
    see: ['The duplicate is refused — <em>already exists</em>.', '<b>ADSFADS</b> is refused — <em>not a wagon number</em>. A number is RLY/TYPE/NUMBER or the eleven-digit form.', 'A type the standard does not know is refused — the checklist, spring counts and pocket counts all come from the type.'],
    why: 'The pipeline can only hold real wagons of known types; the rest of the record is built on that. A wagon registered by mistake is voided with a reason and a one-time code (<em>Registered in error?</em> on the wagon), never deleted.',
    ifNot: ['A nonsense number or type goes through: report it — it is a validation fault on the server.'] },
  '3.3': { title: 'The pocket counts, as a supervisor sees them', group: 'pipeline',
    do: ['Open <b>WR/BCNHL/40112</b> → the <b>Photos</b> tab.', 'Read the four <b>Pocket counts</b> lines.'],
    see: ['Bogie 1 · Side A, Bogie 1 · Side B, Bogie 2 · Side A: complete, not flagged.', '<b>Bogie 2 · Side B: 6 of 7 outer counted</b> — the figure the inspector was not shown, because a supervisor may see a first count before the blind recount.'],
    why: 'The same wagon the inspector saw in 2.13. The inspector saw "a blind recount is needed" and no numbers; the supervisor sees the numbers. Two views of one record, by role.',
    ifNot: ['The supervisor sees no figures either: the seed did not write the counts — re-seed.'] },
  '3.4': { title: 'Release checks — the short count waits as an advisory', group: 'pipeline',
    do: ['Same wagon → the <b>Release checks</b> tab.'],
    see: ['<em>Bogie 2 Side B: the first count fell short of what this wagon type carries. A second person must recount the frame blind before the figures are shown here.</em> — listed as an advisory, by name.', 'Release needs it acknowledged by the supervisor signing off.'],
    why: 'Nothing about the short pocket is lost between the photograph and the exit gate: it is waiting there, named, for a person to deal with.',
    ifNot: [] },
  '3.5': { title: 'SER/BOXNHL/30914 — blocked at the gate', group: 'pipeline',
    do: ['Open <b>SER/BOXNHL/30914</b> (at the Final QC Gate) → <b>Release checks</b>.'],
    see: ['Three blockers, each in plain words: <em>Outer Spring (Bogie 1) is condemned and requires replacement</em>; <em>Wheel axle 3 left is below the last-shop-issue diameter: tread diameter 917.5 mm (last shop issue 919 mm, condemn 906 mm)</em>; <em>CTRB Cartridge Bearing Rotation has not been inspected</em>.', 'The <b>Authorize</b> button is disabled while any blocker stands.'],
    why: 'Nothing leaves with a known condemned spring, a wheel under the last-shop-issue diameter or a mandatory check undone — and the screen says which, with the figure and the limit.',
    ifNot: ['Authorize is enabled with blockers listed: report it at once.'] },
  '3.6': { title: 'The wheels, with the limit beside each', group: 'pipeline',
    do: ['Same wagon → <b>Checklist</b> tab → scroll to the wheels (Axle 1 · bogie 1 … Axle 4 · bogie 2).'],
    see: ['Eight chalk figures, one per wheel, each judged: <em>within limits</em> in green, <em>below issue limit</em> in amber for axle 3 (917.5 / 917.8 mm).', 'Beneath: <em>Diameters: Wagon Maintenance Manual Ch.6 (RDSO WD‑88089/S‑1). Variation: IRCA Part III Rule 2.8.9.2. Flange and flat limits: IRCA Part III Plate 52.</em>', '<em>8 of 8 wheels read; every variation within its limit.</em>'],
    why: 'The limit and the drawing number are on the screen, not in someone\'s memory; the same-axle and same-bogie variation rules are checked as the figures come in.',
    ifNot: [] },
  '3.7': { title: 'The condition report', group: 'pipeline',
    do: ['Same wagon → <b>Condition report</b> tab.'],
    see: ['A one-page report for this wagon — what was found, what was done — with <b>Print report</b>.'],
    why: 'The paper the shop files today, produced from the record instead of retyped.',
    ifNot: [] },
  '3.8': { title: 'The release certificate and its QR', group: 'released',
    do: ['Open <b>SECR/BOXNHL/10492</b> (Certified Release) → the green <b>Release Certificate</b> button.', 'Read the header; scroll the eight categories.', '<b>Scan the QR with the phone</b> on the same Wi‑Fi. Then <b>Print Certificate</b>.'],
    see: ['<em>Certificate No: WRS/QC-REL/2026/08/…</em>, wagon, type, railway, intake date, <b>release date weeks ago — not today</b>, <em>Workshop TAT: 6.2 Days</em>.', 'The eight-category clearance matrix, each <b>CLEARED</b> with its standard (G‑95 Tables 28–33, C‑9901, G‑81, 02‑ABR‑02 …).', 'The QR is a link to <em>verify.html</em> on this server; the phone opens it and shows <b>VERIFIED</b>. Print gives a clean page.'],
    why: 'A certificate that proves itself: the number fetches the signed record with no account, and the signature is checked in the phone\'s own browser.',
    ifNot: ['The phone opens the sign-in screen instead of the verify page: the phone has an old copy of the app — open the address once more and it updates itself.', 'The release date is today: the seed ran with the wrong clock; re-seed.'],
    byHandNote: 'Scanning the QR needs the phone; the verify page itself was checked from the laptop.' },
  '3.9': { title: 'The passport', group: 'released',
    do: ['Same wagon → <b>Passport</b> tab → <b>Export the passport</b>.', 'Read <em>What the passport holds</em> under the button.'],
    see: ['A file <em>SECR_BOXNHL_10492.passport.jsonl</em> downloads.', '<em>Passport file saved. It is for the next workshop\'s software, not for reading — what it contains is listed below.</em> Stage moves, spring readings, checklist verdicts, parts, tests, photographs, the sign-off, with dates and who sealed each.'],
    why: 'The wagon carries its own signed history to the next POH shop; no central server has to exist for two shops to trust each other\'s record.',
    ifNot: ['Nothing downloads: the browser blocked the download — allow it for this address.'] },
  '3.10': { title: 'Moving a due-out date asks why', group: 'pipeline',
    do: ['Open <b>WR/BCNHL/40112</b>. In the <b>Due out</b> badge pick a date a few days on.', 'Type a reason; tap <b>Move the date</b>.'],
    see: ['A box appears asking <b>why</b>; <em>Move the date</em> is disabled until a reason is typed.', 'A green line: <em>Due‑out moved 2026‑09‑19 → 2026‑09‑24, with the reason, on the audit trail.</em>'],
    why: 'The date the DRM\'s "will miss its date" list is computed from cannot drift silently.',
    ifNot: ['Put the date back afterwards (with a reason) so the rehearsal record stays as the demo expects.'] },
  '3.11': { title: 'What is not on the supervisor\'s menu', group: 'pipeline',
    do: ['Look at the bar.'],
    see: ['<b>Wagons Pipeline · Single Spring · Spring Batch · Ask the Manual · Shadow Run · Ask the Records · Audit Chain</b> — and not Stores, Passports, History, Analytics or Learning.'],
    why: 'By design for the pilot: the supervisor\'s menu is the shop floor. The rest is under the DRM (4.3, 4.4) and the administrator (5.9–5.11).',
    ifNot: [] },
  '3.15': { title: 'Ask the Manual', group: 'records',
    do: ['<b>Ask the Manual</b> → <em>brake block condemning limit</em>.'],
    see: ['The first hit labelled <b>ANSWER — IN THE DOCUMENT\'S OWN WORDS</b>, the page, a <em>Source:</em> line; more under <b>ALSO IN</b>.'],
    why: 'Same as 2.19 — it quotes, never paraphrases.',
    ifNot: ['"Manual not indexed": INDEX‑MANUALS.cmd on the PC.'] },
  '3.17': { title: 'The shadow run', group: 'records',
    do: ['<b>Shadow Run</b>. Read the week and the verdict.', 'Record a discrepancy and a day\'s summary with the two forms.'],
    see: ['A week of the log, day by day; the verdict box.', 'The case that decides: <em>the snubber on NR/BOXN/60334 — the register would have passed it</em>.', 'Both forms are on the page; what you record appears in the list.'],
    why: 'This is how the pilot is proposed to start — the register and the app side by side for two weeks — and this screen is what decides go-live.',
    ifNot: [] },
  '3.18': { title: 'Ask the Records', group: 'records',
    do: ['<b>Ask the Records</b> → <em>which wagon type condemns the most snubbers this quarter</em> → open <b>How this was computed</b>.', 'Then <em>is any gauge reading high</em>.', 'Then something it cannot know.'],
    see: ['An answer with its count; under <em>How this was computed</em> the query, its parameters and the rows.', '<b>OSG‑02</b> named as reading high, by how much, and that with two gauges the record cannot say which is off — both go against the master.', 'A question outside the record → it says it cannot answer, rather than inventing one.'],
    why: 'Questions in plain words; the arithmetic is fixed and shown. Its refusal to guess is the point.',
    ifNot: [] },
  '3.19': { title: 'The audit chain', group: 'records',
    do: ['<b>Audit Chain</b> → <b>Verify chain again</b>.'],
    see: ['<b>Chain intact</b>, and the green card gains <em>Re‑derived just now — at HH:MM:SS, in N ms (check 2 this session)</em> with the count of entries checked.'],
    why: 'Every entry is hashed with the one before it. The screen re-derives the whole chain in front of you; if any entry had been altered it would say where.',
    ifNot: ['The card does not change on the second press: reload once; the pulse is one second long.'] },
  '3.20': { title: 'Overriding a band', group: 'records',
    do: ['<b>Single Spring</b> → a wagon, a bogie, a height.', 'At the bottom, next to Save, tap the amber <b>Supervisor override — change the band</b>.'],
    see: ['<b>Supervisor Override</b>: the six bands to choose from; <em>Override justification (required)</em>, ten characters at least; <em>Supervisor OTP verification → Request OTP</em>; <b>Authorize Override</b> disabled until all three are given.', 'The record then shows both the original and the overridden band, with the name and the reason.'],
    why: 'A supervisor can overrule the table — with a reason, a code and their name on the record. Never silently.',
    ifNot: ['Cancel in rehearsal; do not leave an override on the demo record.'] },
  '3.21': { title: 'Hindi on the pipeline and release checks', group: 'records',
    do: ['<b>Wagons Pipeline</b> → tap <b>हिंदी</b>; then a wagon\'s release checks; then back to <b>EN</b>.'],
    see: ['Everything translated; wagon numbers, dates and figures unchanged.'],
    why: 'The floor works in Hindi; the numbers are the same in both.',
    ifNot: ['A line still in English inside a Hindi screen: note which — a missing translation, not a fault in the record.'] }
};

export const GROUPS = [
  ['pipeline', 'The pipeline — wagons, the gate, the wheels', '3.1 – 3.7, 3.10 – 3.11', 'Sign in as supervisor1. On the laptop, on the projector.'],
  ['released', 'A released wagon — certificate and passport', '3.8 – 3.9', 'SECR/BOXNHL/10492, released weeks ago.'],
  ['records', 'The records — manual, shadow run, ask, audit, override, Hindi', '3.15 – 3.21', 'What the supervisor uses to decide and to prove.']
];
