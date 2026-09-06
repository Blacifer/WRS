/**
 * A spoken verdict keeps its words, with or without a network
 * Indian Railways WRS Raipur
 *
 * Spoken online, "condemn brake block, visible crack" records three things:
 * the verdict on the checklist, the defect note, and the transcript itself in
 * the append-only log. Spoken offline, only the status was queued. The verdict
 * survived and the evidence for it did not.
 *
 * On a spoken instruction the transcript IS the provenance. Without it nobody
 * can afterwards check that the words were what was actually said — which is
 * the first question anyone asks about a verdict a machine heard rather than
 * a person typed.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateToken } from '../src/auth/jwt.ts';
import { getDatabase } from '../src/db/connection.ts';
import type { ExpressApp } from '../src/framework/index.ts';

describe('Voice actions captured offline', () => {
  let app: ExpressApp;
  let token: string;
  const wagonNumber = 'SECR/BOXNHL/VOI001';

  const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

  before(async () => {
    app = createApp(':memory:');
    token = generateToken({
      id: 'usr_insp_001', username: 'inspector1', role: 'INSPECTOR',
      name: 'Ramesh Kumar', employeeId: 'WRS-INSP-1042'
    });
    await app.dispatch({
      method: 'POST', url: '/api/wagons/register', headers: auth(),
      body: { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'SECR' }
    });
  });

  const batch = (over: Record<string, unknown>) => ({
    wagons: [], voiceActions: [], records: [], checklistItems: [], photos: [], transitions: [],
    deviceId: 'WRS-RAIPUR-PWA-test', syncTimestamp: new Date().toISOString(), ...over
  });

  test('TC-VOI-01: the transcript reaches the audit log, not just the verdict', async () => {
    const chk = await app.dispatch({
      method: 'GET', url: `/api/wagons/${wagonNumber}/checklist`, headers: auth()
    });
    const item = chk.body.data.allItems[0];

    const spokenAt = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const res = await app.dispatch({
      method: 'POST', url: '/api/sync/batch', headers: auth(),
      body: batch({
        voiceActions: [{
          clientTempId: 'voi-1',
          wagonNumber,
          itemId: item.id,
          itemName: item.partName,
          category: item.category,
          status: 'CONDEMNED',
          defectNotes: 'Visible crack near the second coil.',
          transcript: 'condemn brake block visible crack near the second coil',
          language: 'en-IN',
          confidence: 0.91,
          createdAt: spokenAt
        }]
      })
    });

    assert.equal(res.status, 200, `sync refused: ${res.body?.message}`);

    // The verdict landed.
    const after = await app.dispatch({
      method: 'GET', url: `/api/wagons/${wagonNumber}/checklist`, headers: auth()
    });
    const updated = after.body.data.allItems.find((i: any) => i.id === item.id);
    assert.equal(updated.status, 'CONDEMNED');
    assert.equal(updated.conditionNotes, 'Visible crack near the second coil.');

    // And so did the words behind it.
    const rows = getDatabase().prepare(`
      SELECT payload_json FROM inspection_audit_log
      WHERE event_type = 'CHECKLIST_ITEM_INSPECTED'
    `).all() as any[];

    const voice = rows
      .map((r) => JSON.parse(r.payload_json))
      .find((p: any) => p.inputSource === 'VOICE_DICTATION');

    assert.ok(voice, 'a queued voice action must record that it was spoken');
    assert.equal(voice.transcript, 'condemn brake block visible crack near the second coil');
    assert.equal(voice.language, 'en-IN');
    assert.equal(voice.confidence, 0.91);
  });

  test('TC-VOI-02: it is timestamped when it was spoken, not when it synced', async () => {
    /*
     * An inspector speaks at 09:10 and the tablet finds signal at 11:40. The
     * record has to say 09:10, or the audit trail describes a shift that did
     * not happen in that order.
     */
    const rows = getDatabase().prepare(`
      SELECT payload_json, created_at FROM inspection_audit_log
      WHERE event_type = 'CHECKLIST_ITEM_INSPECTED'
    `).all() as any[];

    const voice = rows
      .map((r) => ({ p: JSON.parse(r.payload_json), createdAt: r.created_at }))
      .find((r) => r.p.inputSource === 'VOICE_DICTATION');

    const ageMinutes = (Date.now() - Date.parse(voice.createdAt)) / 60000;
    assert.ok(ageMinutes > 60, `expected the spoken time, got something ${Math.round(ageMinutes)} min old`);
  });

  test('TC-VOI-03: a queued voice action with no transcript is refused, not half-applied', async () => {
    /*
     * The transcript is the reason this entity exists. Applying the verdict
     * without it would reintroduce exactly the fault being fixed, silently.
     */
    const res = await app.dispatch({
      method: 'POST', url: '/api/sync/batch', headers: auth(),
      body: batch({
        voiceActions: [{
          clientTempId: 'voi-bad',
          wagonNumber,
          itemName: 'Distributor Valve KE/C3W',
          status: 'CONDEMNED',
          createdAt: new Date().toISOString()
        }]
      })
    });

    assert.equal(res.status, 200, 'the batch still returns, with the failure named');
    const errs = res.body.errors || [];
    assert.ok(
      errs.some((e: any) => e.entity === 'VOICE_ACTION' && e.clientTempId === 'voi-bad'),
      'the device must be told which item failed, so it can keep it and retry'
    );
  });

  test('TC-VOI-04: both records of the same act name the person, not the system', async () => {
    /*
     * A spoken verdict writes two audit entries: the voice entry carrying the
     * transcript, and the checklist entry recording the status change.
     *
     * The first named the inspector and the second named 'usr_system',
     * because updateChecklistItem defaults its attribution and neither the
     * live route nor the sync passed an actor. Two entries describing the
     * same act disagreed about who performed it — and the one an auditor
     * would reach for first, "who changed this part", was the one that said
     * nobody.
     *
     * Attribution comes from the token either way. A device can claim
     * anything.
     */
    const rows = getDatabase().prepare(`
      SELECT user_id, payload_json FROM inspection_audit_log
      WHERE event_type = 'CHECKLIST_ITEM_INSPECTED'
    `).all() as any[];

    assert.ok(rows.length >= 2, 'a spoken verdict writes both entries');
    assert.ok(
      rows.every((r) => r.user_id === 'usr_insp_001'),
      `every record of this act must name the inspector; got ${[...new Set(rows.map((r) => r.user_id))].join(', ')}`
    );
  });
});
