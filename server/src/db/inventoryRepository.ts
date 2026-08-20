/**
 * Stores Depot Inventory Repository
 * Indian Railways WRS Raipur (Phase 3 - M1 / R5)
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import type {
  StoresPart,
  InventoryReservation,
  InventoryStats,
  CASNUBCategory,
  ReservationSource,
  ReservationStatus
} from '../../../shared/types.ts';

export class InventoryRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * Helper to map a stores_inventory SQL row to StoresPart domain model
   */
  private mapStoresPartRow(row: any): StoresPart {
    const stockQuantity = Number(row.stock_quantity ?? 0);
    const reservedQuantity = Number(row.reserved_quantity ?? 0);
    const availableQuantity = Math.max(0, stockQuantity - reservedQuantity);

    return {
      id: row.id,
      partCode: row.part_code,
      partName: row.part_name,
      category: row.category as CASNUBCategory,
      unitOfMeasure: row.unit_of_measure || 'NOS',
      stockQuantity,
      reservedQuantity,
      availableQuantity,
      reorderThreshold: Number(row.reorder_threshold ?? 10),
      unitCostInr: Number(row.unit_cost_inr ?? 0),
      binLocation: row.bin_location || 'UNASSIGNED',
      supplierName: row.supplier_name || 'RWF Yelahanka / Stores Depot',
      updatedAt: row.updated_at
    };
  }

  /**
   * Helper to map an inventory_reservations SQL row to InventoryReservation domain model
   */
  private mapReservationRow(row: any): InventoryReservation {
    return {
      id: row.id,
      wagonNumber: row.wagon_number,
      partCode: row.part_code,
      quantity: Number(row.quantity ?? 1),
      source: row.source as ReservationSource,
      predictedDefect: row.predicted_defect ?? null,
      confidenceScore: row.confidence_score !== null && row.confidence_score !== undefined
        ? Number(row.confidence_score)
        : null,
      status: row.status as ReservationStatus,
      allocatedAt: row.allocated_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      partName: row.part_name ?? undefined,
      binLocation: row.bin_location ?? undefined,
      category: row.category as CASNUBCategory | undefined
    };
  }

  /**
   * List inventory parts with optional category filtering
   */
  public getInventory(category?: string): StoresPart[] {
    let query = `
      SELECT id, part_code, part_name, category, unit_of_measure, stock_quantity,
             reserved_quantity, reorder_threshold, unit_cost_inr, bin_location,
             supplier_name, updated_at
      FROM stores_inventory
    `;
    const params: any[] = [];

    if (category && category.trim() !== '' && category !== 'ALL') {
      query += ` WHERE category = ?`;
      params.push(category.trim().toUpperCase());
    }

    query += ` ORDER BY category ASC, part_code ASC`;

    const rows = this.db.prepare(query).all(...params);
    return rows.map((r: any) => this.mapStoresPartRow(r));
  }

  /**
   * Get single part by part code
   */
  public getPartByCode(partCode: string): StoresPart | null {
    if (!partCode) return null;
    const cleanCode = partCode.trim().toUpperCase();
    const row = this.db.prepare(`
      SELECT id, part_code, part_name, category, unit_of_measure, stock_quantity,
             reserved_quantity, reorder_threshold, unit_cost_inr, bin_location,
             supplier_name, updated_at
      FROM stores_inventory
      WHERE part_code = ?
    `).get(cleanCode);

    if (!row) return null;
    return this.mapStoresPartRow(row);
  }

  /**
   * Reserve part for a wagon
   */
  public reservePart(data: {
    wagonNumber: string;
    partCode: string;
    quantity: number;
    source: string;
    predictedDefect?: string;
    confidenceScore?: number;
  }): InventoryReservation {
    const partCode = data.partCode.trim().toUpperCase();
    const wagonNumber = data.wagonNumber.trim().toUpperCase();
    const quantity = Math.max(1, Math.floor(Number(data.quantity) || 1));
    const source = (data.source || 'MANUAL_INSPECTION') as ReservationSource;
    const confidenceScore = data.confidenceScore !== undefined ? Number(data.confidenceScore) : null;
    const predictedDefect = data.predictedDefect || null;

    const part = this.getPartByCode(partCode);
    if (!part) {
      throw new Error(`Part '${partCode}' does not exist in stores inventory.`);
    }

    const now = new Date().toISOString();
    const reservationId = `res_${crypto.randomUUID()}`;

    // Update reserved quantity on stores_inventory
    this.db.prepare(`
      UPDATE stores_inventory
      SET reserved_quantity = reserved_quantity + ?,
          updated_at = ?
      WHERE part_code = ?
    `).run(quantity, now, partCode);

    // Insert reservation record
    this.db.prepare(`
      INSERT INTO inventory_reservations (
        id, wagon_number, part_code, quantity, source,
        predicted_defect, confidence_score, status, allocated_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RESERVED', NULL, ?, ?)
    `).run(
      reservationId,
      wagonNumber,
      partCode,
      quantity,
      source,
      predictedDefect,
      confidenceScore,
      now,
      now
    );

    // Log audit event
    try {
      this.db.prepare(`
        INSERT INTO inspection_audit_log (
          id, inspection_id, event_type, user_id, user_role, ip_address, payload_json, created_at
        ) VALUES (?, NULL, 'INVENTORY_RESERVED', 'system_omrs', 'SYSTEM', '127.0.0.1', ?, ?)
      `).run(
        `audit_${crypto.randomUUID()}`,
        JSON.stringify({
          reservationId,
          wagonNumber,
          partCode,
          quantity,
          source,
          predictedDefect,
          confidenceScore
        }),
        now
      );
    } catch {
      // Ignore if system user foreign key or schema variant
    }

    const createdRow = this.db.prepare(`
      SELECT r.*, i.part_name, i.bin_location, i.category
      FROM inventory_reservations r
      LEFT JOIN stores_inventory i ON r.part_code = i.part_code
      WHERE r.id = ?
    `).get(reservationId);

    return this.mapReservationRow(createdRow);
  }

  /**
   * Issue reserved part to shop floor (decrements stock_quantity and reserved_quantity)
   */
  public issuePart(reservationId: string): { success: boolean; reservation: InventoryReservation; part: StoresPart } {
    if (!reservationId) {
      throw new Error('Reservation ID is required.');
    }

    const row = this.db.prepare(`
      SELECT r.*, i.part_name, i.bin_location, i.category
      FROM inventory_reservations r
      LEFT JOIN stores_inventory i ON r.part_code = i.part_code
      WHERE r.id = ?
    `).get(reservationId.trim());

    if (!row) {
      throw new Error(`Reservation '${reservationId}' was not found.`);
    }

    const reservation = this.mapReservationRow(row);
    if (reservation.status === 'ISSUED_TO_FLOOR') {
      throw new Error(`Reservation '${reservationId}' has already been issued to the shop floor.`);
    }

    const now = new Date().toISOString();
    const qty = reservation.quantity;

    // Update reservation status
    this.db.prepare(`
      UPDATE inventory_reservations
      SET status = 'ISSUED_TO_FLOOR',
          allocated_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(now, now, reservation.id);

    // Decrement stock and reserved quantities from stores_inventory
    this.db.prepare(`
      UPDATE stores_inventory
      SET stock_quantity = MAX(0, stock_quantity - ?),
          reserved_quantity = MAX(0, reserved_quantity - ?),
          updated_at = ?
      WHERE part_code = ?
    `).run(qty, qty, now, reservation.partCode);

    // Log audit event
    try {
      this.db.prepare(`
        INSERT INTO inspection_audit_log (
          id, inspection_id, event_type, user_id, user_role, ip_address, payload_json, created_at
        ) VALUES (?, NULL, 'INVENTORY_ISSUED', 'stores_depot', 'SUPERVISOR', '127.0.0.1', ?, ?)
      `).run(
        `audit_${crypto.randomUUID()}`,
        JSON.stringify({
          reservationId: reservation.id,
          wagonNumber: reservation.wagonNumber,
          partCode: reservation.partCode,
          quantity: qty
        }),
        now
      );
    } catch {
      // ignore
    }

    const updatedPart = this.getPartByCode(reservation.partCode)!;
    const updatedResRow = this.db.prepare(`
      SELECT r.*, i.part_name, i.bin_location, i.category
      FROM inventory_reservations r
      LEFT JOIN stores_inventory i ON r.part_code = i.part_code
      WHERE r.id = ?
    `).get(reservation.id);

    return {
      success: true,
      reservation: this.mapReservationRow(updatedResRow),
      part: updatedPart
    };
  }

  /**
   * Restock part inventory (increments stock_quantity)
   */
  public restockPart(partCode: string, quantity: number): StoresPart {
    if (!partCode) {
      throw new Error('Part code is required.');
    }
    const cleanCode = partCode.trim().toUpperCase();
    const qty = Math.floor(Number(quantity));
    if (isNaN(qty) || qty <= 0) {
      throw new Error('Restock quantity must be a positive integer.');
    }

    const part = this.getPartByCode(cleanCode);
    if (!part) {
      throw new Error(`Part '${cleanCode}' does not exist in stores inventory.`);
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE stores_inventory
      SET stock_quantity = stock_quantity + ?,
          updated_at = ?
      WHERE part_code = ?
    `).run(qty, now, cleanCode);

    // Log audit event
    try {
      this.db.prepare(`
        INSERT INTO inspection_audit_log (
          id, inspection_id, event_type, user_id, user_role, ip_address, payload_json, created_at
        ) VALUES (?, NULL, 'INVENTORY_RESTOCKED', 'stores_depot', 'SUPERVISOR', '127.0.0.1', ?, ?)
      `).run(
        `audit_${crypto.randomUUID()}`,
        JSON.stringify({
          partCode: cleanCode,
          restockedQuantity: qty,
          newStockQuantity: part.stockQuantity + qty
        }),
        now
      );
    } catch {
      // ignore
    }

    return this.getPartByCode(cleanCode)!;
  }

  /**
   * Get active and historical reservations with optional filters
   */
  public getReservations(wagonNumber?: string, status?: string): InventoryReservation[] {
    let query = `
      SELECT r.*, i.part_name, i.bin_location, i.category
      FROM inventory_reservations r
      LEFT JOIN stores_inventory i ON r.part_code = i.part_code
    `;
    const clauses: string[] = [];
    const params: any[] = [];

    if (wagonNumber && wagonNumber.trim() !== '') {
      clauses.push(`r.wagon_number = ?`);
      params.push(wagonNumber.trim().toUpperCase());
    }

    if (status && status.trim() !== '' && status !== 'ALL') {
      clauses.push(`r.status = ?`);
      params.push(status.trim().toUpperCase());
    }

    if (clauses.length > 0) {
      query += ` WHERE ` + clauses.join(' AND ');
    }

    query += ` ORDER BY r.created_at DESC`;

    const rows = this.db.prepare(query).all(...params);
    return rows.map((r: any) => this.mapReservationRow(r));
  }

  /**
   * Get aggregate inventory KPIs & stats
   */
  public getInventoryStats(): InventoryStats {
    const parts = this.getInventory();
    const totalParts = parts.length;
    const lowStockCount = parts.filter(p => p.stockQuantity <= p.reorderThreshold).length;

    const resRow: any = this.db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(quantity), 0) as total_qty
      FROM inventory_reservations
      WHERE status IN ('RESERVED', 'ALLOCATED')
    `).get();

    const totalReservedCount = Number(resRow?.total_qty ?? 0);
    const totalValuationInr = parts.reduce((acc, p) => acc + (p.stockQuantity * p.unitCostInr), 0);

    return {
      totalParts,
      lowStockCount,
      totalReservedCount,
      totalValuationInr
    };
  }

  /**
   * Upsert a part into inventory (useful for seeding and catalog updates)
   */
  public upsertPart(data: {
    id?: string;
    partCode: string;
    partName: string;
    category: CASNUBCategory;
    unitOfMeasure?: string;
    stockQuantity?: number;
    reservedQuantity?: number;
    reorderThreshold?: number;
    unitCostInr?: number;
    binLocation?: string;
    supplierName?: string;
  }): StoresPart {
    const partCode = data.partCode.trim().toUpperCase();
    const existing = this.getPartByCode(partCode);
    const now = new Date().toISOString();

    if (existing) {
      this.db.prepare(`
        UPDATE stores_inventory
        SET part_name = ?,
            category = ?,
            unit_of_measure = ?,
            stock_quantity = ?,
            reserved_quantity = ?,
            reorder_threshold = ?,
            unit_cost_inr = ?,
            bin_location = ?,
            supplier_name = ?,
            updated_at = ?
        WHERE part_code = ?
      `).run(
        data.partName || existing.partName,
        data.category || existing.category,
        data.unitOfMeasure || existing.unitOfMeasure,
        data.stockQuantity !== undefined ? data.stockQuantity : existing.stockQuantity,
        data.reservedQuantity !== undefined ? data.reservedQuantity : existing.reservedQuantity,
        data.reorderThreshold !== undefined ? data.reorderThreshold : existing.reorderThreshold,
        data.unitCostInr !== undefined ? data.unitCostInr : existing.unitCostInr,
        data.binLocation || existing.binLocation,
        data.supplierName || existing.supplierName,
        now,
        partCode
      );
    } else {
      const id = data.id || `prt_${crypto.randomUUID()}`;
      this.db.prepare(`
        INSERT INTO stores_inventory (
          id, part_code, part_name, category, unit_of_measure, stock_quantity,
          reserved_quantity, reorder_threshold, unit_cost_inr, bin_location,
          supplier_name, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        partCode,
        data.partName,
        data.category,
        data.unitOfMeasure || 'NOS',
        data.stockQuantity ?? 0,
        data.reservedQuantity ?? 0,
        data.reorderThreshold ?? 10,
        data.unitCostInr ?? 0,
        data.binLocation || 'UNASSIGNED',
        data.supplierName || 'RWF Yelahanka / Stores Depot',
        now
      );
    }

    return this.getPartByCode(partCode)!;
  }
}
