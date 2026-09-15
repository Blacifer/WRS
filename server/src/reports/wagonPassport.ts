/**
 * The wagon passport — a wagon's record, carried with the wagon
 * Indian Railways WRS Raipur
 *
 * THE PROBLEM
 * -----------
 * A wagon overhauled here goes on to run for years and comes back to a
 * workshop — this one or another — for its next POH. What that shop knows of
 * the last overhaul is whatever paper travelled with the wagon, which is to
 * say the release certificate, if it survived. Every spring height, every
 * verdict, every part that came off and went back, every photograph's hash,
 * every stage timestamp, stays in this shop's database, and no other shop's
 * software can read it even if it were sent.
 *
 * WHAT THIS IS
 * ------------
 * A file. JSON Lines, so it can be read by a person with a text editor and
 * by a program one line at a time:
 *
 *   line 1      PASSPORT — the wagon, the issuing shop, its public key and the
 *               key's fingerprint, when and by whom it was exported
 *   lines 2..N  EVENT — one per thing that happened, in time order, each
 *               carrying the SHA-256 of the previous line's canonical form
 *               and its own, so no line can be removed, reordered or altered
 *               without every later hash failing
 *   last line   SEAL — the number of events, the terminal hash, and an
 *               Ed25519 signature over wagon|exportedAt|count|terminalHash
 *               by the issuing shop's certificate key
 *
 * The receiving shop verifies the chain and the signature against the public
 * key IN THE FILE — which proves the file was sealed by whoever holds the
 * private half of that key, and has not changed since. Whether that key is
 * WRS Raipur's is a separate question, answered by comparing the fingerprint
 * with the one WRS Raipur publishes (on every certificate, and at
 * /api/audit/certificate-key). The import records the fingerprint and says
 * plainly whether it matches this server's own; it does not decide trust.
 *
 * No photograph bytes travel — only their hashes, which the issuing shop's
 * rows and audit chain also carry. Nothing personal beyond the names already
 * printed on the release certificate.
 *
 * Federation without a central server: the wagon carries its own proof.
 */

import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { WagonRepository } from '../db/wagonRepository.ts';
import { InspectionRepository } from '../db/repository.ts';
import { PartLedgerRepository } from '../db/partLedgerRepository.ts';
import { signCertificate, verifyCertificate, certificatePublicKeyPem, certificateKeyFingerprint, SIGNATURE_ALGORITHM } from './certificateSigning.ts';

export const PASSPORT_VERSION = 1;
export const ISSUER_NAME = 'Indian Railways — Wagon Repair Shop, Raipur';

export type PassportEventKind =
  | 'REGISTERED' | 'STAGE_TRANSITION' | 'SPRING_INSPECTION' | 'CHECKLIST_VERDICT'
  | 'PART_EVENT' | 'SINGLE_WAGON_TEST' | 'PHOTO' | 'GATE_SIGNOFF' | 'CERTIFICATE';

export interface PassportEvent {
  type: 'EVENT';
  seq: number;
  kind: PassportEventKind;
  at: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface PassportHeader {
  type: 'PASSPORT';
  version: number;
  wagonNumber: string;
  wagonType: string;
  owningRailway: string;
  issuer: { name: string; keyFingerprint: string; publicKeyPem: string; algorithm: string };
  exportedAt: string;
  exportedBy: { id: string; name: string; role: string };
}

export interface PassportSeal {
  type: 'SEAL';
  events: number;
  terminalHash: string;
  signed: string;
  signature: string;
}

/**
 * JSON with keys in a fixed order, so two machines hash the same bytes.
 *
 * Follows JSON.stringify's own rules for what is not representable — an
 * undefined property is omitted, an undefined array element is null — so
 * that an object hashed before it was written and the same object parsed
 * back from the file give the same bytes. The first version rendered
 * undefined as the word, and a payload field that happened to be undefined
 * made a freshly built passport fail its own verification.
 */
export function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v === undefined ? null : v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const GENESIS = 'GENESIS';

function eventHash(prevHash: string, seq: number, kind: string, at: string, payload: unknown): string {
  return sha256(`${prevHash}|${canonical({ seq, kind, at, payload })}`);
}

export function sealText(wagonNumber: string, exportedAt: string, events: number, terminalHash: string): string {
  return `${wagonNumber}|${exportedAt}|${events}|${terminalHash}`;
}

/**
 * Everything this shop did to the wagon, as events in time order.
 */
export function collectEvents(db: DatabaseSync, wagonNumber: string): Array<{ kind: PassportEventKind; at: string; payload: Record<string, unknown> }> {
  const wagonRepo = new WagonRepository(db);
  const inspections = new InspectionRepository(db);
  const parts = new PartLedgerRepository(db);
  const wagon = wagonRepo.getWagonByNumber(wagonNumber);
  if (!wagon) throw new Error(`Wagon ${wagonNumber} not found.`);
  const w = wagon.wagonNumber;
  const out: Array<{ kind: PassportEventKind; at: string; payload: Record<string, unknown> }> = [];

  out.push({ kind: 'REGISTERED', at: wagon.entryDate || wagon.createdAt, payload: {
    wagonNumber: w, wagonType: wagon.wagonType, owningRailway: wagon.owningRailway, entryNotes: wagon.entryNotes ?? null, targetReleaseDate: wagon.targetReleaseDate ?? null
  } });

  for (const t of wagonRepo.getWagonTimeline(w)) {
    if (t.fromStage === t.toStage) continue;
    out.push({ kind: 'STAGE_TRANSITION', at: t.createdAt, payload: {
      fromStage: t.fromStage, toStage: t.toStage, transitionType: t.transitionType, performerName: t.performerName, performerRole: t.performerRole,
      isOverride: !!t.isOverride, overrideReason: t.overrideReason ?? null
    } });
  }

  for (const i of inspections.queryInspections({ wagonNumber: w, limit: 5000 }).records as any[]) {
    out.push({ kind: 'SPRING_INSPECTION', at: i.timestamp || i.createdAt, payload: {
      bogieType: i.bogieType, springCondition: i.springCondition, springPosition: i.springPosition, bogiePosition: i.bogiePosition ?? null, nestIndex: i.nestIndex ?? null,
      measuredHeightMm: i.measuredHeight, heightIsApproximate: !!i.heightIsApproximate, classifiedBand: i.classifiedBand, bandRoman: i.bandRoman, status: i.status,
      damageType: i.damageType ?? null, measurementSource: i.measurementSource ?? 'MANUAL', inspectorName: i.inspectorName, supervisorOverride: !!i.supervisorOverride
    } });
  }

  const checklist = wagonRepo.getChecklistItems(w);
  for (const c of (checklist?.allItems || []) as any[]) {
    if (c.status === 'PENDING') continue;
    out.push({ kind: 'CHECKLIST_VERDICT', at: c.manualVerdictAt || c.updatedAt || c.createdAt, payload: {
      category: c.category, partName: c.partName, bogiePosition: c.bogiePosition ?? 'NONE', status: c.status, isMandatory: !!c.isMandatory,
      repairAction: c.repairAction ?? null, reinspectedStatus: c.reinspectedStatus ?? null, conditionNotes: c.conditionNotes ?? null,
      verdictSource: c.verdictSource ?? 'MANUAL', verdictBy: c.manualVerdictByName ?? c.inspectorName ?? null
    } });
  }

  for (const p of parts.entries(w)) {
    out.push({ kind: 'PART_EVENT', at: p.createdAt, payload: {
      event: p.event, category: p.category, partName: p.partName, bogiePosition: p.bogiePosition ?? null, quantity: p.quantity ?? 1,
      reason: p.reason ?? null, componentSerial: p.componentSerial ?? null, stage: p.stage, recordedBy: p.inspectorName ?? null
    } });
  }

  // The full test row, readings included: sixteen numbers per wagon that the
  // next shop's brake fitter would otherwise never see.
  for (const s of db.prepare('SELECT * FROM swt_tests WHERE wagon_number = ? ORDER BY created_at ASC, rowid ASC').all(w) as any[]) {
    const j = (v: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : v ?? null; } catch { return v; } };
    out.push({ kind: 'SINGLE_WAGON_TEST', at: s.created_at, payload: {
      passed: s.passed === 1, pipeType: s.pipe_type, loadCondition: s.load_condition,
      failedRefs: j(s.failed_refs) ?? [], missingRefs: j(s.missing_refs) ?? [], unjudgedRefs: j(s.unjudged_refs) ?? [],
      testerName: s.tester_name ?? null, readings: j(s.readings_json), results: j(s.results_json)
    } });
  }

  for (const ph of wagonRepo.getPhotosByWagon(w) as any[]) {
    out.push({ kind: 'PHOTO', at: ph.capturedAt || ph.createdAt, payload: {
      photoId: ph.id, category: ph.category ?? null, partName: ph.partName ?? null, evidenceStage: ph.evidenceStage ?? null,
      sha256: ph.sha256 ?? null, fileSize: ph.fileSize ?? null, inspectorName: ph.inspectorName ?? null
    } });
  }

  const signoff = wagonRepo.getGateSignoff(w);
  if (signoff) {
    out.push({ kind: 'GATE_SIGNOFF', at: signoff.signedAt, payload: {
      supervisorName: signoff.supervisorName, supervisorEmployeeId: signoff.supervisorEmployeeId ?? null, certificateNumber: signoff.certificateNumber,
      certificateHash: signoff.certificateHash, checksSummary: signoff.checksSummary ?? null, acknowledgedAdvisories: signoff.acknowledgedAdvisories ?? signoff.checksSummary?.acknowledgedAdvisories ?? null
    } });
    // The exact bytes the certificate signature covers, rebuilt the way the
    // signoff built them, so the next shop can verify the certificate itself
    // from the passport alone.
    out.push({ kind: 'CERTIFICATE', at: signoff.signedAt, payload: {
      certificateNumber: signoff.certificateNumber, algorithm: SIGNATURE_ALGORITHM, signature: signoff.digitalSignature,
      signedContent: JSON.stringify({
        wagonNumber: w, certificateNumber: signoff.certificateNumber, supervisorId: signoff.supervisorId,
        supervisorEmployeeId: signoff.supervisorEmployeeId, signedAt: signoff.signedAt, summary: signoff.checksSummary
      })
    } });
  }

  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

/** The whole passport, as JSON Lines. */
export function buildPassport(db: DatabaseSync, wagonNumber: string, exportedBy: { id: string; name: string; role: string }, exportedAt = new Date().toISOString()): string {
  const wagonRepo = new WagonRepository(db);
  const wagon = wagonRepo.getWagonByNumber(wagonNumber);
  if (!wagon) throw new Error(`Wagon ${wagonNumber} not found.`);
  const header: PassportHeader = {
    type: 'PASSPORT', version: PASSPORT_VERSION,
    wagonNumber: wagon.wagonNumber, wagonType: wagon.wagonType, owningRailway: wagon.owningRailway,
    issuer: { name: ISSUER_NAME, keyFingerprint: certificateKeyFingerprint(), publicKeyPem: certificatePublicKeyPem(), algorithm: SIGNATURE_ALGORITHM },
    exportedAt, exportedBy
  };
  const lines: string[] = [JSON.stringify(header)];
  let prev = GENESIS;
  let seq = 0;
  for (const e of collectEvents(db, wagon.wagonNumber)) {
    seq++;
    const hash = eventHash(prev, seq, e.kind, e.at, e.payload);
    const ev: PassportEvent = { type: 'EVENT', seq, kind: e.kind, at: e.at, payload: e.payload, prevHash: prev, hash };
    lines.push(JSON.stringify(ev));
    prev = hash;
  }
  const signed = sealText(wagon.wagonNumber, exportedAt, seq, prev);
  const seal: PassportSeal = { type: 'SEAL', events: seq, terminalHash: prev, signed, signature: signCertificate(signed) };
  lines.push(JSON.stringify(seal));
  return lines.join('\n') + '\n';
}

export interface PassportVerification {
  ok: boolean;
  reasons: string[];
  header: PassportHeader | null;
  events: PassportEvent[];
  seal: PassportSeal | null;
  /** Whether the key in the file is this server's own certificate key. */
  issuedByThisServer: boolean;
}

/**
 * Read a passport back and check it, trusting nothing but arithmetic and the
 * key inside it. Every failure is named, and the check does not stop at the
 * first, so a reader sees everything wrong with a file at once.
 */
export function verifyPassport(text: string): PassportVerification {
  const reasons: string[] = [];
  const rawLines = text.split(/\r?\n/).filter((l) => l.trim());
  let header: PassportHeader | null = null;
  const events: PassportEvent[] = [];
  let seal: PassportSeal | null = null;

  for (const [i, line] of rawLines.entries()) {
    let obj: any;
    try { obj = JSON.parse(line); } catch { reasons.push(`Line ${i + 1} is not JSON.`); continue; }
    if (obj?.type === 'PASSPORT') { if (header) reasons.push('More than one PASSPORT line.'); header = obj; }
    else if (obj?.type === 'EVENT') events.push(obj);
    else if (obj?.type === 'SEAL') { if (seal) reasons.push('More than one SEAL line.'); seal = obj; }
    else reasons.push(`Line ${i + 1} has an unknown type.`);
  }
  if (!header) reasons.push('No PASSPORT line.');
  if (!seal) reasons.push('No SEAL line.');
  if (header && header.version !== PASSPORT_VERSION) reasons.push(`Passport version ${header.version} is not ${PASSPORT_VERSION}.`);

  // The chain: every event's hash from the previous, in order.
  let prev = GENESIS;
  events.forEach((e, idx) => {
    if (e.seq !== idx + 1) reasons.push(`Event ${idx + 1} carries seq ${e.seq} — a line is missing or out of order.`);
    if (e.prevHash !== prev) reasons.push(`Event ${e.seq} does not follow the previous line (prevHash mismatch).`);
    const expected = eventHash(prev, e.seq, e.kind, e.at, e.payload);
    if (e.hash !== expected) reasons.push(`Event ${e.seq} (${e.kind}) has been altered — its hash does not match its content.`);
    prev = e.hash;
  });

  let issuedByThisServer = false;
  if (header && seal) {
    if (seal.events !== events.length) reasons.push(`The seal says ${seal.events} events; the file holds ${events.length}.`);
    if (seal.terminalHash !== prev) reasons.push('The seal\'s terminal hash is not the hash of the last event.');
    const expectedSigned = sealText(header.wagonNumber, header.exportedAt, events.length, prev);
    if (seal.signed !== expectedSigned) reasons.push('The sealed text does not match the header and the chain.');
    let keyOk = false;
    try {
      crypto.createPublicKey(header.issuer.publicKeyPem);
      keyOk = true;
    } catch { reasons.push('The issuer\'s public key in the file is not a valid key.'); }
    if (keyOk) {
      const fp = crypto.createHash('sha256').update(crypto.createPublicKey(header.issuer.publicKeyPem).export({ type: 'spki', format: 'der' }) as Buffer).digest('hex').slice(0, 16).toUpperCase();
      if (fp !== header.issuer.keyFingerprint) reasons.push('The key fingerprint in the file does not match the key in the file.');
      if (!verifyCertificate(seal.signed, seal.signature, header.issuer.publicKeyPem)) reasons.push('The seal\'s signature does not verify against the issuer\'s key.');
      issuedByThisServer = fp === certificateKeyFingerprint();
    }
  }

  return { ok: reasons.length === 0, reasons, header, events, seal, issuedByThisServer };
}
