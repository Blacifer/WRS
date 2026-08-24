/**
 * Multi-Entity Offline-First IndexedDB Store & Batch Sync Manager (Phase 1 & Phase 2)
 * Indian Railways WRS Raipur Quality Control System
 */

import type {
  InspectionRecord,
  SyncPayload,
  SyncResponse,
  WagonRecord,
  ChecklistItem,
  WagonPhotoRecord,
  WagonTransition
} from '../../../shared/types.ts';

const DB_NAME = 'wrs_raipur_pwa_offline_db_v2';
const DB_VERSION = 2;

const STORE_PENDING_INSPECTIONS = 'pending_inspections';
const STORE_PENDING_CHECKLIST = 'pending_checklist_items';
const STORE_PENDING_PHOTOS = 'pending_photos';
const STORE_PENDING_TRANSITIONS = 'pending_stage_transitions';

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

class MultiEntityOfflineDbManager {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private syncListeners: Array<(count: number) => void> = [];

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
  // 5. Query Pending Counts & Records
  // -------------------------------------------------------------------------

  public async getPendingCount(): Promise<number> {
    try {
      const db = await this.openDb();
      const count1 = await this.countStore(db, STORE_PENDING_INSPECTIONS);
      const count2 = await this.countStore(db, STORE_PENDING_CHECKLIST);
      const count3 = await this.countStore(db, STORE_PENDING_PHOTOS);
      const count4 = await this.countStore(db, STORE_PENDING_TRANSITIONS);
      return count1 + count2 + count3 + count4;
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
  // 6. Caching Helpers for Offline Browsing
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
  // 7. Multi-Entity Batch Sync with Server
  // -------------------------------------------------------------------------

  public async syncPendingBatch(apiBaseUrl: string = '/api', token?: string): Promise<SyncResponse> {
    const pending = await this.getAllPending();
    const totalCount = pending.inspections.length + pending.checklist.length + pending.photos.length + pending.transitions.length;

    if (totalCount === 0) {
      return {
        success: true,
        syncedCount: 0,
        failedCount: 0,
        syncedRecords: []
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

      // Clear synced items
      const db = await this.openDb();
      if (pending.inspections.length > 0) {
        await this.clearStore(db, STORE_PENDING_INSPECTIONS);
      }
      if (pending.checklist.length > 0) {
        await this.clearStore(db, STORE_PENDING_CHECKLIST);
      }
      if (pending.photos.length > 0) {
        await this.clearStore(db, STORE_PENDING_PHOTOS);
      }
      if (pending.transitions.length > 0) {
        await this.clearStore(db, STORE_PENDING_TRANSITIONS);
      }

      this.notifyPendingCountChange();
      return res;
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
}

export const offlineDb = new MultiEntityOfflineDbManager();
