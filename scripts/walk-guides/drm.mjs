/**
 * Section 4 — the DRM, on the laptop. The words a person reads in the walk
 * page; the evidence beside them is the machine's (scripts/role-walks.mjs drm).
 */
export const ROLE = 'drm';
export const SECTION = '4';
export const DEVICE = 'laptop';
export const TITLE = 'DRM Walk';
export const EYEBROW = 'the DRM, on the laptop';
export const H1 = { rehearsal: "DRM walk — every screen, with the machine's own screenshots", handout: 'DRM walk — every screen, step by step' };
export const ACCOUNT = { user: 'drm1', handout: 'the DRM account' };
export const WALK_CMD = 'node scripts/role-walks.mjs drm';

export const GUIDE = {
  '4.1': { title: 'Shop Floor — Right Now', group: 'dashboard',
    do: ['Sign in as <b>drm1</b> / password123.', 'Tap <b>DRM Dashboard</b>. Read the tiles under <b>Shop Floor — Right Now</b>.'],
    see: ['<em>When does today\'s pile finish?</em> — springs per hour and the hours for the shift\'s pile, with how many sorted over how many minutes.', '<em>How many bogies can we build right now?</em> — the number, and which spring position is the limit.', '<em>What will Stores need this fortnight?</em> — replacements across so many wagons, with the observed condemnation rate and the number of inspections it rests on.', '<em>Is the record intact?</em> — yes, N entries, unbroken.', 'None says <em>Not yet known</em>.'],
    why: 'Four questions a DRM actually asks, answered from the record with the basis under each. Where the evidence would be thin the tile says "not yet known" instead of a number — on the demo record it is not thin.',
    ifNot: ['A tile says "Not yet known": the bench has too few springs today — sort a few as the inspector first, or re-seed.'] },
  '4.2': { title: 'The rest of the dashboard', group: 'dashboard',
    do: ['Scroll.'],
    see: ['<b>What a camera could tell an inspector</b> — blind-read agreement, assembly coverage, the pocket-count dataset: what has been earned and what has not.', '<b>Where wagons wait</b> — dwell per stage with the median and the slow stage; <b>the wagon that will miss its date</b>, computed from the stages left, not predicted.', '<b>What keeps coming back</b> — recurring findings by part and wagon type.', 'Turnaround, the band distribution (six colours, the bench included), inspector quality, gauge exposure — every rate with its count.'],
    why: 'Every figure carries its n. Nothing here is a forecast or a model\'s number.',
    ifNot: [] },
  '4.3': { title: 'Spring Analytics', group: 'dashboard',
    do: ['<b>Spring Analytics</b>. Tap one of the day bars.', 'Scroll to the standard report and the gauge drift panel.'],
    see: ['Bench totals today and this week; tapping a bar reads that day\'s figures beneath it.', 'Stock by band.', '<b>The standard report</b> — this shop\'s springs against the G‑95 bands, with <em>n</em> on every figure.', '<b>Gauge drift</b> names <b>OSG‑02</b>: the two outer gauges disagree by 1.5 mm — put both against the master.'],
    why: 'The distribution of a shop\'s springs against the standard is evidence RDSO has never had from a shop; the drift check finds a gauge reading high from the record alone.',
    ifNot: [] },
  '4.4': { title: 'What the system has learned', group: 'dashboard',
    do: ['<b>System Learning</b>. Read the table. Tap <b>Run Analysis</b>.'],
    see: ['Each subsystem — caliper reading, spring classification, voice, acoustic, defect suggestions, the amber box, wagon-number reading, spring camera, part camera — with observations, corrections and accuracy. On the demo record: <em>no data</em>.', '<em>The camera has not been taught anything yet.</em> The server confirms the camera may not sort on its own.', 'After <b>Run Analysis</b>, a green line: <em>Analysed at HH:MM — N observations, 0 new proposals (nothing worth changing yet).</em>', '<em>RDSO band tables and condemning limits are never tunable — they are regulation, not parameters.</em>'],
    why: 'What has been learned is a table with counts, not a claim. No change applies itself; each is accepted by a named supervisor. The standard is never "learned".',
    ifNot: ['Run Analysis shows an error: the server refused the DRM — report it; it was fixed on 21 Sep.'] },
  '4.5': { title: 'Shadow Run — read-only', group: 'oversight',
    do: ['<b>Shadow Run</b>.'],
    see: ['The week and the verdict are visible; there are <b>no record buttons</b> — the DRM reads, the designated reviewer writes.'],
    why: 'Oversight sees everything and writes nothing.',
    ifNot: [] },
  '4.6': { title: 'Ask the Records', group: 'oversight',
    do: ['<b>Ask the Records</b> → <em>is any gauge reading high</em> → <b>How this was computed</b>.'],
    see: ['<b>OSG‑02</b>, by how much, and what the record can and cannot say; the query and the rows.'],
    why: 'As 3.18 — the DRM can ask the same questions with the same proof.',
    ifNot: [] },
  '4.7': { title: 'The audit chain', group: 'oversight',
    do: ['<b>Audit Chain</b> → <b>Verify chain again</b>.'],
    see: ['<b>Chain intact</b>; <em>Re-derived just now — at HH:MM:SS, in N ms</em>.'],
    why: 'The DRM can prove the record unaltered without asking anyone.',
    ifNot: [] },
  '4.8': { title: 'What the DRM cannot do', group: 'oversight',
    do: ['<b>Wagons Pipeline</b>. Look for a Register button.'],
    see: ['There is <b>no Register New Wagon button</b> — and the server refuses the DRM\'s sign-in for it too (403).', 'As a supervisor: a junk number is refused; a wagon registered by mistake is voided with <em>Registered in error?</em> — reason, one-time code — and leaves the pipeline while its record stays.'],
    why: 'The record is always written by the floor. Oversight cannot register or inspect, so a figure on the DRM\'s dashboard is never the DRM\'s own entry.',
    ifNot: ['A Register button on the DRM\'s pipeline: a permission fault — report it.'] },
  '4.9': { title: 'A certificate that proves itself', group: 'oversight',
    do: ['Open <b>SECR/BOXNHL/10492</b> → <b>Release Certificate</b>.', '<b>Scan the QR with the phone</b> on the same Wi‑Fi.'],
    see: ['The phone opens the verify page and shows <b>VERIFIED</b> — the signature checked against the shop\'s key in the phone\'s own browser.', 'The same page also takes a certificate <em>file</em> with no server at all — what another railway would do.'],
    why: 'No login, no server, no trust in this laptop: the certificate carries its proof.',
    ifNot: ['The phone opens the app\'s sign-in screen instead: the phone holds an old copy of the app — open the address once more and it updates.'],
    byHandNote: 'The verify page was opened and checked from the laptop; scanning it needs the phone.' }
};

export const GROUPS = [
  ['dashboard', 'The dashboards', '4.1 – 4.4', 'Sign in as drm1. Every figure from the record, with its count.'],
  ['oversight', 'Oversight — what the DRM can see and cannot do', '4.5 – 4.9', 'Read everything; write nothing.']
];
