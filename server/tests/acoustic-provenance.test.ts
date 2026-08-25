/**
 * Acoustic Signal Provenance Tests
 * Indian Railways WRS Raipur
 *
 * Two fabrication paths existed in the acoustic diagnostic:
 *
 *   1. The "Simulate Bearing Knock" preset injected a synthetic oscillator
 *      signal, and the resulting diagnosis — confidence 0.94, with a specific
 *      recommended action — could be logged against a real wagon, where it
 *      raised a genuine exit-gate blocker and was stored indistinguishably
 *      from a microphone reading.
 *
 *   2. When getUserMedia failed, the engine warned and carried on analysing
 *      nothing, reporting "spectrum nominal, subsystems clear" at 0.95
 *      confidence. A confident all-clear for a bearing nobody listened to,
 *      which is the dangerous direction for the failure to point.
 *
 * The engine itself needs a browser (AudioContext, getUserMedia), so what is
 * pinned here is the contract the server relies on: a stored diagnostic must
 * record what it was derived from, and the frame type must force callers to
 * say.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ENGINE = fs.readFileSync(
  new URL('../../client/src/utils/acousticEngine.ts', import.meta.url),
  'utf-8'
);
const TOOL = fs.readFileSync(
  new URL('../../client/src/components/SoundDiagnosticTool.tsx', import.meta.url),
  'utf-8'
);

describe('Acoustic Signal Provenance', () => {
  it('TC-ACO-01: every analysis frame declares where its audio came from', () => {
    assert.match(
      ENGINE,
      /signalSource:\s*'MICROPHONE'\s*\|\s*'SYNTHETIC'\s*\|\s*'NO_SIGNAL'/,
      'the frame type must carry provenance, so no caller can assume it'
    );
  });

  it('TC-ACO-02: a failed microphone is recorded as NO_SIGNAL, not as silence', () => {
    assert.match(ENGINE, /this\.micAvailable = false/, 'mic failure must be tracked');
    assert.match(
      ENGINE,
      /signalSource === 'NO_SIGNAL'/,
      'the no-signal case must be handled explicitly'
    );
  });

  it('TC-ACO-03: no signal yields no confidence and no all-clear', () => {
    // The specific regression: "Subsystems clear" at 0.95 from a dead mic.
    const branch = ENGINE.slice(ENGINE.indexOf("signalSource === 'NO_SIGNAL'"));
    const body = branch.slice(0, branch.indexOf('} else'));
    assert.match(body, /confidence = 0/, 'a reading with no signal cannot be confident');
    assert.match(body, /no acoustic assessment can be made/i);
  });

  it('TC-ACO-04: the engine no longer falls back to oscillator simulation on mic failure', () => {
    assert.doesNotMatch(
      ENGINE,
      /switching to internal oscillator simulation/,
      'a missing microphone must not be silently replaced by a synthetic source'
    );
  });

  it('TC-ACO-05: a defect can only be logged from a real microphone reading', () => {
    const fn = TOOL.slice(TOOL.indexOf('const handleLogDefect'));
    const guard = fn.slice(0, fn.indexOf('await api.logAcousticDiagnostic'));
    assert.match(
      guard,
      /signalSource !== 'MICROPHONE'/,
      'logging must be refused for synthetic or absent signals'
    );
    assert.match(guard, /return;/, 'and must actually stop before posting');
  });

  it('TC-ACO-06: the refusal explains which case it is', () => {
    // A supervisor seeing "cannot log" needs to know whether the microphone
    // is broken or they are looking at a training preset.
    const fn = TOOL.slice(TOOL.indexOf('const handleLogDefect'));
    const guard = fn.slice(0, fn.indexOf('await api.logAcousticDiagnostic'));
    assert.match(guard, /simulated training signal/i);
    assert.match(guard, /No microphone signal/i);
  });
});
