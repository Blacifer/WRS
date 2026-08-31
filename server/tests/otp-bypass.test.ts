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
