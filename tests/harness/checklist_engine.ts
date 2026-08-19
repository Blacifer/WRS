/**
 * CASNUB Bogie Parts Checklist Engine
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Implements 8 standard RDSO CASNUB categories, mandatory vs advisory rules,
 * part statuses (PASS, FAIL, CONDEMNED, REPAIRED, REPLACED), and category grouping.
 */

import crypto from 'node:crypto';
import type {
  CASNUBCategory,
  PartInspectionStatus,
  PartCriticality,
  RepairActionType,
  ChecklistItem,
  ChecklistCategoryGroup,
  ChecklistConfigEntry,
  InspectionRecord
} from '../../shared/types.ts';
import { CASNUB_CATEGORIES } from '../../shared/types.ts';
import { getLocalizedCategory } from './i18n_data.ts';

export const DEFAULT_CATEGORY_PARTS: Record<CASNUBCategory, { parts: string[]; defaultCriticality: PartCriticality }> = {
  SPRINGS: {
    parts: [
      'Outer Springs Bogie-1',
      'Inner Springs Bogie-1',
      'Snubber Springs Bogie-1',
      'Outer Springs Bogie-2',
      'Inner Springs Bogie-2',
      'Snubber Springs Bogie-2'
    ],
    defaultCriticality: 'MANDATORY'
  },
  WHEELS_AXLES: {
    parts: [
      'Wheel Profile & Tread Wear',
      'Flange Thickness & Height',
      'Axle Journal & Collar Condition',
      'Wheel Disc Structural Integrity'
    ],
    defaultCriticality: 'MANDATORY'
  },
  BEARINGS: {
    parts: [
      'Cartridge Tapered Roller Bearing (CTRB)',
      'Axle Box Assembly & End Cap',
      'Elastomeric Pad & Backing Ring',
      'Grease Seal & Locking Plate'
    ],
    defaultCriticality: 'MANDATORY'
  },
  BRAKE_SYSTEM: {
    parts: [
      'Composite Brake Blocks',
      'Brake Beam & Trunnion',
      'Slack Adjuster (SAB DA-Type)',
      'Brake Rigging Pins & Split Cotters'
    ],
    defaultCriticality: 'MANDATORY'
  },
  COUPLERS_DRAFT_GEAR: {
    parts: [
      'CBC Coupler Body & Shank',
      'Knuckle & Lock Assembly',
      'High-Capacity Draft Gear Housing',
      'Coupler Operating Rod & Striker Casting'
    ],
    defaultCriticality: 'MANDATORY'
  },
  BOGIE_FRAME_BOLSTER: {
    parts: [
      'Cast Steel Side Frame Column',
      'Bogie Bolster & Center Pivot Plate',
      'Metal-Bonded Rubber Side Bearers',
      'Column Wear Plates & Liners'
    ],
    defaultCriticality: 'MANDATORY'
  },
  FRICTION_WEDGES: {
    parts: [
      'Friction Wedge Blocks',
      'Friction Wedge Wear Surface',
      'Friction Wedge Spigot Fitment'
    ],
    defaultCriticality: 'MANDATORY'
  },
  BODY_UNDERFRAME: {
    parts: [
      'Underframe Center Sill & Cross Members',
      'Floor Sheet Integrity',
      'Side Wall Stanchions & Top Coping',
      'Discharge Doors & Locking Mechanism'
    ],
    defaultCriticality: 'ADVISORY'
  }
};

export class ChecklistEngine {
  /**
   * Generate default checklist items for a newly registered wagon
   */
  public static generateInitialChecklist(
    wagonNumber: string,
    wagonType: string,
    customConfigs: ChecklistConfigEntry[] = []
  ): ChecklistItem[] {
    const items: ChecklistItem[] = [];
    const timestamp = new Date().toISOString();

    for (const cat of CASNUB_CATEGORIES) {
      const def = DEFAULT_CATEGORY_PARTS[cat];
      for (const partName of def.parts) {
        // Check for custom configuration override
        const override = customConfigs.find(
          c => c.wagonType === wagonType && c.category === cat && c.partName === partName
        );

        const criticality: PartCriticality = override ? override.criticality : def.defaultCriticality;

        items.push({
          id: crypto.randomUUID(),
          wagonNumber,
          category: cat,
          partName,
          status: 'FAIL', // Initial unverified state
          criticality,
          inspectedAt: timestamp,
          updatedAt: timestamp
        });
      }
    }

    return items;
  }

  /**
   * Synchronize Phase 1 spring inspection results into the wagon checklist
   */
  public static syncPhase1SpringsIntoChecklist(
    checklist: ChecklistItem[],
    springInspections: InspectionRecord[]
  ): void {
    if (!springInspections || springInspections.length === 0) return;

    const springItems = checklist.filter(i => i.category === 'SPRINGS');
    if (springItems.length === 0) return;

    // Track the latest inspection per position to support re-inspection after replacement
    const latestPerPosition = new Map<string, InspectionRecord>();
    for (const insp of springInspections) {
      const key = `${insp.springPosition || 'DEFAULT'}`;
      const existing = latestPerPosition.get(key);
      if (!existing || (insp.timestamp && existing.timestamp && insp.timestamp >= existing.timestamp)) {
        latestPerPosition.set(key, insp);
      }
    }

    const latestList = Array.from(latestPerPosition.values());
    const hasCondemned = latestList.some(s => s.status === 'CONDEMNED');
    const allPassed = latestList.length > 0 && latestList.every(s => s.status === 'PASS');

    for (const item of springItems) {
      // If already marked REPLACED or REPAIRED, keep it
      if (item.status === 'REPLACED' || item.status === 'REPAIRED') {
        continue;
      }
      if (hasCondemned) {
        item.status = 'CONDEMNED';
        item.conditionNotes = `Phase 1 inspection detected condemned spring(s). Immediate replacement required.`;
      } else if (allPassed) {
        item.status = 'PASS';
        item.conditionNotes = `Phase 1 verified: ${latestList.length} spring position(s) classified within acceptable RDSO bands.`;
      }
      item.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Group checklist items into RDSO categories with statistics and bilingual labels
   */
  public static groupChecklistByCategory(items: ChecklistItem[]): ChecklistCategoryGroup[] {
    const groups: ChecklistCategoryGroup[] = [];

    for (const cat of CASNUB_CATEGORIES) {
      const catItems = items.filter(i => i.category === cat);
      const mandatoryItems = catItems.filter(i => i.criticality === 'MANDATORY');
      const passedCount = catItems.filter(i => i.status === 'PASS' || i.status === 'REPAIRED' || i.status === 'REPLACED').length;
      const failedCount = catItems.filter(i => i.status === 'FAIL').length;
      const condemnedCount = catItems.filter(i => i.status === 'CONDEMNED').length;
      const mandatoryPassedCount = mandatoryItems.filter(i => i.status === 'PASS' || i.status === 'REPAIRED' || i.status === 'REPLACED').length;

      const isComplete = mandatoryItems.length > 0 ? mandatoryPassedCount === mandatoryItems.length && condemnedCount === 0 : true;

      groups.push({
        category: cat,
        categoryLabelEn: getLocalizedCategory(cat, 'en'),
        categoryLabelHi: getLocalizedCategory(cat, 'hi'),
        items: catItems,
        mandatoryCount: mandatoryItems.length,
        passedCount,
        failedCount,
        condemnedCount,
        isComplete
      });
    }

    return groups;
  }
}
