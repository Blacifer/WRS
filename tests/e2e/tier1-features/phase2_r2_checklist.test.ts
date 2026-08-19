/**
 * Tier 1 Test Suite — Feature R2: CASNUB Bogie Parts Checklist
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Verifies 8 RDSO CASNUB categories, item inspection logging, repair/replacement workflows,
 * mandatory vs advisory configuration, and bilingual category grouping.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TestApp } from '../../harness/test_app.ts';
import type {
  ChecklistItem,
  ChecklistCategoryGroup,
  ChecklistConfigEntry,
  CASNUBCategory
} from '../../../shared/types.ts';
import { CASNUB_CATEGORIES } from '../../../shared/types.ts';

describe('Tier 1 — R2: CASNUB Bogie Parts Checklist', () => {
  let app: TestApp;
  let inspectorToken: string;
  let supervisorToken: string;
  const wagonNumber = 'NR/BOXNHL/88001';

  beforeEach(async () => {
    app = new TestApp(':memory:');

    const inspLogin = await app.post('/api/auth/login', { username: 'inspector1', password: 'password123' });
    inspectorToken = (inspLogin.body as { token: string }).token;

    const supLogin = await app.post('/api/auth/login', { username: 'supervisor1', password: 'password123' });
    supervisorToken = (supLogin.body as { token: string }).token;

    await app.post(
      '/api/wagons/register',
      { wagonNumber, wagonType: 'BOXNHL', owningRailway: 'NR' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
  });

  // Test Case 1: Auto-generation of 8 CASNUB Categories
  it('TC-P2-R2-01: Automatically generates comprehensive checklist covering all 8 RDSO CASNUB categories', async () => {
    const checklistRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(checklistRes.status, 200);
    const body = checklistRes.body as { items: ChecklistItem[]; categories: ChecklistCategoryGroup[] };

    assert.ok(body.items.length >= 20);
    assert.strictEqual(body.categories.length, 8);

    const categoriesFound = body.categories.map(c => c.category);
    for (const cat of CASNUB_CATEGORIES) {
      assert.ok(categoriesFound.includes(cat), `Category ${cat} must be present in checklist`);
    }
  });

  // Test Case 2: Individual Component Inspection Logging
  it('TC-P2-R2-02: Inspector logs individual component inspections with PASS, FAIL, and CONDEMNED statuses', async () => {
    const checklistRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (checklistRes.body as { items: ChecklistItem[] }).items;

    const wheelItem = items.find(i => i.category === 'WHEELS_AXLES')!;
    const bearingItem = items.find(i => i.category === 'BEARINGS')!;
    const brakeItem = items.find(i => i.category === 'BRAKE_SYSTEM')!;

    // 1. Pass wheel item
    const passRes = await app.put(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/checklist/items/${wheelItem.id}`,
      { status: 'PASS', repairNotes: 'Tread wear within 15mm RDSO tolerance' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(passRes.status, 200);
    assert.strictEqual((passRes.body as ChecklistItem).status, 'PASS');

    // 2. Condemn bearing item
    const condemnRes = await app.put(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/checklist/items/${bearingItem.id}`,
      { status: 'CONDEMNED', repairNotes: 'CTRB spalling on outer cone cup' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(condemnRes.status, 200);
    assert.strictEqual((condemnRes.body as ChecklistItem).status, 'CONDEMNED');

    // 3. Mark brake item as fail
    const failRes = await app.put(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/checklist/items/${brakeItem.id}`,
      { status: 'FAIL', repairNotes: 'Brake block worn to condemning line' },
      { Authorization: `Bearer ${inspectorToken}` }
    );
    assert.strictEqual(failRes.status, 200);
    assert.strictEqual((failRes.body as ChecklistItem).status, 'FAIL');
  });

  // Test Case 3: Repair & Replacement Actions
  it('TC-P2-R2-03: Component repair and replacement actions update part status and record audit details', async () => {
    const checklistRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (checklistRes.body as { items: ChecklistItem[] }).items;
    const brakeBeam = items.find(i => i.category === 'BRAKE_SYSTEM' && i.partName.includes('Brake Beam'))!;

    // Perform replacement with new unit
    const updateRes = await app.put(
      `/api/wagons/${encodeURIComponent(wagonNumber)}/checklist/items/${brakeBeam.id}`,
      {
        status: 'REPLACED',
        repairAction: 'REPLACED_NEW',
        repairNotes: 'Installed new RDSO-approved high-tensile brake beam lot #2026-BB-442'
      },
      { Authorization: `Bearer ${inspectorToken}` }
    );

    assert.strictEqual(updateRes.status, 200);
    const updated = updateRes.body as ChecklistItem;
    assert.strictEqual(updated.status, 'REPLACED');
    assert.strictEqual(updated.repairAction, 'REPLACED_NEW');
    assert.ok(updated.repairNotes?.includes('2026-BB-442'));
    assert.ok(updated.inspectedBy);
  });

  // Test Case 4: Default Mandatory vs Advisory Rules
  it('TC-P2-R2-04: Enforces default criticality (safety-critical = MANDATORY, non-critical = ADVISORY)', async () => {
    const checklistRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const items = (checklistRes.body as { items: ChecklistItem[] }).items;

    const safetyCriticalCategories: CASNUBCategory[] = [
      'SPRINGS',
      'WHEELS_AXLES',
      'BEARINGS',
      'BRAKE_SYSTEM',
      'COUPLERS_DRAFT_GEAR',
      'BOGIE_FRAME_BOLSTER',
      'FRICTION_WEDGES'
    ];

    for (const cat of safetyCriticalCategories) {
      const catItems = items.filter(i => i.category === cat);
      for (const item of catItems) {
        assert.strictEqual(item.criticality, 'MANDATORY', `Item ${item.partName} in ${cat} should be MANDATORY`);
      }
    }

    const bodyItems = items.filter(i => i.category === 'BODY_UNDERFRAME');
    for (const item of bodyItems) {
      assert.strictEqual(item.criticality, 'ADVISORY', `Body item ${item.partName} should be ADVISORY by default`);
    }
  });

  // Test Case 5: Custom Criticality Configuration per Wagon Type
  it('TC-P2-R2-05: Supervisor can configure custom mandatory/advisory rules per wagon type', async () => {
    // 1. Configure floor plate to be MANDATORY for BOXNHL coal wagons
    const configPayload: ChecklistConfigEntry[] = [
      {
        wagonType: 'BOXNHL',
        category: 'BODY_UNDERFRAME',
        partName: 'Floor Sheet Integrity',
        criticality: 'MANDATORY'
      }
    ];

    const postConfig = await app.post('/api/checklist/config', configPayload, { Authorization: `Bearer ${supervisorToken}` });
    assert.strictEqual(postConfig.status, 200);

    // 2. Query config API
    const getConfig = await app.get('/api/checklist/config?wagonType=BOXNHL', { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(getConfig.status, 200);
    const configs = (getConfig.body as { configs: ChecklistConfigEntry[] }).configs;
    const floorConfig = configs.find(c => c.partName === 'Floor Sheet Integrity');
    assert.ok(floorConfig);
    assert.strictEqual(floorConfig.criticality, 'MANDATORY');

    // 3. Register new wagon of type BOXNHL and verify customized criticality is applied
    const newWagon = 'NR/BOXNHL/99999';
    await app.post('/api/wagons/register', { wagonNumber: newWagon, wagonType: 'BOXNHL', owningRailway: 'NR' }, { Authorization: `Bearer ${inspectorToken}` });
    const newChecklist = await app.get(`/api/wagons/${encodeURIComponent(newWagon)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    const newItems = (newChecklist.body as { items: ChecklistItem[] }).items;
    const newFloorItem = newItems.find(i => i.partName === 'Floor Sheet Integrity')!;
    assert.strictEqual(newFloorItem.criticality, 'MANDATORY');
  });

  // Test Case 6: Bilingual Category Grouping & Completion Stats
  it('TC-P2-R2-06: Category grouping returns bilingual labels (English/Hindi) and completion statistics', async () => {
    const checklistRes = await app.get(`/api/wagons/${encodeURIComponent(wagonNumber)}/checklist`, { Authorization: `Bearer ${inspectorToken}` });
    assert.strictEqual(checklistRes.status, 200);
    const { categories } = checklistRes.body as { categories: ChecklistCategoryGroup[] };

    for (const cat of categories) {
      assert.ok(cat.categoryLabelEn.length > 0);
      assert.ok(cat.categoryLabelHi.length > 0);
      assert.ok(typeof cat.mandatoryCount === 'number');
      assert.ok(typeof cat.passedCount === 'number');
      assert.ok(typeof cat.failedCount === 'number');
      assert.ok(typeof cat.condemnedCount === 'number');
      assert.ok(typeof cat.isComplete === 'boolean');
    }

    const springsCat = categories.find(c => c.category === 'SPRINGS')!;
    assert.strictEqual(springsCat.categoryLabelEn, 'Springs');
    assert.strictEqual(springsCat.categoryLabelHi, 'स्प्रिंग्स');
  });

});
