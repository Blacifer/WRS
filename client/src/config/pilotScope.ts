/**
 * What the pilot shows
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * The DRM asked for two things: spring inspection at roughly 900 a day, and a
 * wagon that cannot leave with anything outstanding. What got built around
 * those is a stores inventory, a component passport ledger, learning
 * dashboards and an analytics suite — each individually defensible, and
 * together enough to make a five-screen job look like an ERP.
 *
 * The first person to open the app said so plainly: it feels like inventory
 * software, and it is miles from what was asked for. They were right, and the
 * evidence was in the navigation — a supervisor's eye landed on Stores and
 * Component Passports before it reached anything to do with springs.
 *
 * So the pilot runs narrow. Three things an inspector or supervisor can do:
 * sort springs, work a wagon's checklist, and pass or fail its exit gate.
 *
 * NOTHING IS DELETED
 * ------------------
 * Every other module still exists, still works, still has its tests. They are
 * out of the shop-floor navigation, not out of the codebase, and an admin can
 * still reach them. Turning this flag off restores the full navigation
 * exactly as it was.
 *
 * That distinction matters: this is a decision about what to put in front of
 * an inspector during a pilot, which is reversible in one line, and not a
 * decision to throw work away.
 */

export const PILOT_SCOPE = {
  /**
   * Narrow the shop-floor navigation to the pilot's three jobs.
   *
   * Set to false to restore every module to the navigation.
   */
  enabled: true,

  /**
   * Kept visible for everyone, because each earns its place on the floor:
   *
   *   wagons          the wagon itself — its checklist and its exit gate
   *   spring_sorting  the ~900/day job
   *   inspection      a single spring, when one needs doing on its own
   *   smart_vision    the batch flow for a wagon's own springs
   *   manual          the manual, for the person holding the component
   *   audit           proving the records are intact, two clicks
   */
  shopFloorTabs: [
    'inspector_home',
    'wagons',
    'spring_sorting',
    'inspection',
    'smart_vision',
    'manual',
    'audit'
  ] as const
};

/**
 * Whether a tab belongs in the navigation for this user.
 *
 * Admins keep everything: somebody has to be able to reach the stores ledger
 * and the account screens, and an admin is not the person the narrowing is
 * for.
 */
export function isInPilotNav(tab: string, role: string | undefined): boolean {
  if (!PILOT_SCOPE.enabled) return true;
  /*
   * The narrowing exists to keep the SHOP FLOOR uncluttered during the pilot,
   * so the roles that are not on the shop floor are not narrowed.
   *
   * DRM was missing from this line, which would have left an oversight
   * account holding the dashboard and the analytics capabilities and no way
   * to reach either — the two screens that are the entire reason the role
   * exists.
   */
  const r = role?.toUpperCase();
  if (r === 'ADMIN' || r === 'DRM') return true;
  return (PILOT_SCOPE.shopFloorTabs as readonly string[]).includes(tab);
}
