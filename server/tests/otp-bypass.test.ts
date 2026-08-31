/**
 * The OTP bypass tokens, and where they are allowed to work
 * Indian Railways WRS Raipur
 *
 * The suites need a way to clear an OTP gate, so otpService honours
 * 'test_token_*' and 'valid_otp_token' — but only outside production, because
 * they are hardcoded strings in a public repository and anyone who has read
 * the source would otherwise be able to clear a supervisor gate on a live
 * deployment by sending one.
 *
 * That guard was written once and then not applied at a second site: the
 * audit-export route repeated the same strings inline, without it. These
 * tests exist so the rule lives in one place and stays there.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { otpService } from '../src/auth/otpService.ts';
import { config } from '../src/config/index.ts';

describe('Where a bypass token may be honoured', () => {
  it('is refused in production, whatever it says', () => {
    /*
     * The important one. These strings are public; if they work against a
     * live deployment then the OTP gate is decoration.
     */
    const previous = (config as any).nodeEnv;
    (config as any).nodeEnv = 'production';
    try {
      for (const token of ['test_token_override', 'test_token_anything', 'valid_otp_token', 'otp_tok_test_override']) {
        assert.equal(
          otpService.consumeActionToken(token, 'EXPORT'),
          false,
          `"${token}" must not clear an OTP gate in production`
        );
      }
    } finally {
      (config as any).nodeEnv = previous;
    }
  });

  it('is honoured outside production, so the suites can run', () => {
    const previous = (config as any).nodeEnv;
    (config as any).nodeEnv = 'test';
    try {
      assert.equal(otpService.consumeActionToken('test_token_override', 'EXPORT'), true);
    } finally {
      (config as any).nodeEnv = previous;
    }
  });

  it('refuses a token it has never issued', () => {
    const previous = (config as any).nodeEnv;
    (config as any).nodeEnv = 'production';
    try {
      assert.equal(otpService.consumeActionToken('made-up-token', 'EXPORT'), false);
      assert.equal(otpService.consumeActionToken('', 'EXPORT'), false);
    } finally {
      (config as any).nodeEnv = previous;
    }
  });
});

describe('The routes ask the service rather than repeating its rules', () => {
  it('no route re-implements a bypass string of its own', async () => {
    /*
     * The audit-export route checked `otpToken.startsWith('test_token_')`
     * itself, so the environment guard in otpService did not apply to it and
     * the gate could be cleared in production. A grep is a blunt test and
     * exactly the right one here: the defect was a copy of a string, and what
     * must be prevented is a second copy appearing.
     */
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.join(import.meta.dirname, '../src/routes');
    const offenders: string[] = [];

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue;
      const body = fs.readFileSync(path.join(dir, file), 'utf8');
      // Strip comments: the explanation of the old defect names the strings.
      const code = body
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (/test_token_|valid_otp_token|otp_tok_test_override/.test(code)) {
        offenders.push(file);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `these routes carry their own bypass string instead of asking otpService: ${offenders.join(', ')}`
    );
  });
});

describe('TOTP, once enrolled, governs every consequential act', () => {
  it('is required by the same rule wherever that rule is asked for', async () => {
    /*
     * The rule — an enrolled authenticator replaces the inline code — was
     * written inside the release-signoff handler and nowhere else, so a
     * supervisor with an authenticator could still clear a stage override
     * with the weaker mechanism, and an admin could still export the audit
     * trail with it. Overriding a stage, releasing a wagon and exporting the
     * record are the same order of consequence and should not have different
     * doors.
     *
     * Checked by asking the shared helper directly rather than by driving
     * three routes, because what must not drift is the rule, and the rule now
     * lives in one function.
     */
    const { verifySecondFactor } = await import('../src/auth/secondFactor.ts');
    const { DatabaseSync } = await import('node:sqlite');
    const { runMigrations } = await import('../src/db/migrations.ts');
    const { seedUsers } = await import('../src/db/seed.ts');
    const { TotpService } = await import('../src/auth/totpService.ts');

    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    seedUsers(db);

    const totp = new TotpService(db);
    const enrolment = totp.beginEnrolment('usr_sup_001');
    const { generateTotp } = await import('../src/auth/totp.ts');

    /*
     * Enrolment is confirmed with a code from the previous 30-second window,
     * so the current one is still usable below. Confirming with the current
     * code and then re-sending it is refused — correctly, since a code must
     * not be replayable inside its validity window — and that refusal is
     * what this test tripped over first.
     */
    const previousWindow = Math.floor(Date.now() / 1000) - 30;
    totp.confirmEnrolment('usr_sup_001', generateTotp(enrolment.secret, { now: previousWindow }));

    for (const action of ['OVERRIDE', 'EXPORT', 'SIGNOFF'] as const) {
      // The inline code is refused outright once enrolled.
      const withInline = verifySecondFactor(db, {
        userId: 'usr_sup_001',
        action: action as any,
        otpToken: 'test_token_override',
        describeAction: 'this act'
      });
      assert.equal(withInline.ok, false, `${action}: an enrolled signer must not use the inline code`);
      assert.equal(withInline.error, 'TOTP_REQUIRED');

      /*
       * The acceptance half is deliberately not asserted here.
       *
       * confirmEnrolment records the counter it has just seen, so the very
       * next code is refused as a replay until the 30-second window turns
       * over — correct and conservative, and not something to fake around
       * with a mocked clock just to make an assertion pass. Acceptance of a
       * valid code is covered where the TOTP service itself is tested; what
       * is specific to this change, and what had no coverage at all, is that
       * enrolment closes the weaker door on every one of these actions.
       */
      assert.match(
        withInline.message || '',
        /authenticator/i,
        `${action}: the refusal should tell the signer to use their authenticator`
      );
    }
  });

  it('never lowers the bar for somebody who has not enrolled', () => {
    /*
     * The first version of this helper verified the inline code itself for
     * unenrolled users — which made the override WEAKER, because the
     * lifecycle engine refuses a fabricated 'test_' token while otpService
     * honours one outside production. The adversarial suite caught it. It now
     * defers, and says so, so a caller cannot read ok:true as proof.
     */
    return (async () => {
      const { DatabaseSync } = await import('node:sqlite');
      const { runMigrations } = await import('../src/db/migrations.ts');
      const { seedUsers } = await import('../src/db/seed.ts');
      const { verifySecondFactor } = await import('../src/auth/secondFactor.ts');
      const db = new DatabaseSync(':memory:');
      runMigrations(db);
      seedUsers(db);

      const r = verifySecondFactor(db, {
        userId: 'usr_insp_001',
        action: 'OVERRIDE' as any,
        otpToken: 'anything-at-all',
        describeAction: 'this act'
      });
      assert.equal(r.ok, true, 'it does not block an unenrolled user');
      assert.equal(r.deferredToCaller, true, 'and it says it checked nothing');
    })();
  });
});
