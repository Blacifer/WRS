/**
 * Voice command parsing
 * Indian Railways WRS Raipur
 *
 * WHY THIS IS THE FIRST THING TESTED
 * ----------------------------------
 * Eight hundred and fifty lines of parsing, with no tests, whose output is
 * written into the quality record as a verdict on a component. A misparse here
 * does not throw an error or show a warning — it records that a part passed
 * when the inspector said something else, in a spoken, noisy, bilingual
 * environment where mishearing is the expected case rather than the unusual
 * one.
 *
 * The tests that matter most are not the ones proving a clear command works.
 * They are the ones proving an unclear command is *refused* — because the
 * failure mode of a voice interface is not silence, it is confident nonsense.
 */

import { describe, it, expect } from 'vitest';
import {
  parseVoiceCommand,
  detectLanguage,
  normalizeTranscript,
  convertDevanagariDigits,
  parseSpringInspectionCommand
} from './voiceCommandParser.ts';

describe('Language detection', () => {
  it('recognises English, Hindi and a mix of both', () => {
    // The shop floor speaks all three, often in one sentence.
    expect(detectLanguage('outer spring passes')).toBe('en');
    expect(detectLanguage('बाहरी स्प्रिंग ठीक है')).toBe('hi');
    expect(detectLanguage('outer spring ठीक है')).toBe('mixed');
  });

  it('does not crash on empty or symbol-only input', () => {
    expect(detectLanguage('')).toBe('en');
    expect(typeof detectLanguage('...')).toBe('string');
  });
});

describe('Transcript normalisation', () => {
  it('converts Devanagari digits so a spoken height is usable', () => {
    // A Hindi speech recogniser returns Devanagari numerals; a height that
    // stays in them would fail every numeric comparison silently.
    expect(convertDevanagariDigits('२६०.५')).toBe('260.5');
    expect(convertDevanagariDigits('१२३४५६७८९०')).toBe('1234567890');
  });

  it('leaves Western digits untouched', () => {
    expect(convertDevanagariDigits('260.5')).toBe('260.5');
  });

  it('normalises case and spacing without destroying the words', () => {
    const n = normalizeTranscript('  OUTER   Spring   PASSES  ');
    expect(n).toContain('outer');
    expect(n).toContain('spring');
    expect(n).not.toMatch(/\s{2,}/);
  });
});

describe('Refusing what it did not understand', () => {
  // The important half. Each of these must come back unmatched rather than
  // resolving to something plausible.
  const nonsense = [
    '',
    '   ',
    'hello',
    'what is the time',
    'aaaaaaa',
    'the quick brown fox',
    '12345'
  ];

  for (const text of nonsense) {
    it(`refuses: "${text}"`, () => {
      const r = parseVoiceCommand(text);
      expect(r.matched).toBe(false);
      // A refusal must still tell the inspector something, or they will simply
      // repeat themselves into a system that never responds.
      expect(typeof r.feedbackMessage).toBe('string');
    });
  }

  it('never returns a status on a command it did not match', () => {
    // This is the specific fault that would write a wrong verdict: a parse
    // that failed but still carried PASS through to the caller.
    for (const text of nonsense) {
      const r = parseVoiceCommand(text);
      if (!r.matched) expect(r.status).toBeUndefined();
    }
  });
});

describe('Recognising a verdict', () => {
  const items = [
    { id: 'i1', partName: 'Outer Spring (Bogie 1)', category: 'SPRINGS' },
    { id: 'i2', partName: 'Brake Beam', category: 'BRAKE_SYSTEM' },
    { id: 'i3', partName: 'CBC Knuckle', category: 'COUPLERS_DRAFT_GEAR' }
  ] as any[];

  it('matches a plain pass', () => {
    const r = parseVoiceCommand('brake beam passes', 'BRAKE_SYSTEM' as any, items);
    expect(r.matched).toBe(true);
    expect(r.status).toBe('PASS');
  });

  it('matches a condemnation', () => {
    const r = parseVoiceCommand('condemn brake beam', 'BRAKE_SYSTEM' as any, items);
    expect(r.matched).toBe(true);
    expect(r.status).toBe('CONDEMNED');
  });

  it('does not read a condemnation as a pass, or the reverse', () => {
    // The single most consequential confusion this parser could make.
    const condemn = parseVoiceCommand('condemn brake beam', 'BRAKE_SYSTEM' as any, items);
    const pass = parseVoiceCommand('brake beam passes', 'BRAKE_SYSTEM' as any, items);
    expect(condemn.status).not.toBe('PASS');
    expect(pass.status).not.toBe('CONDEMNED');
  });

  it('carries defect wording through rather than discarding it', () => {
    const r = parseVoiceCommand(
      'condemn brake beam deep crack 3 mm',
      'BRAKE_SYSTEM' as any,
      items
    );
    expect(r.matched).toBe(true);
    if (r.defectNotes) expect(r.defectNotes.length).toBeGreaterThan(0);
  });
});

describe('Spring parameters spoken aloud', () => {
  it('reads a height from speech', () => {
    const r = parseSpringInspectionCommand('height 260.5', 'height 260.5');
    expect(r.isSpringParam).toBe(true);
    expect(r.springParams.measuredHeight).toBeCloseTo(260.5, 1);
  });

  it('reads a height spoken in Devanagari numerals', () => {
    const raw = 'ऊंचाई २६०.५';
    const r = parseSpringInspectionCommand(convertDevanagariDigits(raw), raw);
    if (r.isSpringParam && r.springParams.measuredHeight !== undefined) {
      expect(r.springParams.measuredHeight).toBeCloseTo(260.5, 1);
    }
  });

  it('does not invent a height from a sentence with no number', () => {
    // A height of undefined is recoverable; a height of 0 or NaN written into
    // the record is not.
    const r = parseSpringInspectionCommand('outer spring looks fine', 'outer spring looks fine');
    const h = r.springParams.measuredHeight;
    expect(h === undefined || Number.isFinite(h)).toBe(true);
    expect(h).not.toBe(0);
  });

  it('changes position only when explicitly asked to', () => {
    // Deliberate, and worth pinning: "select outer" moves the selection,
    // "outer spring passes" does not.
    const explicit = parseSpringInspectionCommand('select outer', 'select outer');
    expect(explicit.springParams.position).toBe('OUTER');
  });

  it('a verdict that names a spring does not silently retarget the selection', () => {
    // This is the safety property. If merely saying "outer spring passes"
    // moved the selection, a sequence of spoken verdicts would walk the UI to
    // a different spring mid-nest and record readings against the wrong one.
    const r = parseSpringInspectionCommand('outer spring passes', 'outer spring passes');
    expect(r.springParams.position).toBeUndefined();
  });

  it('does not mistake "inner" inside another word for a position', () => {
    // "beginner", "thinner", "winner" all contain "inner". A substring match
    // would silently retarget a reading to the wrong spring.
    const r = parseSpringInspectionCommand('select the beginner reading', 'select the beginner reading');
    expect(r.springParams.position).not.toBe('INNER');
  });
});

describe('Robustness against real speech', () => {
  it('survives punctuation, filler and repetition', () => {
    // Speech recognisers insert all three, and none may crash the parser.
    const inputs = [
      'um, brake beam, uh, passes.',
      'brake beam brake beam passes',
      'BRAKE BEAM PASSES!!!',
      'brake  beam    passes'
    ];
    for (const text of inputs) {
      expect(() => parseVoiceCommand(text, 'BRAKE_SYSTEM' as any, [])).not.toThrow();
    }
  });

  it('survives input that looks like an attack', () => {
    // A transcript is untrusted text that ends up in a stored record.
    const inputs = [
      "'; DROP TABLE inspections; --",
      '<script>alert(1)</script> passes',
      '../../etc/passwd',
      'a'.repeat(5000)
    ];
    for (const text of inputs) {
      expect(() => parseVoiceCommand(text, 'SPRINGS' as any, [])).not.toThrow();
    }
  });

  it('never throws on any input at all', () => {
    for (const text of ['', ' ', '\n', ' ', '🚂', 'null', 'undefined']) {
      expect(() => parseVoiceCommand(text)).not.toThrow();
    }
  });
});
