/**
 * Section 5 — the administrator, on the laptop. The words a person reads in
 * the walk page; the evidence beside them is the machine's
 * (scripts/role-walks.mjs admin).
 */
export const ROLE = 'admin';
export const SECTION = '5';
export const DEVICE = 'laptop';
export const TITLE = 'Administrator Walk';
export const EYEBROW = 'the administrator, on the laptop';
export const H1 = { rehearsal: "Administrator walk — every screen, with the machine's own screenshots", handout: 'Administrator walk — every screen, step by step' };
export const ACCOUNT = { user: 'admin1', handout: 'the administrator account' };
export const WALK_CMD = 'node scripts/role-walks.mjs admin';

export const GUIDE = {
  '5.1': { title: 'User accounts', group: 'people',
    do: ['Sign in as <b>admin1</b> / password123.', 'Tap <b>User Accounts</b>.', 'Deactivate an account, try to sign in as it elsewhere, reactivate it.'],
    see: ['The accounts with their roles; each can be <b>deactivated</b> and <b>reactivated</b>.', 'A deactivated account cannot sign in; reactivated, it can.', 'Creating an account asks for a one-time code first.'],
    why: 'People change; the record does not. An account is switched off, never deleted, so everything it wrote stays attributed.',
    ifNot: [],
    byHandNote: 'Creating an account with the form (one-time code) is done by hand.' },
  '5.2': { title: 'Roster import — three ways', group: 'people',
    do: ['Open <b>Roster import</b>.', 'Paste three lines — <em>name, ID, role</em> — or pick the office\'s CSV with the file button. Tap <b>Preview</b>.'],
    see: ['A file picker for the office\'s CSV; a paste box; the form at the top for one at a time.', 'The preview lists the three with their roles; problems, if any, are named line by line.', 'Confirm (one-time code) → three printable slips with first-time passwords.'],
    why: 'The shop\'s roster comes from a spreadsheet; it should not be retyped.',
    ifNot: [],
    byHandNote: 'Confirming the import is done by hand so the demonstration accounts stay as they are.' },
  '5.3': { title: 'What each role holds', group: 'people',
    do: ['Scroll to <b>What each role holds</b>.'],
    see: ['The capability table, <b>read-only</b>, with the note saying why: who may do what is fixed in the system. The administrator <b>cannot</b> release a wagon.', 'To change a person\'s access, change their role on their row.'],
    why: 'Roles are policy, not settings — nobody can grant themselves the exit gate.',
    ifNot: [] },
  '5.4': { title: 'Checklist rules', group: 'rules',
    do: ['<b>Checklist Rules</b>. Read the blue box. Pick a wagon type.', 'Add a shop line with a reason and a source; withdraw it.'],
    see: ['The blue box: <b>What it is · What you can do · When</b>.', 'The items per wagon type with their standard and expected quantity; a shop line can be added with a reason and where the figure comes from; each change recorded under your name.'],
    why: 'The exit gate enforces what this screen holds. The standard\'s items cannot be removed; the shop\'s own lines can be added and withdrawn — on the record.',
    ifNot: [] },
  '5.5': { title: 'The gauge register', group: 'rules',
    do: ['<b>User Accounts</b> → scroll to the bottom: <b>Gauge register</b>.'],
    see: ['Four gauges: ISG‑01, OSG‑01, OSG‑02 in calibration; <b>SSG‑02</b> with its certificate number <em>1251122‑04‑125</em> and <b>NOT RECORDED</b>.', 'The amber banner: how many readings were judged with an instrument whose calibration is not established.', 'The drift box, one line per finding: <em>OSG‑02 &amp; OSG‑01 · the two gauges on this kind disagree by 1.5 mm … put both against the master</em> — once for HS outer, once for NLB outer.', '<b>Record calibration</b> on SSG‑02 with the certificate\'s dates → the amber note on the bench goes.'],
    why: 'The instruments and their papers, transcribed from the real labels on the bench; a gauge drifting shows up from the record, not from a calibration visit.',
    ifNot: [],
    byHandNote: 'Recording SSG‑02\'s calibration is left undone in rehearsal so the bench keeps showing the amber note.' },
  '5.6': { title: 'Deployment readiness, first', group: 'rules',
    do: ['<b>DRM Dashboard</b> as the administrator. Tap <b>Check now</b>.'],
    see: ['<b>Deployment readiness</b> and <b>Storage</b> are the first two panels, before Shop Floor — Right Now.', 'Every row a plain sentence: backup, cloud copy, manual (each document named), <b>demo passwords</b> (red on the demonstration record, saying why they still sign in — SEED_DEMO_USERS), restarts, audit chain, storage.'],
    why: 'The administrator sees whether the PC is fit before anyone else sees a figure.',
    ifNot: ['Demo passwords green on the demo record: the .env line was removed — that is what production wants, but the demo accounts then cannot sign in.'] },
  '5.7': { title: 'Changing your password', group: 'account',
    do: ['Top right: <b>Password</b> (the key icon, labelled).'],
    see: ['The panel opens in full over the page — old password, new password, confirm — not cut off under the header.', 'After a change the old password stops working; the new one works. The same for every role.'],
    why: 'Every person can keep their own password without an administrator.',
    ifNot: [],
    byHandNote: 'The change itself is by hand; the demo password is left as it is.' },
  '5.8': { title: 'The authenticator', group: 'account',
    do: ['Top right: <b>Authenticator</b> (the shield icon, labelled) → <b>Start setup</b>.'],
    see: ['<b>Authenticator setup</b>: a QR to scan with an authenticator app and a box for the six-digit code.', 'A wrong code is refused; the right one enrols; sign-in then needs the code — and one-time codes for releases and overrides come from the app instead of the screen.'],
    why: 'For the shop the code can come from the person\'s own phone, with no network at all.',
    ifNot: [],
    byHandNote: 'Enrolling needs an authenticator app on a phone; left undone in rehearsal.' },
  '5.9': { title: 'Stores — add a part, restock', group: 'stores',
    do: ['<b>Stores &amp; Depot Inventory</b> → <b>+ Add a part</b> → code, name, category, bin → save.', 'Restock it by 10; try 1.5.'],
    see: ['The part appears in the list.', 'Restock 10 → the stock rises by 10; restock 1.5 → refused (whole units only).'],
    why: 'Stores can be kept up to date by the stores clerk without a programmer.',
    ifNot: [] },
  '5.10': { title: 'Component passports', group: 'stores',
    do: ['<b>Component Passports</b> → paste <code>WRS-PASSPORT|WHL-RWF-2023-8841|WHEELSET|RWF_YELAHANKA</code>.'],
    see: ['The wheelset\'s history across every wagon it was fitted to.'],
    why: 'A part\'s QR carries its identity; the record carries its life.',
    ifNot: [] },
  '5.11': { title: 'History &amp; logs', group: 'stores',
    do: ['<b>History &amp; Logs</b>. Pick a band or status; type part of a wagon number.', 'Top bar → <b>Export Audit Trail</b>.'],
    see: ['The list narrows at once; the count line says <em>N records matching …</em> with <b>Clear filters</b>.', 'Typing narrows as you type.', '<b>Export Audit Trail</b> asks for the one-time code before anything leaves.'],
    why: 'Everything is findable and nothing is exportable without a named person and a code.',
    ifNot: [] }
};

export const GROUPS = [
  ['people', 'People', '5.1 – 5.3', 'Sign in as admin1. Accounts, the roster, what each role holds.'],
  ['rules', 'Rules and instruments', '5.4 – 5.6', 'The checklist, the gauges, the PC\'s readiness.'],
  ['account', 'Your own account', '5.7 – 5.8', 'Password and authenticator — the same for every role.'],
  ['stores', 'Stores, passports, history', '5.9 – 5.11', 'What the administrator keeps for the shop.']
];
