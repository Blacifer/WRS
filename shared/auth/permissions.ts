/**
 * Who may do what
 * Indian Railways WRS Raipur
 *
 * WHY A MATRIX AND NOT A LADDER
 * -----------------------------
 * Access used to be a seniority number: INSPECTOR 1, SUPERVISOR 2, ADMIN 3,
 * and a guard passed if your number was high enough. That is a model of
 * rank, not of responsibility, and it produced two things nobody would have
 * asked for.
 *
 * An ADMIN cleared every SUPERVISOR guard, so the person who administers the
 * system could certify a wagon fit to run. Signing a release is a
 * professional act with a name attached to it; being able to create user
 * accounts is not a qualification to perform it.
 *
 * And there was no DRM. The officer the whole system reports to logged in as
 * ADMIN, which handed an oversight role the power to create accounts,
 * deactivate inspectors and edit stores inventory. Oversight and
 * administration are different jobs, and a divisional officer holding the
 * keys to the account table is the kind of detail an audit asks about.
 *
 * So permissions are now named, and each role holds a set of them. Seniority
 * is gone: a capability a role does not hold is one it cannot exercise,
 * however senior it is.
 */

/** The four real jobs. Stored uppercase; see normaliseRole for input handling. */
export type Role = 'INSPECTOR' | 'SUPERVISOR' | 'ADMIN' | 'DRM';

/**
 * Things a person can do, named for the act rather than the screen.
 *
 * Named this way because screens move and get renamed, while "may certify a
 * wagon fit to leave the workshop" is a fact about a job that outlives any
 * particular button.
 */
export type Capability =
  // Shop floor
  | 'spring.record'          // measure and classify springs
  | 'spring.correct'         // withdraw a mistapped spring
  | 'wagon.inspect'          // record checklist verdicts
  | 'wagon.photograph'       // attach photographic evidence
  | 'wagon.view'             // look at wagons and their history without touching them
  // Supervisory
  | 'wagon.release'          // certify a wagon fit to leave — the consequential one
  | 'wagon.override'         // move a wagon past a stage against the rules, with justification
  | 'checklist.configure'    // change what the exit gate enforces
  | 'stores.manage'          // issue, restock and reserve parts
  | 'learning.approve'       // accept a proposed parameter change
  // Oversight — reading, never signing
  | 'audit.read'
  | 'analytics.read'         // the strategic dashboards — deliberately not a supervisor's
  | 'learning.view'
  | 'certificate.export'
  // System administration
  | 'users.manage'
  | 'system.configure';

const INSPECTOR: Capability[] = [
  'spring.record',
  'spring.correct',
  'wagon.inspect',
  'wagon.photograph'
  /*
   * Deliberately no wagon.view. An inspector reaches a wagon only through one
   * they have actually selected, which canAccessTab handles as an explicit
   * exception. Granting the capability instead would have opened the wagon
   * pipeline and the component passports to them, which is a widening nobody
   * asked for.
   */
];

/*
 * A supervisor does everything an inspector does and is additionally the only
 * role that can certify a wagon. That is deliberate and is the single most
 * important line in this file.
 */
const SUPERVISOR: Capability[] = [
  ...INSPECTOR,
  'wagon.view',
  'wagon.release',
  'wagon.override',
  'stores.manage',
  'learning.approve',
  'learning.view',
  'audit.read',
  'certificate.export'
  /*
   * No analytics.read. The DRM dashboard and the spring analytics are the
   * divisional view, and that separation predates this matrix — a supervisor
   * runs the shop and reads its history, an officer reads the division. Kept
   * because it was a decision, not an oversight.
   */
];

/*
 * The DRM sees everything and signs nothing.
 *
 * Deliberately holds no shop-floor capabilities either: an officer recording
 * a spring measurement under their own name would be attributing work to
 * somebody who did not do it, and the audit trail is only worth having if the
 * name on a record is the person who was holding the part.
 */
const DRM: Capability[] = [
  'wagon.view',
  'audit.read',
  'analytics.read',
  'learning.view',
  'certificate.export'
];

/*
 * Administration is the system, not the wagons.
 *
 * No wagon.release and no wagon.override — an administrator can create the
 * account that certifies a wagon and cannot certify one themselves. No
 * shop-floor capabilities for the same reason as the DRM.
 */
const ADMIN: Capability[] = [
  'wagon.view',
  'users.manage',
  'system.configure',
  'checklist.configure',
  'audit.read',
  'analytics.read',
  'certificate.export',
  'stores.manage',
  'learning.approve',
  'learning.view'
];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  INSPECTOR, SUPERVISOR, ADMIN, DRM
};

/** Reduces however a role was written to the one spelling this file knows. */
export function normaliseRole(role: string | null | undefined): string {
  return String(role ?? '').trim().toUpperCase();
}

/** Whether this role is one the system recognises at all. */
export function isKnownRole(role: string | null | undefined): role is Role {
  return normaliseRole(role) in ROLE_CAPABILITIES;
}

/**
 * Whether a role may perform a capability.
 *
 * Unknown roles and unknown capabilities both answer false. A guard naming a
 * capability that does not exist must refuse everyone rather than admit
 * everyone, which is what the old numeric comparison did when it met a name
 * it did not have.
 */
export function can(role: string | null | undefined, capability: Capability): boolean {
  const key = normaliseRole(role);
  if (!(key in ROLE_CAPABILITIES)) return false;
  return ROLE_CAPABILITIES[key as Role].includes(capability);
}

/** Every capability a role holds — for showing a person what they can do. */
export function capabilitiesOf(role: string | null | undefined): readonly Capability[] {
  const key = normaliseRole(role);
  return key in ROLE_CAPABILITIES ? ROLE_CAPABILITIES[key as Role] : [];
}
