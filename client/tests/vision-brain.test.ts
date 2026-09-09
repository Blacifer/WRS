/**
 * The camera's judgement, tested where it can be tested
 * Indian Railways WRS Raipur
 *
 * These tests use made-up embeddings, not photographs, and that is deliberate:
 * what is under test here is the judgement laid over the comparison — when it
 * answers, when it refuses to, how it weighs disagreement, and whether its own
 * accuracy figure is honest. None of that depends on MobileNet being any good.
 *
 * Whether MobileNet is any good on THIS shop's springs is a different question
 * and cannot be answered by a test. It is answered by
 * scripts/vision-brain-proof.mjs, which runs the real model in a real browser
 * on real images, and ultimately by the leave-one-out score on the shop's own
 * photographs. Passing these tests is not evidence the camera works.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  VisionBrain,
  l2Normalise,
  similarity,
  encodeEmbedding,
  decodeEmbedding,
  gradeAccuracy,
  SIMILARITY_FLOOR,
  CONFIDENCE_FLOOR,
  MIN_EXAMPLES,
  type BrainExample
} from '../src/services/visionBrain.ts';

const DIMS = 1280;

/**
 * A vector pointing in a chosen direction, with controllable noise.
 *
 * The noise scale matters and is not arbitrary. Spread over 1280 dimensions,
 * per-element noise of n accumulates to a vector of magnitude about 10n, so
 * n = 0.04 puts two same-class examples at a cosine of roughly 0.92 and two
 * different-class examples near zero. That is the range real MobileNet
 * embeddings actually occupy for photographs of the same and different
 * objects; picking a larger number here would make every class overlap and
 * would be testing the fixture rather than the brain.
 */
function vec(axis: number, noise = 0, seed = 1): Float32Array {
  const v = new Float32Array(DIMS);
  v[axis] = 1;
  let s = seed;
  for (let i = 0; i < DIMS; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    v[i] += ((s / 2147483648) - 0.5) * noise;
  }
  return l2Normalise(v);
}

function ex(head: any, label: string, embedding: Float32Array, id = crypto.randomUUID()): BrainExample {
  return { id, domain: 'SPRING', head, label, embedding };
}

/** n examples of one label, clustered around one direction. */
function cluster(label: string, axis: number, n: number, noise = 0.04): BrainExample[] {
  return Array.from({ length: n }, (_, i) => ex('CATEGORY', label, vec(axis, noise, i + axis * 1000)));
}

describe('embedding arithmetic', () => {
  it('TC-VB-01 normalises to unit length, so similarity is a plain dot product', () => {
    const v = l2Normalise(new Float32Array([3, 4, 0]));
    expect(v[0]).toBeCloseTo(0.6, 5);
    expect(v[1]).toBeCloseTo(0.8, 5);
    expect(similarity(v, v)).toBeCloseTo(1, 5);
  });

  it('TC-VB-02 survives the round trip to the form stored in the database', () => {
    const v = vec(7, 0.3, 42);
    const back = decodeEmbedding(encodeEmbedding(v));
    expect(back.length).toBe(DIMS);
    // Not "close to" — this must be bit-exact, or the camera would slowly
    // disagree with itself across a restore.
    for (let i = 0; i < DIMS; i++) expect(back[i]).toBe(v[i]);
  });

  it('TC-VB-03 refuses to compare vectors of different lengths', () => {
    expect(similarity(new Float32Array([1, 0]), new Float32Array([1, 0, 0]))).toBe(-1);
  });
});

describe('when it refuses to answer', () => {
  it('TC-VB-04 says nothing at all until it has seen two kinds of thing', () => {
    const brain = new VisionBrain(cluster('OUTER', 0, 30));
    const p = brain.predict('CATEGORY', vec(0, 0.04, 999));
    expect(p.label).toBeNull();
    expect(p.reason).toMatch(/at least 2/i);
  });

  it('TC-VB-05 says nothing until it has enough examples, however clear they are', () => {
    const brain = new VisionBrain([
      ...cluster('OUTER', 0, 3),
      ...cluster('INNER', 400, 3)
    ]);
    expect(brain.examples('CATEGORY').length).toBeLessThan(MIN_EXAMPLES);
    expect(brain.predict('CATEGORY', vec(0, 0.04, 5)).label).toBeNull();
  });

  it('TC-VB-06 refuses a part it has never seen rather than naming the nearest spring', () => {
    // The failure this exists to stop: a brain that knows only springs, shown
    // a brake block, would still have a "nearest" example and would answer
    // confidently from a vote alone.
    const brain = new VisionBrain([
      ...cluster('OUTER', 0, 20),
      ...cluster('INNER', 400, 20)
    ]);
    const stranger = vec(900, 0.04, 77);
    const p = brain.predict('CATEGORY', stranger);
    expect(p.label).toBeNull();
    expect(p.neighbours[0].similarity).toBeLessThan(SIMILARITY_FLOOR);
    expect(p.reason).toMatch(/does not look like anything/i);
  });

  it('TC-VB-07 refuses when the near neighbours disagree, and names the disagreement', () => {
    // A frame sitting exactly between two taught classes. Both are close, so
    // the similarity floor is passed and only the confidence floor can catch
    // it — which is why both floors exist.
    //
    // Built to be exactly equidistant and interleaved, so the five nearest are
    // a three-two split every time rather than whenever the noise happens to
    // fall that way. That split is the closest a two-class case can come to a
    // tie, and it is precisely the case a floor of 0.6 would have waved
    // through.
    const axisA = new Float32Array(DIMS);
    const axisB = new Float32Array(DIMS);
    axisA[0] = 1;
    axisB[1] = 1;
    const between = l2Normalise(new Float32Array(axisA.map((v, i) => v + axisB[i])));

    const interleaved: BrainExample[] = [];
    for (let i = 0; i < 5; i++) {
      interleaved.push(ex('CATEGORY', 'OUTER', l2Normalise(axisA.slice()), `o${i}`));
      interleaved.push(ex('CATEGORY', 'INNER', l2Normalise(axisB.slice()), `i${i}`));
    }

    const p = new VisionBrain(interleaved).predict('CATEGORY', between);
    expect(p.neighbours[0].similarity).toBeGreaterThan(SIMILARITY_FLOOR);
    expect(p.label).toBeNull();
    expect(p.confidence).toBeLessThan(CONFIDENCE_FLOOR);
    expect(p.confidence).toBeCloseTo(0.6, 2);
    expect(p.reason).toMatch(/disagree/i);
    expect(p.reason).toMatch(/OUTER/);
    expect(p.reason).toMatch(/INNER/);
  });
});

describe('when it does answer', () => {
  it('TC-VB-08 names a clearly separated class and shows which photographs said so', () => {
    const brain = new VisionBrain([
      ...cluster('OUTER', 0, 20),
      ...cluster('INNER', 400, 20),
      ...cluster('SNUBBER', 800, 20)
    ]);
    const p = brain.predict('CATEGORY', vec(400, 0.04, 12345));
    expect(p.label).toBe('INNER');
    expect(p.confidence).toBeGreaterThanOrEqual(CONFIDENCE_FLOOR);
    // The provenance is the point: an inspector defending a condemnation can
    // be shown the exact examples that produced the answer.
    expect(p.neighbours.length).toBeGreaterThan(0);
    expect(p.neighbours[0].label).toBe('INNER');
  });

  it('TC-VB-09 lets one near example outweigh several distant ones of a commoner class', () => {
    // A real shop sees far more outer springs than snubbers. A plain count of
    // neighbours would let the common class win on numbers alone, which is the
    // failure mode weighting by similarity exists to prevent.
    const near = vec(500, 0.01, 3);
    const brain = new VisionBrain([
      ...Array.from({ length: 40 }, (_, i) => ex('CATEGORY', 'OUTER', vec(0, 0.04, i))),
      ...Array.from({ length: 8 }, (_, i) => ex('CATEGORY', 'SNUBBER', vec(500, 0.02, i + 90)))
    ]);
    const p = brain.predict('CATEGORY', near);
    expect(p.label).toBe('SNUBBER');
  });

  it('TC-VB-10 reports the thinnest class, not the flattering total', () => {
    // Labels only. Building two thousand real embeddings to check a counting
    // rule spent 2.6 million loop iterations and timed the test out under
    // load, which taught nothing about the rule.
    const shared = vec(0, 0.04, 1);
    const many = Array.from({ length: 2000 }, (_, i) => ex('CATEGORY', 'OUTER', shared, `o${i}`));
    const few = Array.from({ length: 11 }, (_, i) => ex('CATEGORY', 'SNUBBER', shared, `s${i}`));

    const brain = new VisionBrain([...many, ...few]);
    expect(brain.examples('CATEGORY').length).toBe(2011);
    expect(brain.thinnestClass('CATEGORY')).toEqual({ label: 'SNUBBER', count: 11 });
  });

  it('TC-VB-11 keeps the heads independent — a taught CATEGORY teaches DAMAGE nothing', () => {
    const brain = new VisionBrain([
      ...cluster('OUTER', 0, 20),
      ...cluster('INNER', 400, 20)
    ]);
    expect(brain.predict('CATEGORY', vec(0, 0.04, 1)).label).toBe('OUTER');
    expect(brain.predict('DAMAGE', vec(0, 0.04, 1)).label).toBeNull();
  });
});

describe('the accuracy it reports about itself', () => {
  it('TC-VB-12 scores leave-one-out, never against the example itself', () => {
    // Proof it is genuinely holding the example out: a lone example of its
    // class must be scored by the OTHERS, which cannot know it, rather than
    // matching itself perfectly.
    const lone = ex('CATEGORY', 'SNUBBER', vec(800, 0.01, 1), 'lone');
    const brain = new VisionBrain([...cluster('OUTER', 0, 20), lone, ...cluster('INNER', 400, 20)]);
    const self = brain.predict('CATEGORY', lone.embedding, 'lone');
    expect(self.neighbours.every((n) => n.exampleId !== 'lone')).toBe(true);
  });

  it('TC-VB-13 counts abstentions apart from mistakes', () => {
    // Folding "I do not know" into the error rate would push the thresholds
    // towards a camera that guesses, which is the opposite of what is wanted.
    const brain = new VisionBrain([
      ...cluster('OUTER', 0, 20),
      ...cluster('INNER', 400, 20),
      ...Array.from({ length: 4 }, (_, i) => ex('CATEGORY', 'ODDITY', vec(900 + i * 60, 0.01, i)))
    ]);
    const acc = brain.evaluate('CATEGORY');
    expect(acc.abstained).toBeGreaterThan(0);
    expect(acc.correct + acc.wrong).toBe(acc.answered);
    expect(acc.taught).toBe(acc.answered + acc.abstained);
    expect(acc.accuracy).toBe(acc.answered > 0 ? acc.correct / acc.answered : 0);
  });

  it('TC-VB-14 scores well-separated classes highly and reports the confusion', () => {
    const brain = new VisionBrain([
      ...cluster('OUTER', 0, 20),
      ...cluster('INNER', 400, 20),
      ...cluster('SNUBBER', 800, 20)
    ]);
    const acc = brain.evaluate('CATEGORY');
    expect(acc.answered).toBeGreaterThanOrEqual(30);
    expect(acc.accuracy).toBeGreaterThan(0.9);
    expect(acc.confusion.OUTER?.OUTER).toBeGreaterThan(0);
  });

  it('TC-VB-15 will not grade itself at all below thirty answers', () => {
    expect(gradeAccuracy(29, 1.0)).toBe('INSUFFICIENT');
    expect(gradeAccuracy(30, 0.96)).toBe('ASSIST');
    expect(gradeAccuracy(30, 0.85)).toBe('FLAG_ONLY');
    expect(gradeAccuracy(30, 0.7)).toBe('STOP');
  });

  it('TC-VB-16 uses the same three thresholds as the blind spring read', () => {
    // Deliberately identical to sortingRepository.blindReadAgreement. A
    // threshold chosen after seeing the result is not a threshold, and two
    // different sets of numbers for the same decision invites picking the
    // kinder one.
    expect(gradeAccuracy(100, 0.95)).toBe('ASSIST');
    expect(gradeAccuracy(100, 0.9499)).toBe('FLAG_ONLY');
    expect(gradeAccuracy(100, 0.8)).toBe('FLAG_ONLY');
    expect(gradeAccuracy(100, 0.7999)).toBe('STOP');
  });
});

describe('adapting to the machine it actually finds', () => {
  it('TC-VB-17 crops the middle when the detector is not affordable, not the whole frame', async () => {
    // Most of a shed photograph is floor. Falling back to the WHOLE frame
    // would let the backdrop dominate the comparison, which is the single
    // failure the crop step exists to prevent — so the fallback is still a
    // crop, just a less clever one.
    const { centreCrop } = await import('../src/services/visionBrain.ts');
    const frame = document.createElement('canvas');
    frame.width = 1280;
    frame.height = 720;

    const crop = centreCrop(frame, 1280, 720);
    expect(crop.width).toBe(crop.height);
    expect(crop.width).toBe(Math.round(720 * 0.72));
    expect(crop.width).toBeLessThan(720);
  });

  it('TC-VB-18 judges the machine on the step it has to run anyway', async () => {
    // Measured, not chosen. A detector pass costs about twice an embedding, so
    // an embedding inside this budget puts the pair near a second. Above it,
    // the detector was never affordable and must never be loaded — timing the
    // DETECTOR instead was the original design and it failed in the browser,
    // because a timeout around a load does not stop the load: the abandoned
    // 18 MB kept churning on the same thread the fallback then needed.
    const m = await import('../src/services/visionBrain.ts');
    expect(m.EMBED_BUDGET_MS).toBeLessThanOrEqual(500);
    expect(m.EMBED_BUDGET_MS).toBeGreaterThan(100);
  });

  it('TC-VB-19 has not decided anything about the machine before it has looked', async () => {
    const m = await import('../src/services/visionBrain.ts');
    m.resetDetectorViability();
    expect(m.detectorIsBeingUsed()).toBeNull();
  });
});

describe('a teaching made while the network is away', () => {
  beforeEach(async () => {
    const { clearUnsent } = await import('../src/services/visionBrain.ts');
    clearUnsent();
  });

  it('TC-VB-20 is kept rather than lost, and sent on the next load', async () => {
    const m = await import('../src/services/visionBrain.ts');
    m.rememberUnsent({
      domain: 'SPRING', head: 'CATEGORY', label: 'OUTER',
      embedding: 'AAAA', proposedLabel: null, confidence: null,
      at: new Date().toISOString()
    });
    expect(m.readUnsent().length).toBe(1);

    const seen: string[] = [];
    const res = await m.flushUnsent(async (t) => { seen.push(t.label); });
    expect(seen).toEqual(['OUTER']);
    expect(res).toEqual({ sent: 1, kept: 0 });
    expect(m.readUnsent().length).toBe(0);
  });

  it('TC-VB-21 keeps what the network refused to carry, and retries it', async () => {
    // A queue that empties itself by discarding work is worse than one that
    // stays visibly full — the same rule the main offline queue follows.
    const m = await import('../src/services/visionBrain.ts');
    for (const label of ['OUTER', 'INNER']) {
      m.rememberUnsent({
        domain: 'SPRING', head: 'CATEGORY', label,
        embedding: 'AAAA', proposedLabel: null, confidence: null,
        at: new Date().toISOString()
      });
    }
    const res = await m.flushUnsent(async () => {
      throw Object.assign(new Error('offline'), { status: 0 });
    });
    expect(res).toEqual({ sent: 0, kept: 2 });
    expect(m.readUnsent().length).toBe(2);
  });

  it('TC-VB-22 drops what the server refused as a decision, not a failure', async () => {
    // A 4xx will be refused again on every retry. Keeping it would mean a
    // backlog that never drains and a warning that never goes away.
    const m = await import('../src/services/visionBrain.ts');
    m.rememberUnsent({
      domain: 'SPRING', head: 'CATEGORY', label: 'BAD',
      embedding: 'not-an-embedding', proposedLabel: null, confidence: null,
      at: new Date().toISOString()
    });
    const res = await m.flushUnsent(async () => {
      throw Object.assign(new Error('validation'), { status: 400 });
    });
    expect(res).toEqual({ sent: 0, kept: 0 });
    expect(m.readUnsent().length).toBe(0);
  });

  it('TC-VB-23 is bounded, so a tablet offline for a month cannot fill the disk', async () => {
    // This one found a real fault rather than only guarding one. Keeping the
    // backlog as a single JSON array meant every tap re-serialised the whole
    // thing — quadratic, and slow enough at 200 entries to time the test out.
    // It is one key per teaching now, and this fills it past the cap to prove
    // both the bound and that a write stayed cheap.
    const m = await import('../src/services/visionBrain.ts');
    for (let i = 0; i < m.MAX_UNSENT + 40; i++) {
      m.rememberUnsent({
        domain: 'SPRING', head: 'CATEGORY', label: `L${i}`,
        embedding: 'AAAA', proposedLabel: null, confidence: null,
        at: new Date().toISOString()
      });
    }
    const kept = m.readUnsent();
    expect(kept.length).toBe(m.MAX_UNSENT);
    // Oldest out, not newest — a recent teaching is worth more than a stale one.
    expect(kept[kept.length - 1].label).toBe(`L${m.MAX_UNSENT + 39}`);
  });
});
