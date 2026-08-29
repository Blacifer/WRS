/**
 * Multi-Entity Offline-First IndexedDB Store & Batch Sync Manager (Phase 1 & Phase 2)
 * Indian Railways WRS Raipur Quality Control System
 */

import { decideQueueSettlement } from '../../../shared/sync/settleQueue.ts';
import type {
  InspectionRecord,
  SyncPayload,
  SyncResponse,
  WagonRecord,
  ChecklistItem,
  WagonPhotoRecord,
  WagonTransition
} from '../../../shared/types.ts';

export type SyncConflict = NonNullable<SyncResponse['conflicts']>[number];

const DB_NAME = 'wrs_raipur_pwa_offline_db_v2';
const DB_VERSION = 3;

const STORE_PENDING_INSPECTIONS = 'pending_inspections';
const STORE_PENDING_CHECKLIST = 'pending_checklist_items';
const STORE_PENDING_PHOTOS = 'pending_photos';
const STORE_PENDING_TRANSITIONS = 'pending_stage_transitions';
const STORE_PENDING_SORTING = 'pending_sorted_springs';

const STORE_CACHED_INSPECTIONS = 'cached_inspections';
const STORE_CACHED_WAGONS = 'cached_wagons';
const STORE_CACHED_CHECKLISTS = 'cached_checklists';

export interface PendingInspection extends Omit<InspectionRecord, 'id' | 'sequenceNumber'> {
  clientTempId: string;
  syncId: string;
  syncStatus: 'LOCAL';
  localCreatedAt: string;
}

export interface PendingChecklistAction {
  clientTempId: string;
  wagonNumber: string;
  category: string;
  partName: string;
  bogiePosition?: string;
  /** Which spring within its nest. Without it a synced spring is invisible to
   *  the exit gate's completeness check, so offline work would silently
   *  produce weaker data than online work. */
  nestIndex?: number;
  status: string;
  isMandatory?: boolean;
  conditionNotes?: string;
  repairAction?: string;
  repairNotes?: string;
  reinspectedStatus?: string;
  photoId?: string;
  inspectedBy?: string;
  inspectedByName?: string;
  createdAt: string;
}

export interface PendingPhotoUpload {
  clientTempId: string;
  wagonNumber: string;
  category: string;
  partName: string;
  stage: string;
  imageBase64: string;
  tags?: string[];
  createdAt: string;
}

export interface PendingTransition {
  clientTempId: string;
  wagonNumber: string;
  fromStage: string;
  toStage: string;
  isOverride?: boolean;
  overrideJustification?: string;
  notes?: string;
  createdAt: string;
}

/**
 * One sorted spring, held on the device until it reaches the server.
 *
 * Sorting is the highest-volume thing this app does — one tap per spring,
 * roughly 700 a shift — and it was the only workflow posting straight to the
 * network with nothing behind it. A dropped connection on shop-floor wifi
 * lost the tap outright, which is the same wound as having no undo: an
 * inspector who watches taps disappear goes back to paper.
 *
 * `syncId` is generated here, once, and never changes. It is what makes a
 * replay safe — the server recognises a second delivery of the same tap as
 * the same spring rather than a second one.
 */
export interface PendingSortedSpring {
  clientTempId: string;
  syncId: string;
  batchId: string;
  bogieType: string;
  condition: string;
  springPosition: string;
  measuredFreeHeight: number;
  heightIsApproximate?: boolean;
  damageType?: string;
  /** The band the inspector tapped. Held for the local tally only — the
   *  stored verdict is always the server's, computed from the height. */
  tappedBand: string | null;
  condemned: boolean;
  createdAt: string;
}

class MultiEntityOfflineDbManager {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private syncListeners: Array<(count: number) => void> = [];
  /*
   * Told about work the server refused, from whichever sync discovered it.
   *
   * A listener rather than a return value because the sync that matters most
   * is the automatic one — nobody taps a sync button; the network simply
   * comes back and the queue drains on its own. That path had no caller to
   * return anything to, so a refused judgement was found and thrown away in
   * the same breath.
   */
  private conflictListeners: Array<(conflicts: SyncConflict[]) => void> = [];

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[OfflineSync] Network online. Auto-syncing pending offline items...');
        this.triggerAutoSync();
      });
    }
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not supported in this environment'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Pending stores
        if (!db.objectStoreNames.contains(STORE_PENDING_INSPECTIONS)) {
          const s = db.createObjectStore(STORE_PENDING_INSPECTIONS, { keyPath: 'clientTempId' });
          s.createIndex('localCreatedAt', 'localCreatedAt', { unique: false });
          s.createIndex('wagonNumber', 'wagonNumber', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_PENDING_CHECKLIST)) {
          const s = db.createObjectStore(STORE_PENDING_CHECKLIST, { keyPath: 'clientTempId' });
          s.createIndex('wagonNumber', 'wagonNumber', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_PENDING_PHOTOS)) {
          const s = db.createObjectStore(STORE_PENDING_PHOTOS, { keyPath: 'clientTempId' });
          s.createIndex('wagonNumber', 'wagonNumber', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_PENDING_TRANSITIONS)) {
          const s = db.createObjectStore(STORE_PENDING_TRANSITIONS, { keyPath: 'clientTempId' });
          s.createIndex('wagonNumber', 'wagonNumber', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_PENDING_SORTING)) {
          const s = db.createObjectStore(STORE_PENDING_SORTING, { keyPath: 'clientTempId' });
          s.createIndex('batchId', 'batchId', { unique: false });
          s.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Cache stores
        if (!db.objectStoreNames.contains(STORE_CACHED_INSPECTIONS)) {
          const s = db.createObjectStore(STORE_CACHED_INSPECTIONS, { keyPath: 'id' });
          s.createIndex('wagonNumber', 'wagonNumber', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_CACHED_WAGONS)) {
          const s = db.createObjectStore(STORE_CACHED_WAGONS, { keyPath: 'wagonNumber' });
        }
        if (!db.objectStoreNames.contains(STORE_CACHED_CHECKLISTS)) {
          const s = db.createObjectStore(STORE_CACHED_CHECKLISTS, { keyPath: 'wagonNumber' });
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        resolve(db);
      };

      request.onerror = (event) => {
        console.error('[IndexedDB] Open error:', (event.target as IDBOpenDBRequest).error);
        reject((event.target as IDBOpenDBRequest).error);
      };
    });

    return this.dbPromise;
  }

  // -------------------------------------------------------------------------
  // 1. Pending Inspections (Phase 1 Springs)
  // -------------------------------------------------------------------------

  public async enqueueInspection(record: Omit<InspectionRecord, 'id' | 'sequenceNumber'>): Promise<string> {
    const db = await this.openDb();
    const clientTempId = `insp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const pendingItem: PendingInspection = {
      ...record,
      clientTempId,
      syncId: clientTempId,
      syncStatus: 'LOCAL',
      localCreatedAt: record.offline_created_at || now,
      timestamp: record.timestamp || now
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_INSPECTIONS, 'readwrite');
      const store = tx.objectStore(STORE_PENDING_INSPECTIONS);
      const req = store.put(pendingItem);
      req.onsuccess = () => {
        this.notifyPendingCountChange();
        resolve(clientTempId);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------------------------------------------------------------
  // 2. Pending Checklist Items (Phase 2 CASNUB Parts)
  // -------------------------------------------------------------------------

  public async enqueueChecklistItem(action: Omit<PendingChecklistAction, 'clientTempId' | 'createdAt'>): Promise<string> {
    const db = await this.openDb();
    const clientTempId = `chk-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const pendingItem: PendingChecklistAction = {
      ...action,
      clientTempId,
      createdAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_CHECKLIST, 'readwrite');
      const store = tx.objectStore(STORE_PENDING_CHECKLIST);
      const req = store.put(pendingItem);
      req.onsuccess = () => {
        this.notifyPendingCountChange();
        resolve(clientTempId);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------------------------------------------------------------
  // 3. Pending Photos
  // -------------------------------------------------------------------------

  public async enqueuePhoto(photo: Omit<PendingPhotoUpload, 'clientTempId' | 'createdAt'>): Promise<string> {
    const db = await this.openDb();
    const clientTempId = `pht-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const pendingItem: PendingPhotoUpload = {
      ...photo,
      clientTempId,
      createdAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_PHOTOS, 'readwrite');
      const store = tx.objectStore(STORE_PENDING_PHOTOS);
      const req = store.put(pendingItem);
      req.onsuccess = () => {
        this.notifyPendingCountChange();
        resolve(clientTempId);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------------------------------------------------------------
  // 4. Pending Stage Transitions
  // -------------------------------------------------------------------------

  public async enqueueTransition(tr: Omit<PendingTransition, 'clientTempId' | 'createdAt'>): Promise<string> {
    const db = await this.openDb();
    const clientTempId = `trn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const pendingItem: PendingTransition = {
      ...tr,
      clientTempId,
      createdAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_TRANSITIONS, 'readwrite');
      const store = tx.objectStore(STORE_PENDING_TRANSITIONS);
      const req = store.put(pendingItem);
      req.onsuccess = () => {
        this.notifyPendingCountChange();
        resolve(clientTempId);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------------------------------------------------------------
  // 5. Pending Sorted Springs (bulk sorting — the highest-volume path)
  // -------------------------------------------------------------------------

  public async enqueueSortedSpring(
    spring: Omit<PendingSortedSpring, 'clientTempId' | 'syncId' | 'createdAt'>
  ): Promise<PendingSortedSpring> {
    const db = await this.openDb();
    const clientTempId = `srt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const pendingItem: PendingSortedSpring = {
      ...spring,
      clientTempId,
      // The device's own id for this tap, fixed for its lifetime. The server
      // dedupes on it, so replaying a queued spring cannot double-count it.
      syncId: clientTempId,
      createdAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_SORTING, 'readwrite');
      const req = tx.objectStore(STORE_PENDING_SORTING).put(pendingItem);
      req.onsuccess = () => {
        this.notifyPendingCountChange();
        resolve(pendingItem);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** Queued springs for one session, oldest first — the order they were tapped. */
  public async getPendingSorting(batchId?: string): Promise<PendingSortedSpring[]> {
    try {
      const db = await this.openDb();
      const all = await this.getAllFromStore<PendingSortedSpring>(db, STORE_PENDING_SORTING);
      const rows = batchId ? all.filter((r) => r.batchId === batchId) : all;
      return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch {
      return [];
    }
  }

  /**
   * Drops one queued spring.
   *
   * Used by sync when a spring has landed, and by undo when the inspector
   * takes back a tap that never left the device. An undo of an unsynced tap
   * has nothing to supersede on the server — the spring was never recorded —
   * so removing it from the queue IS the correction, and no void row is
   * needed.
   */
  public async removePendingSorting(clientTempId: string): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_PENDING_SORTING, 'readwrite');
        const req = tx.objectStore(STORE_PENDING_SORTING).delete(clientTempId);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
      this.notifyPendingCountChange();
    } catch {
      /* nothing to remove */
    }
  }

  /**
   * Sends queued springs to the server, one at a time, deleting each as it
   * lands.
   *
   * Deliberately per-record rather than one batch cleared wholesale. An
   * inspector keeps tapping while a sync runs — that is the whole point of a
   * background sync — and clearing the store at the end would destroy every
   * spring tapped during the request. Each row is removed only once the
   * server has confirmed that particular spring.
   *
   * Stops at the first failure and leaves the rest queued. A half-drained
   * queue is fine; the order is preserved and the next attempt resumes.
   */
  public async syncPendingSorting(
    apiBaseUrl: string = '/api',
    token?: string
  ): Promise<{ synced: number; remaining: number; error?: string }> {
    const queued = await this.getPendingSorting();
    if (queued.length === 0) return { synced: 0, remaining: 0 };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let synced = 0;
    for (const spring of queued) {
      try {
        const response = await fetch(`${apiBaseUrl}/sorting/record`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            batchId: spring.batchId,
            bogieType: spring.bogieType,
            condition: spring.condition,
            springPosition: spring.springPosition,
            measuredFreeHeight: spring.measuredFreeHeight,
            heightIsApproximate: spring.heightIsApproximate,
            damageType: spring.damageType,
            syncId: spring.syncId
          })
        });

        if (!response.ok) {
          return {
            synced,
            remaining: queued.length - synced,
            error: `Sync stopped at HTTP ${response.status}`
          };
        }

        // Landed — or was already there from an earlier attempt. Either way
        // this spring is on the server and must leave the queue.
        await this.removePendingSorting(spring.clientTempId);
        synced++;
      } catch (err: any) {
        return {
          synced,
          remaining: queued.length - synced,
          error: err?.message || 'Network error while syncing sorted springs'
        };
      }
    }

    return { synced, remaining: 0 };
  }

  // -------------------------------------------------------------------------
  // 6. Query Pending Counts & Records
  // -------------------------------------------------------------------------

  public async getPendingCount(): Promise<number> {
    try {
      const db = await this.openDb();
      const count1 = await this.countStore(db, STORE_PENDING_INSPECTIONS);
      const count2 = await this.countStore(db, STORE_PENDING_CHECKLIST);
      const count3 = await this.countStore(db, STORE_PENDING_PHOTOS);
      const count4 = await this.countStore(db, STORE_PENDING_TRANSITIONS);
      const count5 = await this.countStore(db, STORE_PENDING_SORTING);
      return count1 + count2 + count3 + count4 + count5;
    } catch {
      return 0;
    }
  }

  private countStore(db: IDBDatabase, storeName: string): Promise<number> {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });
  }

  public async getAllPending(): Promise<{
    inspections: PendingInspection[];
    checklist: PendingChecklistAction[];
    photos: PendingPhotoUpload[];
    transitions: PendingTransition[];
  }> {
    const db = await this.openDb();
    const inspections = await this.getAllFromStore<PendingInspection>(db, STORE_PENDING_INSPECTIONS);
    const checklist = await this.getAllFromStore<PendingChecklistAction>(db, STORE_PENDING_CHECKLIST);
    const photos = await this.getAllFromStore<PendingPhotoUpload>(db, STORE_PENDING_PHOTOS);
    const transitions = await this.getAllFromStore<PendingTransition>(db, STORE_PENDING_TRANSITIONS);

    return { inspections, checklist, photos, transitions };
  }

  private getAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  // -------------------------------------------------------------------------
  // 7. Caching Helpers for Offline Browsing
  // -------------------------------------------------------------------------

  public async cacheWagons(wagons: WagonRecord[]): Promise<void> {
    try {
      const db = await this.openDb();
      const tx = db.transaction(STORE_CACHED_WAGONS, 'readwrite');
      const store = tx.objectStore(STORE_CACHED_WAGONS);
      for (const w of wagons) {
        store.put(w);
      }
    } catch (err) {
      console.warn('[OfflineDb] Failed to cache wagons:', err);
    }
  }

  public async getCachedWagons(): Promise<WagonRecord[]> {
    try {
      const db = await this.openDb();
      return this.getAllFromStore<WagonRecord>(db, STORE_CACHED_WAGONS);
    } catch {
      return [];
    }
  }

  public async cacheInspections(records: InspectionRecord[]): Promise<void> {
    try {
      const db = await this.openDb();
      const tx = db.transaction(STORE_CACHED_INSPECTIONS, 'readwrite');
      const store = tx.objectStore(STORE_CACHED_INSPECTIONS);
      for (const r of records) {
        store.put(r);
      }
    } catch (err) {
      console.warn('[OfflineDb] Failed to cache inspections:', err);
    }
  }

  public async getCachedInspections(): Promise<InspectionRecord[]> {
    try {
      const db = await this.openDb();
      return this.getAllFromStore<InspectionRecord>(db, STORE_CACHED_INSPECTIONS);
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // 8. Multi-Entity Batch Sync with Server
  // -------------------------------------------------------------------------

  public async syncPendingBatch(apiBaseUrl: string = '/api', token?: string): Promise<SyncResponse> {
    // Sorted springs go first and by their own route, so the "sync now"
    // button and the online event drain them too rather than leaving the
    // shop's highest-volume work waiting on a wagon batch.
    const sorting = await this.syncPendingSorting(apiBaseUrl, token);

    const pending = await this.getAllPending();
    const totalCount = pending.inspections.length + pending.checklist.length + pending.photos.length + pending.transitions.length;

    if (totalCount === 0) {
      return {
        success: !sorting.error,
        syncedCount: sorting.synced,
        failedCount: sorting.remaining,
        syncedRecords: [],
        ...(sorting.error ? { errors: [{ error: sorting.error }] } : {})
      };
    }

    const payload = {
      records: pending.inspections,
      checklistItems: pending.checklist,
      photos: pending.photos,
      transitions: pending.transitions,
      deviceId: 'WRS-RAIPUR-PWA-' + (navigator.userAgent.slice(0, 20) || 'APP'),
      syncTimestamp: new Date().toISOString()
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/sync/batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Sync failed with HTTP ${response.status}`);
      }

      const res = await response.json();

      /*
       * Removing what the server took, and ONLY what the server took.
       *
       * This used to clear each store outright on any 200, which lost work in
       * two different ways.
       *
       * The first is a race: an inspector keeps working while a sync runs —
       * that is the point of a background sync — and anything queued between
       * reading the batch and clearing the store was destroyed without ever
       * being sent. So deletion is now by the exact keys that were submitted.
       *
       * The second is worse, because it was silent and it hit the safety
       * records. The server answers 200 even when individual items were
       * refused, and it says which and why: an offline PASS arriving over
       * another inspector's CONDEMNED is REJECTED, by design, so a crack
       * cannot be erased by a stale queued verdict. The device then deleted
       * that item anyway. The inspector's queue emptied, nothing was said,
       * and a judgement they believed was recorded had been thrown away.
       *
       * Now:
       *   accepted  — removed, it is on the server.
       *   conflicted — removed, but RETURNED so the inspector is told. The
       *                server rejected it as a decision, not a failure;
       *                sending it again would only be refused again.
       *   errored   — KEPT and retried. A queue that stays visibly non-empty
       *               is a far better failure than one that empties by
       *               deleting the work.
       */
      const db = await this.openDb();
      const settle = async (storeName: string, rows: Array<{ clientTempId: string }>) => {
        const { remove } = decideQueueSettlement(rows, res);
        for (const key of remove) {
          await this.deleteFromStore(db, storeName, key);
        }
      };

      await settle(STORE_PENDING_INSPECTIONS, pending.inspections);
      await settle(STORE_PENDING_CHECKLIST, pending.checklist);
      await settle(STORE_PENDING_PHOTOS, pending.photos);
      await settle(STORE_PENDING_TRANSITIONS, pending.transitions);

      this.notifyPendingCountChange();
      // Announced rather than only returned. These are the only record of an
      // offline judgement that was refused, and the person who made it has to
      // be told regardless of which sync found out.
      this.reportConflicts(res.conflicts);
      return {
        ...res,
        syncedCount: (res.syncedCount || 0) + sorting.synced
      };
    } catch (err: any) {
      console.error('[OfflineSync] Batch sync error:', err);
      return {
        success: false,
        syncedCount: 0,
        failedCount: totalCount,
        syncedRecords: [],
        errors: [{ error: err.message || 'Network error during sync' }]
      };
    }
  }

  private deleteFromStore(db: IDBDatabase, storeName: string, key: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private clearStore(db: IDBDatabase, storeName: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Subscribes to work the server refused.
   *
   * Every sync path reports through here, so a conflict is surfaced whether
   * the inspector pressed sync or the network simply returned.
   */
  public onSyncConflicts(callback: (conflicts: SyncConflict[]) => void): () => void {
    this.conflictListeners.push(callback);
    return () => {
      this.conflictListeners = this.conflictListeners.filter((l) => l !== callback);
    };
  }

  private reportConflicts(conflicts: SyncConflict[] | undefined): void {
    if (!conflicts?.length) return;
    for (const listener of this.conflictListeners) {
      try {
        listener(conflicts);
      } catch (err) {
        console.error(err);
      }
    }
  }

  public onPendingCountChange(callback: (count: number) => void): () => void {
    this.syncListeners.push(callback);
    this.getPendingCount().then(callback);
    return () => {
      this.syncListeners = this.syncListeners.filter(l => l !== callback);
    };
  }

  private async notifyPendingCountChange(): Promise<void> {
    const count = await this.getPendingCount();
    for (const listener of this.syncListeners) {
      try {
        listener(count);
      } catch (err) {
        console.error(err);
      }
    }
  }

  private async triggerAutoSync(): Promise<void> {
    const token = localStorage.getItem('wrs_token') || undefined;
    await this.syncPendingBatch('/api', token);
  }

  /** Whether the device believes it can reach the network at all. */
  public isOnline(): boolean {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }
}

export const offlineDb = new MultiEntityOfflineDbManager();
