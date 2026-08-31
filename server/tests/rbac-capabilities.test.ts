/**
 * Who may do what, and who may not
 * Indian Railways WRS Raipur
 *
 * Access used to be a seniority number — INSPECTOR 1, SUPERVISOR 2, ADMIN 3 —
 * and a guard passed if your number was high enough. Two consequences nobody
 * would have asked for followed from that, and these tests exist to keep them
 * from coming back.
 *
 * An ADMIN cleared every SUPERVISOR guard, so the person who administers the
 * system could certify a wagon fit to run. And there was no DRM at all, so
 * the officer the system reports to logged in as ADMIN and thereby held the
 * power to create and deactivate accounts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  can,
  capabilitiesOf,
  isKnownRole,
  normaliseRole,
  ROLE_CAPABILITIES
} from '../../shared/auth/permissions.ts';

describe('Certifying a wagon', () => {
  it('is a supervisor’s act and nobody else’s', () => {
    /*
     * The single most important assertion in this file. Releasing a wagon
     * puts a named person behind the claim that it is fit to run; being able
     * to administer the system, or to oversee the division, is not a
     * qualification to make that claim.
     */
    assert.equal(can('SUPERVISOR', 'wagon.release'), true);
    assert.equal(can('ADMIN', 'wagon.release'), false, 'an administrator must not certify a wagon');
    assert.equal(can('DRM', 'wagon.release'), false, 'the DRM signs nothing');
    assert.equal(can('INSPECTOR', 'wagon.release'), false);
  });

  it('is not something seniority can reach around', () => {
    // The old model would answer true here for ADMIN purely on rank.
    const releasers = (['INSPECTOR', 'SUPERVISOR', 'ADMIN', 'DRM'] as const)
      .filter((r) => can(r, 'wagon.release'));
    assert.deepEqual(releasers, ['SUPERVISOR']);
  });
});

describe('Administration is the system, not the wagons', () => {
  it('lets only the admin manage accounts', () => {
    assert.equal(can('ADMIN', 'users.manage'), true);
    assert.equal(can('SUPERVISOR', 'users.manage'), false);
    assert.equal(can('DRM', 'users.manage'), false, 'oversight must not hold the account table');
    assert.equal(can('INSPECTOR', 'users.manage'), false);
  });

  it('keeps the DRM to reading', () => {
    /*
     * An officer recording a spring measurement under their own name would
     * attribute work to somebody who was not holding the part, and the audit
     * trail is only worth having if the name on a record is the person who
     * did it.
     */
    for (const cap of ['spring.record', 'wagon.inspect', 'wagon.override', 'system.configure'] as const) {
      assert.equal(can('DRM', cap), false, `DRM must not ${cap}`);
    }
    for (const cap of ['audit.read', 'analytics.read', 'certificate.export'] as const) {
      assert.equal(can('DRM', cap), true, `DRM must be able to ${cap}`);
    }
  });
});

describe('Refusing what it does not recognise', () => {
  it('answers false for a role it has never heard of', () => {
    for (const role of ['HACKER', '', null, undefined, 'root', 'SUPERUSER']) {
      assert.equal(can(role as any, 'wagon.release'), false, `role ${JSON.stringify(role)}`);
    }
  });

  it('answers false for a capability that does not exist', () => {
    /*
     * The old numeric model did the opposite: an unrecognised requirement
     * scored zero, and every user clears zero, so one typo in a guard would
     * have opened a route to everybody.
     */
    assert.equal(can('ADMIN', 'wagon.destroy' as any), false);
    assert.equal(can('SUPERVISOR', 'wagon.releaes' as any), false, 'a typo must refuse, not admit');
  });

  it('reads a role however it was written down', () => {
    // A real roster is typed by hand. "Admin" and "admin" are the same job.
    for (const spelling of ['SUPERVISOR', 'Supervisor', 'supervisor', '  supervisor  ']) {
      assert.equal(can(spelling, 'wagon.release'), true, `spelling ${JSON.stringify(spelling)}`);
    }
    assert.equal(normaliseRole('  Admin '), 'ADMIN');
    assert.equal(isKnownRole('drm'), true);
    assert.equal(isKnownRole('nightwatchman'), false);
  });
});

describe('The matrix as a whole', () => {
  it('gives every role something to do and nobody everything', () => {
    for (const role of Object.keys(ROLE_CAPABILITIES)) {
      assert.ok(capabilitiesOf(role).length > 0, `${role} holds no capabilities`);
    }
    const everything = new Set(Object.values(ROLE_CAPABILITIES).flat());
    for (const role of Object.keys(ROLE_CAPABILITIES)) {
      assert.ok(
        capabilitiesOf(role).length < everything.size,
        `${role} holds every capability there is — that is a superuser, not a role`
      );
    }
  });

  it('keeps the shop floor with the people on it', () => {
    // An inspector must be able to do the job the pilot exists for.
    for (const cap of ['spring.record', 'spring.correct', 'wagon.inspect', 'wagon.photograph'] as const) {
      assert.equal(can('INSPECTOR', cap), true, `an inspector must be able to ${cap}`);
      assert.equal(can('SUPERVISOR', cap), true, `a supervisor must be able to ${cap} too`);
    }
  });
});
