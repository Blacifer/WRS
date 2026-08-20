/**
 * Test Application / Dispatcher exposing full REST API Endpoints
 * Indian Railways WRS Raipur (Phase 1 Spring System + Phase 2 Wagon QC)
 *
 * Implements standard REST endpoints matching PROJECT.md interface contracts.
 */

import { AuditDatabase } from './audit_db.ts';
import { AuthService } from './auth_service.ts';
import { CaliperOCREngine } from './ocr_engine.ts';
import { ServerSyncProcessor } from './sync_engine.ts';
import { classifySpring } from './classification_engine.ts';
import { getTranslation } from './i18n_data.ts';
import { WagonLifecycleEngine } from './wagon_lifecycle.ts';
import { ChecklistEngine } from './checklist_engine.ts';
import { ExitGateEngine } from './gate_engine.ts';
import { AnalyticsEngine } from './analytics_engine.ts';
import { PhotoEvidenceEngine } from './photo_engine.ts';
import { parseVoiceCommand } from './speech_mock.ts';
import { simulateCVDetection } from './camera_mock.ts';
import { evaluateAcousticSpectrum, MockAnalyserNode } from './audio_mock.ts';
import { decodeComponentQR, encodeComponentQR } from './qr_mock.ts';
import type {
  ClassificationRequest,
  DamageType,
  BandColor,
  SpringPosition,
  SpringCondition,
  BogieType,
  WagonRegisterRequest,
  WagonTransitionRequest,
  LifecycleStage,
  CASNUBCategory,
  PartInspectionStatus,
  PartCriticality,
  ChecklistItem,
  ChecklistConfigEntry,
  GateSignoffRequest,
  PhotoUploadRequest,
  WagonBatchSyncPayload,
  StoresPart,
  InventoryReservation,
  ReservePartRequest,
  IssuePartRequest,
  RestockPartRequest,
  SimulateOMRSScanRequest,
  SerializedComponent,
  RegisterComponentRequest,
  AssignComponentRequest
} from '../../shared/types.ts';


export interface TestRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}

export interface TestResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export class TestApp {
  public auditDb: AuditDatabase;
  public authService: AuthService;
  public ocrEngine: CaliperOCREngine;
  public syncProcessor: ServerSyncProcessor;
  public photoEngine: PhotoEvidenceEngine;

  constructor(dbPath: string = ':memory:') {
    this.auditDb = new AuditDatabase(dbPath);
    this.authService = new AuthService();
    this.ocrEngine = new CaliperOCREngine();
    this.syncProcessor = new ServerSyncProcessor(this.auditDb);
    this.photoEngine = new PhotoEvidenceEngine();
  }

  /**
   * Universal Dispatcher for simulated HTTP calls
   */
  public async handleRequest(req: TestRequest): Promise<TestResponse> {
    const urlObj = new URL(req.url, 'http://localhost:3000');
    const pathname = urlObj.pathname;
    const queryParams: Record<string, string> = {};
    urlObj.searchParams.forEach((v, k) => { queryParams[k] = v; });
    if (req.query) {
      Object.assign(queryParams, req.query);
    }

    const authHeader = req.headers?.['authorization'] || req.headers?.['Authorization'] || '';
    let currentUser: ReturnType<typeof this.authService.verifyToken> = null;
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      currentUser = this.authService.verifyToken(token);
    }

    // JSON response helper
    const json = (status: number, data: unknown): TestResponse => ({
      status,
      headers: { 'content-type': 'application/json' },
      body: data
    });

    // -----------------------------------------------------------------------
    // 1. Classification API (Phase 1)
    // -----------------------------------------------------------------------
    if (pathname === '/api/classification/classify' && req.method === 'POST') {
      const body = req.body as ClassificationRequest;
      if (!body || !body.bogieType || !body.condition || !body.position || body.measuredHeight === undefined) {
        return json(400, { error: 'Missing required classification fields' });
      }
      const result = classifySpring(body);
      return json(200, result);
    }

    // -----------------------------------------------------------------------
    // 2. Auth APIs (Phase 1 & Phase 2 Shared RBAC)
    // -----------------------------------------------------------------------
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const { username, password } = (req.body || {}) as { username?: string; password?: string };
      if (!username || !password) {
        return json(400, { error: 'Username and password are required' });
      }
      const loginResult = this.authService.login(username, password);
      if (!loginResult) {
        return json(401, { error: 'Invalid username or password' });
      }
      return json(200, loginResult);
    }

    if (pathname === '/api/auth/request-otp' && req.method === 'POST') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      const { action } = (req.body || {}) as { action?: 'OVERRIDE' | 'EXPORT' | 'USER_MGMT' };
      if (!action) {
        return json(400, { error: 'Action is required for OTP request' });
      }
      const otpRes = this.authService.requestOTP({ action, userId: currentUser.id });
      return json(200, otpRes);
    }

    if (pathname === '/api/auth/verify-otp' && req.method === 'POST') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      const { otpId, otpCode } = (req.body || {}) as { otpId?: string; otpCode?: string };
      if (!otpId || !otpCode) {
        return json(400, { error: 'otpId and otpCode are required' });
      }
      const verifyRes = this.authService.verifyOTP({ otpId, otpCode });
      if (!verifyRes.success) {
        return json(400, { error: verifyRes.error });
      }
      return json(200, verifyRes);
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      return json(200, { user: currentUser });
    }

    // -----------------------------------------------------------------------
    // 3. Immutable Inspection Audit APIs (Phase 1)
    // -----------------------------------------------------------------------
    if (pathname === '/api/inspections' && req.method === 'POST') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required to log inspections' });
      }
      if (!this.authService.checkPermission(currentUser, 'INSPECT')) {
        return json(403, { error: 'Forbidden: User lacks INSPECT permission' });
      }

      const body = (req.body || {}) as {
        wagonNumber: string;
        bogieType: BogieType;
        springPosition: SpringPosition;
        condition: SpringCondition;
        measuredFreeHeight: number;
        damageType?: DamageType;
        damageNotes?: string;
        overrideBand?: BandColor;
        overrideReason?: string;
        otpToken?: string;
      };

      if (!body.wagonNumber || !body.bogieType || !body.springPosition || !body.condition || body.measuredFreeHeight === undefined) {
        return json(400, { error: 'Missing required inspection parameters' });
      }

      const classResult = classifySpring({
        bogieType: body.bogieType,
        condition: body.condition,
        position: body.springPosition,
        measuredHeight: body.measuredFreeHeight,
        damageType: body.damageType,
        damageNotes: body.damageNotes
      });

      let isOverridden = false;
      let finalBand = classResult.band;
      let originalBand = classResult.band;

      if (body.overrideBand && body.overrideBand !== classResult.band) {
        if (!this.authService.checkPermission(currentUser, 'OVERRIDE')) {
          return json(403, { error: 'Forbidden: Only Supervisors or Admins can override classifications' });
        }
        if (!body.overrideReason || body.overrideReason.trim().length < 5) {
          return json(400, { error: 'Mandatory override reason with justification is required' });
        }
        if (!body.otpToken || !this.authService.validateOtpToken(body.otpToken, 'OVERRIDE')) {
          return json(403, { error: 'Valid OTP authorization token required for supervisor override' });
        }

        this.authService.consumeOtpToken(body.otpToken);
        isOverridden = true;
        finalBand = body.overrideBand;
      }

      const record = this.auditDb.logInspection({
        inspectorId: currentUser.id,
        inspectorName: currentUser.name,
        wagonNumber: body.wagonNumber,
        bogieType: body.bogieType,
        springPosition: body.springPosition,
        condition: body.condition,
        measuredFreeHeight: body.measuredFreeHeight,
        classifiedBand: finalBand,
        bandRoman: classResult.bandRoman,
        status: classResult.status,
        damageType: body.damageType || 'NONE',
        damageNotes: body.damageNotes,
        isOverridden,
        originalBand: isOverridden ? originalBand : undefined,
        overrideBand: isOverridden ? body.overrideBand : undefined,
        overrideReason: isOverridden ? body.overrideReason : undefined,
        supervisorId: isOverridden ? currentUser.id : undefined,
        supervisorName: isOverridden ? currentUser.name : undefined,
        tableReference: classResult.tableReference,
        timestamp: new Date().toISOString()
      });

      return json(201, record);
    }

    if (pathname === '/api/inspections' && req.method === 'GET') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }

      const filter = {
        wagonNumber: queryParams.wagonNumber,
        startDate: queryParams.startDate,
        endDate: queryParams.endDate,
        inspectorId: queryParams.inspectorId,
        band: queryParams.band as BandColor,
        status: queryParams.status as 'PASS' | 'CONDEMNED',
        bogieType: queryParams.bogieType as BogieType,
        condition: queryParams.condition as SpringCondition,
        page: queryParams.page ? parseInt(queryParams.page, 10) : 1,
        limit: queryParams.limit ? parseInt(queryParams.limit, 10) : 50
      };

      const results = this.auditDb.queryInspections(filter);
      return json(200, results);
    }

    if (pathname === '/api/inspections/stats' && req.method === 'GET') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      if (!this.authService.checkPermission(currentUser, 'VIEW_REPORTS')) {
        return json(403, { error: 'Forbidden: Only Supervisors and Admins can view analytics reports' });
      }
      const stats = this.auditDb.getStats();
      return json(200, stats);
    }

    if (pathname === '/api/inspections/export' && req.method === 'GET') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      if (!this.authService.checkPermission(currentUser, 'EXPORT')) {
        return json(403, { error: 'Forbidden: Only Admins can export audit records' });
      }

      const otpToken = req.headers?.['x-otp-token'] || queryParams.otpToken;
      if (!otpToken || !this.authService.validateOtpToken(otpToken, 'EXPORT')) {
        return json(403, { error: 'Valid OTP authorization token required for audit export' });
      }
      this.authService.consumeOtpToken(otpToken);

      const format = (queryParams.format === 'csv' ? 'csv' : 'json') as 'csv' | 'json';
      const data = this.auditDb.exportAuditData(format);

      if (format === 'csv') {
        return {
          status: 200,
          headers: { 'content-type': 'text/csv' },
          body: data
        };
      }
      return json(200, JSON.parse(data));
    }

    if (pathname.startsWith('/api/inspections') && ['PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      return json(405, {
        error: 'Method Not Allowed: Inspection audit log is immutable. UPDATE and DELETE are prohibited.'
      });
    }

    // -----------------------------------------------------------------------
    // 4. OCR API (Phase 1)
    // -----------------------------------------------------------------------
    if (pathname === '/api/ocr/read-caliper' && req.method === 'POST') {
      const { imageBase64, imageText } = (req.body || {}) as { imageBase64?: string; imageText?: string };
      if (!imageBase64 && !imageText) {
        return json(400, { error: 'imageBase64 or imageText is required' });
      }
      const ocrResult = await this.ocrEngine.readCaliperImage(imageBase64 || imageText || '');
      return json(200, ocrResult);
    }

    // -----------------------------------------------------------------------
    // 5. Offline Sync Batch APIs (Phase 1 & Phase 2)
    // -----------------------------------------------------------------------
    if (pathname === '/api/sync/batch' && req.method === 'POST') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      const syncPayload = req.body as Parameters<typeof this.syncProcessor.processBatchSync>[0];
      if (!syncPayload || !Array.isArray(syncPayload.records)) {
        return json(400, { error: 'Invalid sync payload' });
      }
      const syncResult = this.syncProcessor.processBatchSync(syncPayload);
      return json(200, syncResult);
    }

    if (pathname === '/api/sync/wagon-batch' && req.method === 'POST') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      const payload = req.body as WagonBatchSyncPayload;
      if (!payload) {
        return json(400, { error: 'Invalid wagon batch sync payload' });
      }

      let syncedWagons = 0;
      let syncedTransitions = 0;
      let syncedChecklistItems = 0;
      let syncedPhotos = 0;

      if (payload.wagons) {
        for (const w of payload.wagons) {
          if (!this.auditDb.getWagon(w.wagonNumber)) {
            this.auditDb.registerWagon(w);
            if (w.currentStage && w.currentStage !== 'ENTRY_REGISTRATION') {
              this.auditDb.updateWagonStage(w.wagonNumber, w.currentStage);
            }
            syncedWagons++;
          }
        }
      }

      if (payload.transitions) {
        for (const t of payload.transitions) {
          this.auditDb.logTransition({
            wagonNumber: t.wagonNumber,
            fromStage: t.fromStage,
            toStage: t.toStage,
            userId: t.userId,
            userName: t.userName,
            userRole: t.userRole,
            notes: t.notes || undefined,
            isOverride: t.isOverride,
            overrideJustification: t.overrideJustification || undefined,
            timestamp: t.timestamp
          });
          this.auditDb.updateWagonStage(t.wagonNumber, t.toStage);
          syncedTransitions++;
        }
      }

      if (payload.checklistItems) {
        for (const item of payload.checklistItems) {
          const existing = this.auditDb.getChecklistItems(item.wagonNumber).find(i => i.id === item.id || (i.category === item.category && i.partName === item.partName));
          if (existing) {
            this.auditDb.updateChecklistItem(existing.id, item);
          } else {
            this.auditDb.saveChecklistItems([item]);
          }
          syncedChecklistItems++;
        }
      }

      if (payload.photos) {
        for (const p of payload.photos) {
          this.photoEngine.uploadPhoto({
            wagonNumber: p.wagonNumber,
            partCategory: p.partCategory,
            partName: p.partName,
            imageBase64: p.imageBase64,
            tags: p.tags
          }, { id: p.inspectorId, name: p.inspectorName });
          syncedPhotos++;
        }
      }

      return json(200, {
        success: true,
        syncedWagons,
        syncedTransitions,
        syncedChecklistItems,
        syncedPhotos,
        failedCount: 0
      });
    }

    // -----------------------------------------------------------------------
    // 6. i18n API (Phase 1 & Phase 2)
    // -----------------------------------------------------------------------
    if (pathname.startsWith('/api/i18n/')) {
      const lang = pathname.split('/').pop() === 'hi' ? 'hi' : 'en';
      const dict = getTranslation(lang);
      return json(200, dict);
    }

    // -----------------------------------------------------------------------
    // 7. Phase 2: Wagon Lifecycle APIs (`/api/wagons`)
    // -----------------------------------------------------------------------
    if (pathname === '/api/wagons/register' && req.method === 'POST') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required to register wagons' });
      }

      const body = (req.body || {}) as WagonRegisterRequest;
      const validation = WagonLifecycleEngine.validateWagonNumber(body.wagonNumber);
      if (!validation.valid) {
        return json(400, { error: validation.error || 'Invalid wagon number format' });
      }

      if (!body.wagonType || typeof body.wagonType !== 'string' || body.wagonType.trim().length === 0) {
        return json(400, { error: 'Wagon type is required' });
      }

      if (!body.owningRailway || typeof body.owningRailway !== 'string' || body.owningRailway.trim().length === 0) {
        return json(400, { error: 'Owning railway is required' });
      }

      const existing = this.auditDb.getWagon(body.wagonNumber.trim());
      if (existing) {
        return json(409, { error: `Wagon ${body.wagonNumber} is already registered in the workshop system` });
      }

      const wagon = this.auditDb.registerWagon({
        wagonNumber: body.wagonNumber.trim(),
        wagonType: body.wagonType.trim().toUpperCase(),
        owningRailway: body.owningRailway.trim().toUpperCase(),
        entryNotes: body.entryNotes,
        conditionNotes: body.conditionNotes,
        entryDate: body.entryDate
      });

      // Generate default RDSO CASNUB checklist items
      const configs = this.auditDb.getChecklistConfigs(wagon.wagonType);
      const checklistItems = ChecklistEngine.generateInitialChecklist(wagon.wagonNumber, wagon.wagonType, configs);
      this.auditDb.saveChecklistItems(checklistItems);

      // Log initial transition (ENTRY_REGISTRATION)
      this.auditDb.logTransition({
        wagonNumber: wagon.wagonNumber,
        fromStage: 'ENTRY_REGISTRATION',
        toStage: 'ENTRY_REGISTRATION',
        userId: currentUser.id,
        userName: currentUser.name,
        userRole: currentUser.role,
        notes: body.entryNotes || 'Wagon arrived and registered at WRS Raipur'
      });

      return json(201, {
        wagon,
        checklistCount: checklistItems.length,
        message: 'Wagon successfully registered and initial CASNUB checklist generated'
      });
    }

    if (pathname === '/api/wagons' && req.method === 'GET') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }

      const wagons = this.auditDb.getAllWagons({
        stage: queryParams.stage,
        wagonType: queryParams.wagonType,
        owningRailway: queryParams.owningRailway,
        search: queryParams.search || queryParams.query
      });

      return json(200, {
        wagons,
        total: wagons.length
      });
    }

    // Detail, Transition, Timeline, Checklist, Gate, Photos, Certificate for a specific wagon
    if (pathname.startsWith('/api/wagons/') && pathname !== '/api/wagons/register') {
      const rest = pathname.substring('/api/wagons/'.length);
      const knownSuffixes = [
        '/transition',
        '/timeline',
        '/checklist/items',
        '/checklist',
        '/gate/status',
        '/gate/signoff',
        '/certificate',
        '/photos'
      ];

      let rawWagonNumber = '';
      let subPath = '';

      // Check if URL ends with or contains one of the known suffixes
      let foundSuffix = '';
      for (const s of knownSuffixes) {
        const idx = rest.lastIndexOf(s);
        if (idx !== -1 && (idx + s.length === rest.length || rest[idx + s.length] === '/')) {
          rawWagonNumber = decodeURIComponent(rest.substring(0, idx));
          subPath = rest.substring(idx);
          foundSuffix = s;
          break;
        }
      }

      if (!foundSuffix) {
        rawWagonNumber = decodeURIComponent(rest);
        subPath = '';
      }

      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }

      const wagon = this.auditDb.getWagon(rawWagonNumber);
      if (!wagon) {
        return json(404, { error: `Wagon ${rawWagonNumber} not found` });
      }

      // GET /api/wagons/:wagonNumber -> Details
      if (subPath === '' && req.method === 'GET') {
        const items = this.auditDb.getChecklistItems(wagon!.wagonNumber);
        const springs = this.auditDb.queryInspections({ wagonNumber: wagon!.wagonNumber }).records;
        ChecklistEngine.syncPhase1SpringsIntoChecklist(items, springs);
        const photos = this.photoEngine.getPhotosByWagon(wagon!.wagonNumber);
        const transitions = this.auditDb.getTransitions(wagon!.wagonNumber);
        const certificate = this.auditDb.getReleaseCertificate(wagon!.wagonNumber);

        return json(200, {
          wagon,
          timeline: transitions,
          checklistSummary: {
            totalItems: items.length,
            passedItems: items.filter(i => i.status === 'PASS').length,
            failedItems: items.filter(i => i.status === 'FAIL').length,
            condemnedItems: items.filter(i => i.status === 'CONDEMNED').length,
            repairedItems: items.filter(i => i.status === 'REPAIRED' || i.status === 'REPLACED').length
          },
          springSummary: {
            totalSprings: springs.length,
            passedSprings: springs.filter(s => s.status === 'PASS').length,
            condemnedSprings: springs.filter(s => s.status === 'CONDEMNED').length
          },
          photosCount: photos.length,
          certificate: certificate ? { certificateNumber: certificate.certificateNumber, releaseDate: certificate.releaseDate } : null
        });
      }

      // POST /api/wagons/:wagonNumber/transition
      if (subPath === '/transition' && req.method === 'POST') {
        const body = (req.body || {}) as WagonTransitionRequest;
        if (!body.targetStage) {
          return json(400, { error: 'targetStage is required' });
        }

        const isSupervisor = this.authService.checkPermission(currentUser, 'OVERRIDE');
        const transitionCheck = WagonLifecycleEngine.validateTransition(
          wagon!.currentStage,
          body.targetStage,
          isSupervisor,
          Boolean(body.supervisorOverride),
          body.overrideJustification
        );

        if (!transitionCheck.allowed) {
          const status = transitionCheck.error?.includes('Only Supervisors') ? 403 : 400;
          return json(status, { error: transitionCheck.error });
        }

        // If override with OTP
        if (transitionCheck.isOverride && body.otpToken) {
          if (!this.authService.validateOtpToken(body.otpToken, 'OVERRIDE')) {
            return json(403, { error: 'Invalid or expired OTP token for supervisor override' });
          }
          this.authService.consumeOtpToken(body.otpToken);
        }

        // Special exit gate validation if moving to Stage 7 (RELEASE)
        if (body.targetStage === 'RELEASE') {
          const items = this.auditDb.getChecklistItems(wagon!.wagonNumber);
          const springs = this.auditDb.queryInspections({ wagonNumber: wagon!.wagonNumber }).records;
          ChecklistEngine.syncPhase1SpringsIntoChecklist(items, springs);
          const signoff = this.auditDb.getGateSignoff(wagon!.wagonNumber);
          const gateStatus = ExitGateEngine.evaluateGateStatus(wagon!, items, springs, Boolean(signoff));

          if (!gateStatus.canRelease) {
            return json(422, {
              error: 'Zero-Defect Exit Gate verification failed: Cannot release wagon with active blockers',
              blockers: gateStatus.blockers,
              summary: gateStatus.summary
            });
          }
        }

        const updatedWagon = this.auditDb.updateWagonStage(wagon!.wagonNumber, body.targetStage);
        const transition = this.auditDb.logTransition({
          wagonNumber: wagon!.wagonNumber,
          fromStage: wagon!.currentStage,
          toStage: body.targetStage,
          userId: currentUser.id,
          userName: currentUser.name,
          userRole: currentUser.role,
          notes: body.notes,
          isOverride: transitionCheck.isOverride,
          overrideJustification: body.overrideJustification,
          otpToken: body.otpToken
        });

        return json(200, {
          success: true,
          wagon: updatedWagon,
          transition,
          message: `Wagon ${wagon!.wagonNumber} transitioned from ${wagon!.currentStage} to ${body.targetStage}`
        });
      }

      // GET /api/wagons/:wagonNumber/timeline
      if (subPath === '/timeline' && req.method === 'GET') {
        const transitions = this.auditDb.getTransitions(wagon!.wagonNumber);
        return json(200, {
          wagonNumber: wagon!.wagonNumber,
          timeline: transitions,
          transitions,
          totalTransitions: transitions.length
        });
      }

      // GET /api/wagons/:wagonNumber/checklist
      if (subPath === '/checklist' && req.method === 'GET') {
        const items = this.auditDb.getChecklistItems(wagon!.wagonNumber);
        const springs = this.auditDb.queryInspections({ wagonNumber: wagon!.wagonNumber }).records;
        ChecklistEngine.syncPhase1SpringsIntoChecklist(items, springs);
        const categories = ChecklistEngine.groupChecklistByCategory(items);

        return json(200, {
          wagonNumber: wagon!.wagonNumber,
          items,
          categories
        });
      }

      // POST /api/wagons/:wagonNumber/checklist/items
      if (subPath === '/checklist/items' && req.method === 'POST') {
        const body = (req.body || {}) as {
          category: CASNUBCategory;
          partName: string;
          status: PartInspectionStatus;
          criticality?: PartCriticality;
          conditionNotes?: string;
          photoId?: string;
        };

        if (!body.category || !body.partName || !body.status) {
          return json(400, { error: 'Category, partName, and status are required' });
        }

        const existingItems = this.auditDb.getChecklistItems(wagon!.wagonNumber);
        const existing = existingItems.find(i => i.category === body.category && i.partName === body.partName);

        if (existing) {
          const updated = this.auditDb.updateChecklistItem(existing.id, {
            status: body.status,
            criticality: body.criticality || existing.criticality,
            conditionNotes: body.conditionNotes,
            photoId: body.photoId,
            inspectedBy: currentUser.id,
            inspectedByName: currentUser.name
          });
          return json(200, updated);
        }

        const newItem: ChecklistItem = {
          id: (crypto as any).randomUUID(),
          wagonNumber: wagon!.wagonNumber,
          category: body.category,
          partName: body.partName,
          status: body.status,
          criticality: body.criticality || 'MANDATORY',
          conditionNotes: body.conditionNotes || null,
          photoId: body.photoId || null,
          inspectedBy: currentUser.id,
          inspectedByName: currentUser.name,
          inspectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        this.auditDb.saveChecklistItems([newItem]);
        return json(201, newItem);
      }

      // PUT /api/wagons/:wagonNumber/checklist/items/:itemId
      const itemPutMatch = subPath.match(/^\/checklist\/items\/([^/]+)$/);
      if (itemPutMatch && req.method === 'PUT') {
        const itemId = itemPutMatch[1];
        const body = (req.body || {}) as {
          status: PartInspectionStatus;
          repairAction?: any;
          repairNotes?: string;
          photoId?: string;
        };

        const updated = this.auditDb.updateChecklistItem(itemId, {
          status: body.status,
          repairAction: body.repairAction,
          repairNotes: body.repairNotes,
          photoId: body.photoId,
          inspectedBy: currentUser.id,
          inspectedByName: currentUser.name
        });

        if (!updated) {
          return json(404, { error: `Checklist item ${itemId} not found` });
        }

        return json(200, updated);
      }

      // GET /api/wagons/:wagonNumber/gate/status
      if (subPath === '/gate/status' && req.method === 'GET') {
        const items = this.auditDb.getChecklistItems(wagon!.wagonNumber);
        const springs = this.auditDb.queryInspections({ wagonNumber: wagon!.wagonNumber }).records;
        ChecklistEngine.syncPhase1SpringsIntoChecklist(items, springs);
        const signoff = this.auditDb.getGateSignoff(wagon!.wagonNumber);
        const gateStatus = ExitGateEngine.evaluateGateStatus(wagon!, items, springs, Boolean(signoff));

        return json(200, gateStatus);
      }

      // POST /api/wagons/:wagonNumber/gate/signoff
      if (subPath === '/gate/signoff' && req.method === 'POST') {
        if (!this.authService.checkPermission(currentUser, 'OVERRIDE')) {
          return json(403, { error: 'Forbidden: Only Supervisors or Admins can perform digital sign-off at Exit Gate' });
        }

        const body = (req.body || {}) as GateSignoffRequest;
        if (!body.digitalSignature || typeof body.digitalSignature !== 'string' || body.digitalSignature.trim().length === 0) {
          return json(400, { error: 'Digital signature is required for supervisor sign-off' });
        }

        if (body.otpToken) {
          if (!this.authService.validateOtpToken(body.otpToken, 'OVERRIDE')) {
            return json(403, { error: 'Invalid or expired OTP token for supervisor digital sign-off' });
          }
          this.authService.consumeOtpToken(body.otpToken);
        }

        const items = this.auditDb.getChecklistItems(wagon!.wagonNumber);
        const springs = this.auditDb.queryInspections({ wagonNumber: wagon!.wagonNumber }).records;
        ChecklistEngine.syncPhase1SpringsIntoChecklist(items, springs);
        const gateCheck = ExitGateEngine.evaluateGateStatus(wagon!, items, springs, true);

        if (!gateCheck.canRelease) {
          return json(422, {
            error: 'Cannot sign off: Zero-Defect Exit Gate checks failed',
            blockers: gateCheck.blockers,
            summary: gateCheck.summary
          });
        }

        // Save signoff
        this.auditDb.saveGateSignoff({
          wagonNumber: wagon!.wagonNumber,
          supervisorId: currentUser.id,
          supervisorName: currentUser.name || currentUser.id,
          digitalSignature: body.digitalSignature,
          notes: body.notes
        });

        // Generate Release Certificate
        const cert = ExitGateEngine.generateReleaseCertificate(wagon!, items, springs, {
          supervisorId: currentUser.id,
          supervisorName: currentUser.name || currentUser.id,
          digitalSignature: body.digitalSignature
        });
        this.auditDb.saveReleaseCertificate(cert);

        // Transition wagon to Stage 7 (RELEASE)
        const updatedWagon = this.auditDb.updateWagonStage(wagon!.wagonNumber, 'RELEASE', cert.releaseDate);
        this.auditDb.logTransition({
          wagonNumber: wagon!.wagonNumber,
          fromStage: wagon!.currentStage,
          toStage: 'RELEASE',
          userId: currentUser.id,
          userName: currentUser.name,
          userRole: currentUser.role,
          notes: body.notes || `Digital sign-off completed by ${currentUser.name}. Official release certificate generated.`
        });

        return json(200, {
          success: true,
          certificate: cert,
          wagon: updatedWagon,
          message: `Wagon ${wagon!.wagonNumber} successfully signed off and released`
        });
      }

      // GET /api/wagons/:wagonNumber/certificate
      if (subPath === '/certificate' && req.method === 'GET') {
        const cert = this.auditDb.getReleaseCertificate(wagon!.wagonNumber);
        if (!cert) {
          return json(404, { error: `Release certificate for wagon ${wagon!.wagonNumber} not found or wagon not yet released` });
        }

        const format = queryParams.format || 'json';
        if (format === 'html') {
          return {
            status: 200,
            headers: { 'content-type': 'text/html' },
            body: cert.html || ''
          };
        }

        return json(200, cert);
      }

      // GET /api/wagons/:wagonNumber/photos
      if (subPath === '/photos' && req.method === 'GET') {
        const photos = this.photoEngine.getPhotosByWagon(wagon!.wagonNumber);
        return json(200, {
          wagonNumber: wagon!.wagonNumber,
          photos,
          total: photos.length
        });
      }
    }

    // -----------------------------------------------------------------------
    // 8. Phase 2: Checklist Configuration APIs (`/api/checklist/config`)
    // -----------------------------------------------------------------------
    if (pathname === '/api/checklist/config' && req.method === 'GET') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      const configs = this.auditDb.getChecklistConfigs(queryParams.wagonType);
      return json(200, { configs });
    }

    if (pathname === '/api/checklist/config' && req.method === 'POST') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      if (!this.authService.checkPermission(currentUser, 'OVERRIDE')) {
        return json(403, { error: 'Forbidden: Only Supervisors and Admins can configure checklist rules' });
      }

      const body = req.body as ChecklistConfigEntry[] | { configs: ChecklistConfigEntry[] };
      const configs = Array.isArray(body) ? body : (body?.configs || []);

      this.auditDb.saveChecklistConfig(configs);
      return json(200, {
        success: true,
        message: 'Checklist configuration updated successfully'
      });
    }

    // -----------------------------------------------------------------------
    // 9. Phase 2: Photo Attachment APIs (`/api/photos`)
    // -----------------------------------------------------------------------
    if (pathname === '/api/photos/upload' && req.method === 'POST') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }

      const body = (req.body || {}) as PhotoUploadRequest;
      const res = this.photoEngine.uploadPhoto(body, { id: currentUser.id, name: currentUser.name });

      if ('error' in res) {
        return json(400, { error: res.error });
      }

      return json(201, res.photo);
    }

    const photoDetailMatch = pathname.match(/^\/api\/photos\/([^/]+)$/);
    if (photoDetailMatch && req.method === 'GET') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      const photoId = photoDetailMatch[1];
      const photo = this.photoEngine.getPhotoById(photoId);
      if (!photo) {
        return json(404, { error: `Photo ${photoId} not found` });
      }
      return json(200, photo);
    }

    // -----------------------------------------------------------------------
    // 10. Phase 2: DRM Analytics APIs (`/api/analytics`)
    // -----------------------------------------------------------------------
    if (pathname === '/api/analytics/pipeline' && req.method === 'GET') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      const wagons = this.auditDb.getAllWagons();
      const pipeline = AnalyticsEngine.getPipeline(wagons);
      return json(200, pipeline);
    }

    if (pathname === '/api/analytics/tat' && req.method === 'GET') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      const wagons = this.auditDb.getAllWagons();
      const tat = AnalyticsEngine.getTAT(wagons);
      return json(200, tat);
    }

    if (pathname === '/api/analytics/throughput' && req.method === 'GET') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      const wagons = this.auditDb.getAllWagons();
      const throughput = AnalyticsEngine.getThroughput(wagons);
      return json(200, throughput);
    }

    if (pathname === '/api/analytics/parts' && req.method === 'GET') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      const wagons = this.auditDb.getAllWagons();
      const allItems: ChecklistItem[] = [];
      for (const w of wagons) {
        allItems.push(...this.auditDb.getChecklistItems(w.wagonNumber));
      }
      const partsStats = AnalyticsEngine.getPartsStats(allItems);
      return json(200, partsStats);
    }

    if (pathname === '/api/analytics/inspectors' && req.method === 'GET') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      const wagons = this.auditDb.getAllWagons();
      const allItems: ChecklistItem[] = [];
      for (const w of wagons) {
        allItems.push(...this.auditDb.getChecklistItems(w.wagonNumber));
      }
      const inspectorStats = AnalyticsEngine.getInspectorMetrics(allItems);
      return json(200, inspectorStats);
    }

    if (pathname === '/api/analytics/blockers' && req.method === 'GET') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      const wagons = this.auditDb.getAllWagons();
      const allItems: ChecklistItem[] = [];
      const allSprings = this.auditDb.queryInspections({ limit: 10000 }).records;
      for (const w of wagons) {
        allItems.push(...this.auditDb.getChecklistItems(w.wagonNumber));
      }
      const blockers = AnalyticsEngine.getBlockers(wagons, allItems, allSprings);
      return json(200, blockers);
    }

    if (pathname === '/api/analytics/export' && req.method === 'GET') {
      if (!currentUser) {
        return json(401, { error: 'Authentication required' });
      }
      if (!this.authService.checkPermission(currentUser, 'VIEW_REPORTS')) {
        return json(403, { error: 'Forbidden: Only Supervisors and Admins can export compliance reports' });
      }

      const wagons = this.auditDb.getAllWagons();
      const allItems: ChecklistItem[] = [];
      for (const w of wagons) {
        allItems.push(...this.auditDb.getChecklistItems(w.wagonNumber));
      }

      const format = queryParams.format || 'json';
      if (format === 'csv') {
        const csvData = AnalyticsEngine.exportComplianceCSV(wagons, allItems);
        return {
          status: 200,
          headers: { 'content-type': 'text/csv' },
          body: csvData
        };
      }

      return json(200, {
        exportTimestamp: new Date().toISOString(),
        totalWagons: wagons.length,
        pipeline: AnalyticsEngine.getPipeline(wagons),
        tat: AnalyticsEngine.getTAT(wagons),
        partsSummary: AnalyticsEngine.getPartsStats(allItems)
      });
    }

    // -----------------------------------------------------------------------
    // Phase 3: Stores Depot Inventory API (M1 / R5)
    // -----------------------------------------------------------------------
    if ((pathname === '/api/inventory/parts' || pathname === '/api/inventory') && req.method === 'GET') {
      const category = queryParams.category;
      const parts = this.auditDb.getInventory(category);
      return json(200, {
        success: true,
        data: parts,
        parts,
        meta: { total: parts.length, category: category || 'ALL', timestamp: new Date().toISOString() }
      });
    }

    if (pathname === '/api/inventory/stats' && req.method === 'GET') {
      const stats = this.auditDb.getInventoryStats();
      return json(200, { success: true, data: stats, stats });
    }

    if (pathname === '/api/inventory/reserve' && req.method === 'POST') {
      const body = req.body as ReservePartRequest;
      if (!body || !body.wagonNumber || !body.partCode || !body.quantity) {
        return json(400, { success: false, error: 'Missing required reservation fields (wagonNumber, partCode, quantity)' });
      }
      try {
        const reservation = this.auditDb.reservePart({
          wagonNumber: body.wagonNumber,
          partCode: body.partCode,
          quantity: body.quantity,
          source: body.source,
          predictedDefect: body.predictedDefect,
          confidenceScore: body.confidenceScore
        });
        return json(201, { success: true, reservation, data: reservation });
      } catch (err: any) {
        const isConflict = err.message?.startsWith('INSUFFICIENT_STOCK');
        return json(isConflict ? 409 : 400, { success: false, error: err.message, message: err.message });
      }
    }

    if (pathname === '/api/inventory/issue' && req.method === 'POST') {
      const body = req.body as IssuePartRequest;
      if (!body || (!body.reservationId && (!body.partCode || !body.quantity))) {
        return json(400, { success: false, error: 'Missing issue fields (reservationId or partCode+quantity)' });
      }
      try {
        const result = this.auditDb.issuePart(body);
        return json(200, { success: true, ...result });
      } catch (err: any) {
        return json(400, { success: false, error: err.message });
      }
    }

    if (pathname === '/api/inventory/restock' && req.method === 'POST') {
      const body = req.body as RestockPartRequest;
      if (!body || !body.partCode || !body.quantity) {
        return json(400, { success: false, error: 'Missing restock fields (partCode, quantity)' });
      }
      try {
        const part = this.auditDb.restockPart(body.partCode, body.quantity);
        return json(200, { success: true, part, data: part });
      } catch (err: any) {
        return json(400, { success: false, error: err.message });
      }
    }

    // -----------------------------------------------------------------------
    // Phase 3: Trackside OMRS Scans & AI Triage API (M1 / R5)
    // -----------------------------------------------------------------------
    if (pathname === '/api/omrs/scans' && req.method === 'GET') {
      const scans = this.auditDb.getOMRSScans();
      return json(200, { success: true, scans, data: scans });
    }

    if (pathname.startsWith('/api/omrs/triage/') && req.method === 'GET') {
      const wagonNumber = decodeURIComponent(pathname.substring('/api/omrs/triage/'.length));
      try {
        const triage = this.auditDb.triageWagonOMRS(wagonNumber);
        return json(200, { success: true, ...triage, data: triage });
      } catch (err: any) {
        return json(404, { success: false, error: err.message });
      }
    }

    if (pathname === '/api/omrs/simulate-scan' && req.method === 'POST') {
      const body = req.body as SimulateOMRSScanRequest;
      if (!body || !body.wagonNumber) {
        return json(400, { success: false, error: 'Missing wagonNumber in OMRS scan payload' });
      }
      try {
        const scan = this.auditDb.recordOMRSScan(body);
        return json(201, { success: true, scan, data: scan });
      } catch (err: any) {
        return json(400, { success: false, error: err.message });
      }
    }

    // -----------------------------------------------------------------------
    // Phase 3: Component Health Passports & QR Scanner API (M2 / R4)
    // -----------------------------------------------------------------------
    if (pathname === '/api/components' && req.method === 'GET') {
      const comps = this.auditDb.getAllComponents({
        type: queryParams.type,
        status: queryParams.status,
        wagonNumber: queryParams.wagonNumber
      });
      return json(200, { success: true, components: comps, data: comps, total: comps.length });
    }

    if (pathname === '/api/components/register' && req.method === 'POST') {
      const body = req.body as RegisterComponentRequest;
      if (!body || !body.serialNumber || !body.componentType || !body.partName) {
        return json(400, { success: false, error: 'Missing required component fields (serialNumber, componentType, partName)' });
      }
      try {
        const comp = this.auditDb.registerComponent(body);
        return json(201, { success: true, component: comp, data: comp });
      } catch (err: any) {
        return json(400, { success: false, error: err.message });
      }
    }

    if (pathname === '/api/components/scan-qr' && req.method === 'POST') {
      const body = req.body as { qrPayload: string };
      if (!body || !body.qrPayload) {
        return json(400, { success: false, error: 'Missing qrPayload in scan request' });
      }
      try {
        const decoded = decodeComponentQR(body.qrPayload);
        const comp = this.auditDb.getComponentBySerial(decoded.serialNumber);
        if (!comp) {
          return json(404, { success: false, decoded, error: `COMPONENT_NOT_FOUND: Serial "${decoded.serialNumber}" not registered in passport registry` });
        }
        return json(200, { success: true, decoded, component: comp, data: comp });
      } catch (err: any) {
        return json(400, { success: false, error: err.message });
      }
    }

    if (pathname.startsWith('/api/components/') && pathname.endsWith('/assign') && req.method === 'POST') {
      const idOrSerial = decodeURIComponent(pathname.substring('/api/components/'.length, pathname.length - '/assign'.length));
      const body = req.body as AssignComponentRequest;
      if (!body || !body.wagonNumber) {
        return json(400, { success: false, error: 'Missing wagonNumber in component assignment request' });
      }
      try {
        const comp = this.auditDb.assignComponentToWagon(
          idOrSerial,
          body.wagonNumber,
          body.bogiePosition,
          currentUser?.username || 'inspector1',
          currentUser?.fullName || 'Inspector',
          body.stage,
          body.notes
        );
        return json(200, { success: true, component: comp, data: comp });
      } catch (err: any) {
        return json(400, { success: false, error: err.message });
      }
    }

    if (pathname.startsWith('/api/components/') && pathname.endsWith('/unassign') && req.method === 'POST') {
      const idOrSerial = decodeURIComponent(pathname.substring('/api/components/'.length, pathname.length - '/unassign'.length));
      const body = req.body as { notes?: string };
      try {
        const comp = this.auditDb.unassignComponent(
          idOrSerial,
          currentUser?.username || 'inspector1',
          currentUser?.fullName || 'Inspector',
          body?.notes
        );
        return json(200, { success: true, component: comp, data: comp });
      } catch (err: any) {
        return json(400, { success: false, error: err.message });
      }
    }

    if (pathname.startsWith('/api/components/') && pathname.endsWith('/history') && req.method === 'GET') {
      const idOrSerial = decodeURIComponent(pathname.substring('/api/components/'.length, pathname.length - '/history'.length));
      const history = this.auditDb.getComponentHistory(idOrSerial);
      return json(200, { success: true, history, data: history });
    }

    if (pathname.startsWith('/api/components/') && req.method === 'GET') {
      const idOrSerial = decodeURIComponent(pathname.substring('/api/components/'.length));
      const comp = this.auditDb.getComponentById(idOrSerial) || this.auditDb.getComponentBySerial(idOrSerial);
      if (!comp) {
        return json(404, { success: false, error: `Component "${idOrSerial}" not found` });
      }
      return json(200, { success: true, component: comp, data: comp });
    }

    // -----------------------------------------------------------------------
    // Phase 3: Hands-Free Voice UI API (M3 / R1)
    // -----------------------------------------------------------------------
    if (pathname === '/api/checklist/voice-action' && req.method === 'POST') {
      const body = req.body as {
        wagonNumber: string;
        transcript?: string;
        locale?: 'en' | 'hi';
        targetCategory?: CASNUBCategory;
        targetPartName?: string;
        status?: PartInspectionStatus;
        measuredHeight?: number;
        bandColor?: BandColor;
        notes?: string;
      };

      if (!body || !body.wagonNumber) {
        return json(400, { success: false, error: 'Missing wagonNumber for voice action' });
      }

      const parsed = body.transcript ? parseVoiceCommand(body.transcript, body.locale || 'en') : null;
      const targetCategory = body.targetCategory || parsed?.targetCategory;
      const targetPartName = body.targetPartName || parsed?.targetPartName;
      const status = body.status || parsed?.status;
      const notes = body.notes || parsed?.notes;

      if (parsed && !parsed.matched) {
        return json(422, {
          success: false,
          error: 'VOICE_COMMAND_NOT_RECOGNIZED',
          parsed,
          feedbackMessage: parsed.feedbackMessage
        });
      }

      let updatedItem: ChecklistItem | null = null;
      if (targetPartName && status) {
        const items = this.auditDb.getChecklistItems(body.wagonNumber);
        const item = items.find(i => i.partName.toLowerCase().includes(targetPartName.toLowerCase()) || targetPartName.toLowerCase().includes(i.partName.toLowerCase()));
        if (item) {
          this.auditDb.updateChecklistItem(item.id, {
            status,
            repairNotes: notes
          });
          updatedItem = this.auditDb.getChecklistItemById(item.id) || null;
        }
      }

      // If spring classification parsed
      if (parsed?.intent === 'CLASSIFY_SPRING' && parsed.measuredHeight) {
        this.auditDb.logInspection({
          wagonNumber: body.wagonNumber,
          bogieType: 'CASNUB_22_NLB',
          springPosition: parsed.targetPartName?.includes('Inner') ? 'INNER' : parsed.targetPartName?.includes('Snubber') ? 'SNUBBER' : 'OUTER',
          condition: 'USED',
          measuredFreeHeight: parsed.measuredHeight,
          classifiedBand: parsed.bandColor || (parsed.measuredHeight >= 257 ? 'BLUE' : 'GREEN'),
          bandRoman: 'Band I',
          status: parsed.status || 'PASS',
          damageType: 'NONE',
          inspectorId: currentUser?.id || 'inspector1',
          inspectorName: currentUser?.fullName || 'Railway Inspector',
          tableReference: 'Table 28'
        });
      }

      // Log voice command
      this.auditDb.saveVoiceLog({
        wagonNumber: body.wagonNumber,
        transcript: body.transcript || 'Manual API Trigger',
        locale: body.locale || 'en',
        intent: parsed?.intent || 'UPDATE_STATUS',
        targetCategory,
        targetPartName,
        statusApplied: status,
        confidence: parsed?.confidence ?? 0.95,
        inspectorId: currentUser?.id || 'inspector1'
      });

      return json(200, {
        success: true,
        parsed,
        item: updatedItem,
        feedbackMessage: parsed?.feedbackMessage || `Action processed for ${targetPartName || 'checklist'}`
      });
    }

    if (pathname === '/api/checklist/voice-log' && req.method === 'GET') {
      const wagon = queryParams.wagonNumber || '';
      const logs = this.auditDb.getVoiceLogs(wagon);
      return json(200, { success: true, logs, data: logs });
    }

    // -----------------------------------------------------------------------
    // Phase 3: Direct Computer Vision & AR API (M4 / R2)
    // -----------------------------------------------------------------------
    if (pathname === '/api/cv/measure' && req.method === 'POST') {
      const body = req.body as {
        wagonNumber: string;
        componentType?: string;
        position?: SpringPosition;
        measuredHeight?: number;
        measuredValue?: number;
        bogieType?: BogieType;
        metadata?: any;
      };

      const rawHeight = body?.measuredValue !== undefined ? body.measuredValue : body?.measuredHeight;

      if (!body || !body.wagonNumber || rawHeight === undefined) {
        return json(400, { success: false, error: 'Missing required CV measurement fields (wagonNumber, measuredHeight / measuredValue)' });
      }

      const componentType = body.componentType || 'Outer Spring';
      const posUpper = componentType.toUpperCase();
      const position: SpringPosition = body.position || (posUpper.includes('INNER') ? 'INNER' : posUpper.includes('SNUBBER') ? 'SNUBBER' : 'OUTER');
      const metadata = body.metadata || {};

      const noiseCandidates = metadata.noiseCategoriesFiltered
        ? metadata.noiseCategoriesFiltered.map((cls: string) => ({ class: cls, score: 0.95 }))
        : undefined;

      const cvResult = simulateCVDetection(
        componentType,
        position,
        rawHeight,
        body.bogieType || 'CASNUB_22_NLB',
        noiseCandidates
      );

      this.auditDb.saveCVMeasurement({
        wagonNumber: body.wagonNumber,
        componentType,
        position,
        measuredHeight: rawHeight,
        status: cvResult.arCaliper.status,
        bandColor: cvResult.arCaliper.bandColor || undefined,
        photoId: 'cv_snap_' + crypto.randomUUID().substring(0, 8),
        confidence: cvResult.confidence
      });

      // Also update matching checklist item if found
      const items = this.auditDb.getChecklistItems(body.wagonNumber);
      const springItem = items.find(i => i.category === 'SPRINGS' && i.partName.toLowerCase().includes((position || 'outer').toLowerCase()));
      if (springItem) {
        this.auditDb.updateChecklistItem(springItem.id, {
          status: cvResult.arCaliper.status === 'PASS' ? 'PASS' : 'CONDEMNED',
          repairNotes: `CV AR Measurement: ${rawHeight}mm (${cvResult.arCaliper.status})`
        });
      }

      return json(200, {
        success: true,
        verdict: cvResult.arCaliper.status,
        componentType,
        measuredValue: rawHeight,
        measurement: cvResult,
        data: cvResult,
        metadata: {
          contextFilterActive: metadata.contextFilterActive ?? true,
          noiseObjectsFilteredCount: metadata.noiseObjectsFilteredCount ?? (noiseCandidates ? noiseCandidates.length : 0),
          noiseCategoriesFiltered: metadata.noiseCategoriesFiltered ?? (noiseCandidates ? noiseCandidates.map((n: any) => n.class) : []),
          targetComponentIsolated: metadata.targetComponentIsolated ?? componentType,
          ...metadata
        }
      });
    }

    // -----------------------------------------------------------------------
    // Phase 3: Smart Acoustic Diagnostics API (M5 / R3)
    // -----------------------------------------------------------------------
    if (pathname === '/api/acoustic/diagnose' && req.method === 'POST') {
      const body = req.body as {
        wagonNumber: string;
        dominantFrequencyHz: number;
        peakDb: number;
        isAnomalyDetected: boolean;
        anomalyType: string;
        confidence: number;
        recommendedAction: string;
      };

      if (!body || !body.wagonNumber || body.dominantFrequencyHz === undefined) {
        return json(400, { success: false, error: 'Missing required acoustic diagnostic fields' });
      }

      const result = this.auditDb.saveAcousticDiagnostic({
        wagonNumber: body.wagonNumber,
        dominantFrequencyHz: body.dominantFrequencyHz,
        peakDb: body.peakDb ?? -35,
        isAnomalyDetected: Boolean(body.isAnomalyDetected),
        anomalyType: body.anomalyType || (body.isAnomalyDetected ? 'AIR_LEAK' : 'NONE'),
        confidence: body.confidence ?? 0.92,
        recommendedAction: body.recommendedAction || 'Inspect pneumatic joints',
        inspectorId: currentUser?.id || 'inspector1'
      });

      return json(200, { success: true, diagnostic: result, data: result });
    }

    if (pathname === '/api/acoustic/blocker' && req.method === 'POST') {
      const body = req.body as { wagonNumber: string; blockerReason?: string };
      if (!body || !body.wagonNumber) {
        return json(400, { success: false, error: 'Missing wagonNumber for acoustic blocker' });
      }
      this.auditDb.updateWagon(body.wagonNumber, {
        notes: `Acoustic Blocker: ${body.blockerReason || 'High frequency leak detected'}`
      });
      return json(200, { success: true, message: 'Acoustic blocker registered' });
    }

    return json(404, { error: `Route ${req.method} ${pathname} not found` });

  }

  // Convenient HTTP client wrappers for opaque-box testing
  public async get(url: string, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.handleRequest({ method: 'GET', url, headers });
  }

  public async post(url: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.handleRequest({ method: 'POST', url, headers, body });
  }

  public async put(url: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.handleRequest({ method: 'PUT', url, headers, body });
  }

  public async delete(url: string, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.handleRequest({ method: 'DELETE', url, headers });
  }

  public async patch(url: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.handleRequest({ method: 'PATCH', url, headers, body });
  }
}
