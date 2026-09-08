/**
 * The certificate names every part, not just the count
 * Indian Railways WRS Raipur
 *
 * WHY THESE EXIST
 * ---------------
 * The release certificate leaves with the wagon. It carried a per-category
 * matrix — "6/7 CLEARED — 1 not inspected" — and no table of parts, so a
 * reader could not tell WHICH part was not inspected, who recorded what, or
 * what work was done. The DRM's requirement is that nothing found after
 * release can be a question of what was looked at. That needs the lines.
 *
 * The same document also went on printing "Mark-50 draft gear / WRS gauge
 * boards" after the shop withdrew Mark-50 in August.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { getDatabase } from '../src/db/connection.ts';
import { WagonRepository } from '../src/db/wagonRepository.ts';
import { InspectionRepository } from '../src/db/repository.ts';
import { ComponentRepository } from '../src/db/componentRepository.ts';
import { CertificateGenerator } from '../src/reports/certificate.ts';

const WAGON = 'SECR/BOXNHL/10493';

describe('Release certificate — every checklist line', () => {
  let html = '';

  before(() => {
    createApp(':memory:');
    const db = getDatabase();
    const repo = new WagonRepository(db);
    const w = repo.registerWagon({ wagonNumber: WAGON, wagonType: 'BOXNHL', owningRailway: 'SECR', createdBy: 'usr_insp_001' });

    // Three distinguishable verdicts on the wagon's own checklist.
    const items = repo.getChecklistItems(WAGON).allItems as any[];
    assert.ok(items.length >= 3, 'the template should have populated the checklist');
    repo.updateChecklistItem(items[0].id, { status: 'PASS' }, { userId: 'usr_insp_001', userRole: 'INSPECTOR' });
    repo.updateChecklistItem(items[1].id, { status: 'REPAIRED', repairAction: 'REPAIRED', reinspectedStatus: 'PASS' }, { userId: 'usr_insp_001', userRole: 'INSPECTOR' });
    // items[2] stays PENDING on purpose.

    db.prepare(`
      INSERT INTO gate_signoffs (
        id, wagon_id, wagon_number, supervisor_id, supervisor_name, supervisor_employee_id,
        digital_signature, otp_token_ref, checks_summary_json, certificate_number, certificate_hash, signed_at
      ) VALUES ('sgn_test_02', ?, ?, 'usr_sup_001', 'S. K. Verma', 'WRS-SUP-2019',
        'HMAC-SHA256-TEST-SIG', 'otp_123', '{}', 'WRS/QC-REL/2026/09/TEST02', 'hash0000000000000002', '2026-09-08T12:00:00.000Z')
    `).run(w.id, WAGON);

    const cert: any = CertificateGenerator.generate(WAGON, repo, new InspectionRepository(db), new ComponentRepository(db), 'html');
    html = typeof cert === 'string' ? cert : String(cert?.html ?? cert?.body ?? cert?.content ?? JSON.stringify(cert));
  });

  it('TC-CERT-LINES-01: the document carries a per-part section', () => {
    assert.match(html, /1A\. Every Checklist Line/);
  });

  it('TC-CERT-LINES-02: a pending part is named NOT INSPECTED, not folded into a count', () => {
    const repo = new WagonRepository(getDatabase());
    const pending = (repo.getChecklistItems(WAGON).allItems as any[]).find((i) => i.status === 'PENDING');
    assert.ok(pending, 'one part was left pending on purpose');
    const idx = html.indexOf(pending.partName);
    assert.ok(idx > 0, 'the pending part must appear by name');
    assert.ok(html.slice(idx, idx + 600).includes('NOT INSPECTED'), 'and be marked NOT INSPECTED beside its name');
  });

  it('TC-CERT-LINES-03: a repaired-and-reinspected part says so, and names who recorded it', () => {
    assert.match(html, /REPAIRED — RE-INSPECTED PASS/);
    assert.match(html, /Ramesh Kumar|inspector1/, 'the recording inspector is on the line');
  });

  it('TC-CERT-LINES-04: it no longer names work the shop withdrew in August', () => {
    assert.doesNotMatch(html, /Mark-50|MK-50|WRS gauge boards/);
  });
});
