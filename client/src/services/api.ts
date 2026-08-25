/**
 * REST API Client for WRS Raipur Backend (Phase 1 & Phase 2)
 * Indian Railways Wagon Repair Shop Raipur
 */

import type {
  User,
  AuthLoginRequest,
  AuthLoginResponse,
  InspectionRecord,
  InspectionCreateRequest,
  InspectionFilter,
  InspectionStats,
  OTPRequestResponse,
  OTPVerifyResponse,
  ClassificationRequest,
  ClassificationResult,
  WagonRecord,
  WagonTransition,
  ChecklistItem,
  WagonPhotoRecord,
  GateSignoffRecord,
  LifecycleStage,
  StoresPart,
  InventoryReservation,
  InventoryStats,
  AcousticAnomalyType,
  AcousticDiagnosticResult,
  AcousticDiagnosticRecord,
  AcousticDiagnoseRequest,
  AcousticDiagnoseResponse,
  VoiceActionRequest,
  VoiceActionResponse,
  SerializedComponent,
  ComponentHistoryEvent,
  RegisterComponentRequest,
  AssignComponentRequest,
  UnassignComponentRequest,
  ComponentFilter,
  ComponentStats,
  CVMeasureRequest,
  CVMeasureResponse,
  AdminUserRecord
} from '../../../shared/types.ts';

const BASE_URL = '/api';

export class ApiClient {
  private token: string | null = null;
  private user: User | null = null;

  constructor() {
    if (typeof localStorage !== 'undefined') {
      this.token = localStorage.getItem('wrs_token');
      const savedUser = localStorage.getItem('wrs_user');
      if (savedUser) {
        try {
          this.user = JSON.parse(savedUser);
        } catch {
          this.user = null;
        }
      }
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  public getUser(): User | null {
    return this.user;
  }

  public setSession(token: string, user: User) {
    this.token = token;
    this.user = user;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('wrs_token', token);
      localStorage.setItem('wrs_user', JSON.stringify(user));
    }
  }

  public clearSession() {
    this.token = null;
    this.user = null;
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('wrs_token');
      localStorage.removeItem('wrs_user');
    }
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    if (this.token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/csv') || contentType.includes('text/html')) {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed with status ${res.status}`);
      }
      return (await res.text()) as unknown as T;
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.message || json.error || `HTTP error ${res.status}`);
    }

    return json as T;
  }

  // =========================================================================
  // Authentication APIs
  // =========================================================================

  public async login(req: AuthLoginRequest): Promise<AuthLoginResponse> {
    const data = await this.request<AuthLoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(req)
    });
    if (data.token && data.user) {
      this.setSession(data.token, data.user);
    }
    return data;
  }

  public async requestOtp(action: 'OVERRIDE' | 'EXPORT' | 'USER_MGMT'): Promise<OTPRequestResponse> {
    return this.request<OTPRequestResponse>('/auth/request-otp', {
      method: 'POST',
      body: JSON.stringify({ action })
    });
  }

  public async verifyOtp(otpId: string, otpCode: string): Promise<OTPVerifyResponse> {
    return this.request<OTPVerifyResponse>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ otpId, otpCode })
    });
  }

  public async getMe(): Promise<{ user: User }> {
    return this.request<{ user: User }>('/auth/me');
  }

  // =========================================================================
  // Admin: Real Account Management (create/list/deactivate/reactivate)
  // =========================================================================

  public async listUsers(): Promise<{ success: boolean; data: AdminUserRecord[] }> {
    return this.request('/auth/users');
  }

  public async createUser(payload: {
    username: string;
    password: string;
    role: 'INSPECTOR' | 'SUPERVISOR' | 'ADMIN';
    fullName: string;
    employeeId: string;
  }): Promise<{ success: boolean; data: AdminUserRecord }> {
    return this.request('/auth/users', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // =========================================================================
  // Inspect-by-exception & history-based suggestions
  // =========================================================================

  /** Clears every remaining PENDING item on a wagon in one attested action. */
  public async bulkClearChecklist(payload: {
    wagonNumber: string;
    attestation: string;
    excludeCategories?: string[];
  }): Promise<{ success: boolean; data: { clearedCount: number; skippedCategories: string[] }; message: string }> {
    return this.request('/checklist/bulk-clear', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  /** Likely statuses for pending items, derived from this part's own history. */
  public async getChecklistSuggestions(wagonNumber: string): Promise<{
    success: boolean;
    data: {
      wagonNumber: string;
      suggestions: {
        itemId: string;
        category: string;
        partName: string;
        suggestedStatus: string;
        confidence: number;
        basis: string;
      }[];
    };
  }> {
    return this.request(`/checklist/suggestions/${encodeURIComponent(wagonNumber)}`);
  }

  // =========================================================================
  // Maintenance Manual Search
  // =========================================================================

  public async getManualStatus(): Promise<{ success: boolean; data: any }> {
    return this.request('/manual/status');
  }

  public async searchManual(q: string, limit = 5): Promise<{ success: boolean; data: any }> {
    return this.request(`/manual/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  }

  // =========================================================================
  // Machine Learning Feedback Loop
  // =========================================================================

  /**
   * Records what the machine proposed against what the human committed.
   * This is the signal the system learns from — see
   * server/src/learning/learningService.ts.
   */
  public async recordLearningOutcome(payload: {
    subsystem: 'OCR_CALIPER' | 'SPRING_CLASSIFICATION' | 'VOICE_COMMAND' | 'ACOUSTIC_DIAGNOSTIC' | 'DEFECT_SUGGESTION';
    wagonNumber?: string;
    inspectionId?: string;
    machineOutput: unknown;
    machineConfidence?: number;
    humanOutput?: unknown;
    wasCorrected: boolean;
    correctionMagnitude?: number;
    context?: Record<string, unknown>;
  }): Promise<{ success: boolean; data: { id: string } }> {
    return this.request('/learning/outcome', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async getLearningDashboard(): Promise<{ success: boolean; data: any }> {
    return this.request('/learning/dashboard');
  }

  public async runLearningAnalysis(): Promise<{ success: boolean; data: any }> {
    return this.request('/learning/analyze', { method: 'POST' });
  }

  public async decideLearningProposal(
    paramKey: string,
    decision: 'APPROVE' | 'REJECT'
  ): Promise<{ success: boolean; data: any }> {
    return this.request(`/learning/parameters/${encodeURIComponent(paramKey)}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision })
    });
  }

  public async deactivateUser(id: string): Promise<{ success: boolean; data: AdminUserRecord }> {
    return this.request(`/auth/users/${id}/deactivate`, { method: 'PATCH' });
  }

  public async reactivateUser(id: string): Promise<{ success: boolean; data: AdminUserRecord }> {
    return this.request(`/auth/users/${id}/reactivate`, { method: 'PATCH' });
  }

  // =========================================================================
  // Phase 1 Spring Classification & Inspections APIs
  // =========================================================================

  public async classify(req: ClassificationRequest): Promise<ClassificationResult> {
    return this.request<ClassificationResult>('/classification/classify', {
      method: 'POST',
      body: JSON.stringify(req)
    });
  }

  public async createInspection(req: InspectionCreateRequest): Promise<InspectionRecord> {
    const res = await this.request<{ success: boolean; data: InspectionRecord } & InspectionRecord>('/inspections', {
      method: 'POST',
      body: JSON.stringify(req)
    });
    return res.data || res;
  }

  public async queryInspections(filter: InspectionFilter = {}): Promise<{ records: InspectionRecord[]; totalCount: number }> {
    const params = new URLSearchParams();
    if (filter.wagonNumber) params.set('wagonNumber', filter.wagonNumber);
    if (filter.startDate) params.set('startDate', filter.startDate);
    if (filter.endDate) params.set('endDate', filter.endDate);
    if (filter.inspectorId) params.set('inspectorId', filter.inspectorId);
    if (filter.band) params.set('band', filter.band);
    if (filter.status) params.set('status', filter.status);
    if (filter.bogieType) params.set('bogieType', filter.bogieType);
    if (filter.page) params.set('page', String(filter.page));
    if (filter.limit) params.set('limit', String(filter.limit));

    const qs = params.toString();
    const res = await this.request<{ success: boolean; records: InspectionRecord[]; data?: InspectionRecord[]; pagination?: { totalCount: number } }>(
      `/inspections${qs ? `?${qs}` : ''}`
    );
    const records = res.records || res.data || [];
    const totalCount = res.pagination?.totalCount || records.length;
    return { records, totalCount };
  }

  public async getInspectionStats(startDate?: string, endDate?: string): Promise<InspectionStats> {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    const qs = params.toString();
    return this.request<InspectionStats>(`/inspections/stats${qs ? `?${qs}` : ''}`);
  }

  // =========================================================================
  // Phase 2 Wagons & Lifecycle APIs
  // =========================================================================

  public async registerWagon(payload: {
    wagonNumber: string;
    wagonType: string;
    owningRailway: string;
    entryNotes?: string;
    conditionNotes?: string;
  }): Promise<{ success: boolean; data: WagonRecord }> {
    return this.request<{ success: boolean; data: WagonRecord }>('/wagons/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async queryWagons(filter: {
    stage?: string;
    wagonType?: string;
    owningRailway?: string;
    search?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ success: boolean; data: WagonRecord[]; pagination: any }> {
    const params = new URLSearchParams();
    if (filter.stage) params.set('stage', filter.stage);
    if (filter.wagonType) params.set('wagonType', filter.wagonType);
    if (filter.owningRailway) params.set('owningRailway', filter.owningRailway);
    if (filter.search) params.set('search', filter.search);
    if (filter.page) params.set('page', String(filter.page));
    if (filter.limit) params.set('limit', String(filter.limit));
    const qs = params.toString();
    return this.request<{ success: boolean; data: WagonRecord[]; pagination: any }>(`/wagons${qs ? `?${qs}` : ''}`);
  }

  public async getWagonDetail(wagonNumber: string): Promise<{ success: boolean; data: any }> {
    return this.request<{ success: boolean; data: any }>(`/wagons/${wagonNumber}`);
  }

  public async transitionWagonStage(wagonNumber: string, payload: {
    targetStage: LifecycleStage;
    notes?: string;
    supervisorOverride?: boolean;
    overrideJustification?: string;
    otpToken?: string;
  }): Promise<{ success: boolean; data: { wagon: WagonRecord; transition: WagonTransition } }> {
    return this.request<{ success: boolean; data: { wagon: WagonRecord; transition: WagonTransition } }>(
      `/wagons/${wagonNumber}/transition`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
  }

  public async getWagonTimeline(wagonNumber: string): Promise<{ success: boolean; data: WagonTransition[] }> {
    return this.request<{ success: boolean; data: WagonTransition[] }>(`/wagons/${wagonNumber}/timeline`);
  }

  // =========================================================================
  // Phase 2 CASNUB Bogie Parts Checklist APIs
  // =========================================================================

  public async getWagonChecklist(wagonNumber: string): Promise<{ success: boolean; data: { allItems: ChecklistItem[]; categories: Record<string, ChecklistItem[]> } }> {
    return this.request<{ success: boolean; data: { allItems: ChecklistItem[]; categories: Record<string, ChecklistItem[]> } }>(
      `/wagons/${wagonNumber}/checklist`
    );
  }

  public async upsertChecklistItem(wagonNumber: string, payload: {
    category: string;
    partName: string;
    bogiePosition?: string;
    status: string;
    isMandatory?: boolean;
    conditionNotes?: string;
    photoId?: string;
  }): Promise<{ success: boolean; data: ChecklistItem }> {
    return this.request<{ success: boolean; data: ChecklistItem }>(`/wagons/${wagonNumber}/checklist/items`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async updateChecklistItem(wagonNumber: string, itemId: string, payload: {
    status?: string;
    repairAction?: string;
    repairNotes?: string;
    reinspectedStatus?: string;
    conditionNotes?: string;
    photoId?: string;
  }): Promise<{ success: boolean; data: ChecklistItem }> {
    return this.request<{ success: boolean; data: ChecklistItem }>(`/wagons/${wagonNumber}/checklist/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }

  public async recordVoiceAction(payload: VoiceActionRequest): Promise<VoiceActionResponse> {
    return this.request<VoiceActionResponse>('/checklist/voice-action', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // =========================================================================
  // Phase 2 Zero-Defect Exit Gate & Certification APIs
  // =========================================================================

  public async getExitGateStatus(wagonNumber: string): Promise<{ success: boolean; data: any }> {
    return this.request<{ success: boolean; data: any }>(`/wagons/${wagonNumber}/gate/status`);
  }

  public async signoffExitGate(wagonNumber: string, payload: {
    otpToken?: string;
    notes?: string;
    /** Advisory ids the supervisor accepted; the server refuses without them. */
    acknowledgedAdvisoryIds?: string[];
  }): Promise<{ success: boolean; data: GateSignoffRecord }> {
    return this.request<{ success: boolean; data: GateSignoffRecord }>(`/wagons/${wagonNumber}/gate/signoff`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async getReleaseCertificate(wagonNumber: string, format: 'html' | 'json' = 'html'): Promise<any> {
    if (format === 'html') {
      return this.request<string>(`/wagons/${wagonNumber}/certificate?format=html`);
    } else {
      return this.request<any>(`/wagons/${wagonNumber}/certificate?format=json`);
    }
  }

  // =========================================================================
  // Phase 2 Photo Evidence APIs
  // =========================================================================

  public async uploadPhoto(payload: {
    wagonNumber: string;
    checklistItemId?: string;
    partCategory?: string;
    partName?: string;
    stage?: string;
    imageBase64: string;
    tags?: string[];
  }): Promise<{ success: boolean; data: WagonPhotoRecord }> {
    return this.request<{ success: boolean; data: WagonPhotoRecord }>('/photos/upload', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async getWagonPhotos(wagonNumber: string, category?: string): Promise<{ success: boolean; data: WagonPhotoRecord[] }> {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    const qs = params.toString();
    return this.request<{ success: boolean; data: WagonPhotoRecord[] }>(`/photos/wagon/${wagonNumber}${qs ? `?${qs}` : ''}`);
  }

  // =========================================================================
  // Phase 2 DRM Officer Dashboards & Analytics APIs
  // =========================================================================

  public async getAnalyticsPipeline(): Promise<{ success: boolean; data: any }> {
    return this.request<{ success: boolean; data: any }>('/analytics/pipeline');
  }

  public async getAnalyticsTAT(): Promise<{ success: boolean; data: any }> {
    return this.request<{ success: boolean; data: any }>('/analytics/tat');
  }

  public async getAnalyticsThroughput(): Promise<{ success: boolean; data: any }> {
    return this.request<{ success: boolean; data: any }>('/analytics/throughput');
  }

  public async getAnalyticsParts(): Promise<{ success: boolean; data: any }> {
    return this.request<{ success: boolean; data: any }>('/analytics/parts');
  }

  public async getAnalyticsInspectors(): Promise<{ success: boolean; data: any }> {
    return this.request<{ success: boolean; data: any }>('/analytics/inspectors');
  }

  public async getAnalyticsBlockers(): Promise<{ success: boolean; data: any }> {
    return this.request<{ success: boolean; data: any }>('/analytics/blockers');
  }

  public async exportAnalytics(format: 'csv' | 'pdf'): Promise<string> {
    return this.request<string>(`/analytics/export?format=${format}`);
  }

  /**
   * OTP-gated audit export of inspection records (admin only).
   *
   * AdminExportModal has always called this method, but it was never defined
   * on the client — so the export button threw a TypeError at runtime and the
   * compliance export simply did not work. Returns a CSV string or a parsed
   * JSON payload depending on the requested format.
   */
  public async exportInspections(
    format: 'csv' | 'json',
    otpToken: string,
    filters: { startDate?: string; endDate?: string; wagonNumber?: string } = {}
  ): Promise<string | Record<string, unknown>> {
    const params = new URLSearchParams({ format, otpToken });
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
    if (filters.wagonNumber) params.set('wagonNumber', filters.wagonNumber);

    return this.request<string | Record<string, unknown>>(
      `/inspections/export?${params.toString()}`,
      { headers: { 'x-otp-token': otpToken } }
    );
  }

  // =========================================================================
  // Phase 3 (M1): Stores Depot Inventory & Pre-Arrival OMRS AI Triage APIs
  // =========================================================================

  public async getInventory(category?: string): Promise<{ success: boolean; data: StoresPart[]; meta?: any }> {
    const params = new URLSearchParams();
    if (category && category !== 'ALL') params.set('category', category);
    const qs = params.toString();
    return this.request<{ success: boolean; data: StoresPart[]; meta?: any }>(`/inventory${qs ? `?${qs}` : ''}`);
  }

  public async getInventoryStats(): Promise<{ success: boolean; data: InventoryStats }> {
    return this.request<{ success: boolean; data: InventoryStats }>('/inventory/stats');
  }

  public async getInventoryReservations(wagonNumber?: string, status?: string): Promise<{ success: boolean; data: InventoryReservation[]; meta?: any }> {
    const params = new URLSearchParams();
    if (wagonNumber && wagonNumber !== 'ALL') params.set('wagonNumber', wagonNumber);
    if (status && status !== 'ALL') params.set('status', status);
    const qs = params.toString();
    return this.request<{ success: boolean; data: InventoryReservation[]; meta?: any }>(`/inventory/reservations${qs ? `?${qs}` : ''}`);
  }

  public async getPartByCode(partCode: string): Promise<{ success: boolean; data: StoresPart }> {
    return this.request<{ success: boolean; data: StoresPart }>(`/inventory/part/${encodeURIComponent(partCode)}`);
  }

  public async reservePart(payload: {
    wagonNumber: string;
    partCode: string;
    quantity: number;
    source?: string;
    predictedDefect?: string;
    confidenceScore?: number;
  }): Promise<{ success: boolean; data: InventoryReservation; message?: string }> {
    return this.request<{ success: boolean; data: InventoryReservation; message?: string }>('/inventory/reserve', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async issuePart(reservationId: string): Promise<{ success: boolean; data: { reservation: InventoryReservation; part: StoresPart }; message?: string }> {
    return this.request<{ success: boolean; data: { reservation: InventoryReservation; part: StoresPart }; message?: string }>('/inventory/issue', {
      method: 'POST',
      body: JSON.stringify({ reservationId })
    });
  }

  public async restockPart(payload: {
    partCode: string;
    quantity: number;
  }): Promise<{ success: boolean; data: StoresPart; message?: string }> {
    return this.request<{ success: boolean; data: StoresPart; message?: string }>('/inventory/restock', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // =========================================================================
  // Phase 3 (M2): Component Health Passports & Serialization APIs (R4)
  // =========================================================================

  public async getComponents(filter: ComponentFilter = {}): Promise<{ success: boolean; data: SerializedComponent[]; pagination?: any }> {
    const params = new URLSearchParams();
    if (filter.componentType) params.set('componentType', filter.componentType);
    if (filter.status) params.set('status', filter.status);
    if (filter.category) params.set('category', filter.category);
    if (filter.wagonNumber) params.set('wagonNumber', filter.wagonNumber);
    if (filter.healthStatus) params.set('healthStatus', filter.healthStatus);
    if (filter.search) params.set('search', filter.search);
    if (filter.page) params.set('page', String(filter.page));
    if (filter.limit) params.set('limit', String(filter.limit));
    if (filter.sortBy) params.set('sortBy', filter.sortBy);
    if (filter.sortOrder) params.set('sortOrder', filter.sortOrder);
    const qs = params.toString();
    const res = await this.request<{ success: boolean; data?: SerializedComponent[]; components?: SerializedComponent[]; pagination?: any }>(
      `/components${qs ? `?${qs}` : ''}`
    );
    return {
      success: res.success,
      data: res.data || res.components || [],
      pagination: res.pagination
    };
  }

  public async getComponentStats(): Promise<{ success: boolean; data: ComponentStats }> {
    return this.request<{ success: boolean; data: ComponentStats }>('/components/stats');
  }

  public async getComponentBySerial(serialNumber: string): Promise<{ success: boolean; data: SerializedComponent & { history?: ComponentHistoryEvent[] } }> {
    return this.request<{ success: boolean; data: SerializedComponent & { history?: ComponentHistoryEvent[] } }>(
      `/components/${encodeURIComponent(serialNumber)}`
    );
  }

  public async getComponentByQR(qrCode: string): Promise<{ success: boolean; data: SerializedComponent; component?: SerializedComponent }> {
    return this.request<{ success: boolean; data: SerializedComponent; component?: SerializedComponent }>(
      `/components/qr/${encodeURIComponent(qrCode)}`
    );
  }

  public async scanComponentQR(qrPayload: string): Promise<{ success: boolean; data: SerializedComponent; component?: SerializedComponent }> {
    return this.request<{ success: boolean; data: SerializedComponent; component?: SerializedComponent }>(
      '/components/scan-qr',
      {
        method: 'POST',
        body: JSON.stringify({ qrPayload })
      }
    );
  }

  public async getComponentsByWagon(wagonNumber: string): Promise<{ success: boolean; data: SerializedComponent[] }> {
    const res = await this.request<{ success: boolean; data: SerializedComponent[] }>(
      `/components/wagon/${encodeURIComponent(wagonNumber)}`
    );
    return res;
  }

  public async getComponentHistory(serialNumber: string): Promise<{ success: boolean; data: ComponentHistoryEvent[] }> {
    return this.request<{ success: boolean; data: ComponentHistoryEvent[] }>(
      `/components/${encodeURIComponent(serialNumber)}/history`
    );
  }

  public async registerComponent(payload: RegisterComponentRequest): Promise<{ success: boolean; data: SerializedComponent; message?: string }> {
    return this.request<{ success: boolean; data: SerializedComponent; message?: string }>('/components/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async assignComponent(serialNumber: string, payload: AssignComponentRequest): Promise<{ success: boolean; data: SerializedComponent; message?: string }> {
    return this.request<{ success: boolean; data: SerializedComponent; message?: string }>(
      `/components/${encodeURIComponent(serialNumber)}/assign`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
  }

  public async unassignComponent(serialNumber: string, payload: UnassignComponentRequest = {}): Promise<{ success: boolean; data: SerializedComponent; message?: string }> {
    return this.request<{ success: boolean; data: SerializedComponent; message?: string }>(
      `/components/${encodeURIComponent(serialNumber)}/unassign`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
  }

  public async updateComponentHealth(serialNumber: string, payload: { healthScore: number; notes?: string }): Promise<{ success: boolean; data: SerializedComponent; message?: string }> {
    return this.request<{ success: boolean; data: SerializedComponent; message?: string }>(
      `/components/${encodeURIComponent(serialNumber)}/health`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
  }

  public async recordComponentOverhaul(serialNumber: string, payload: { pohDate?: string; nextPohDue?: string; restoredHealthScore?: number; notes?: string }): Promise<{ success: boolean; data: SerializedComponent; message?: string }> {
    return this.request<{ success: boolean; data: SerializedComponent; message?: string }>(
      `/components/${encodeURIComponent(serialNumber)}/overhaul`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
  }



  // =========================================================================
  // Single Wagon Test (air brake) — WMM 2.0 §720
  // =========================================================================

  public async recordSwt(wagonNumber: string, payload: {
    wagonType: string;
    pipeType: 'SINGLE' | 'TWIN';
    loadCondition: 'EMPTY' | 'LOADED';
    readings: Array<{ ref: string; value?: number | null; observed?: boolean }>;
    notes?: string;
  }): Promise<{ success: boolean; data: any }> {
    return this.request(`/wagons/${encodeURIComponent(wagonNumber)}/swt`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async getSwt(wagonNumber: string): Promise<{ success: boolean; data: { latest: any; history: any[] } }> {
    return this.request(`/wagons/${encodeURIComponent(wagonNumber)}/swt`);
  }

  // =========================================================================
  // Spring Sorting — bulk grouping of dismantled springs, no wagon involved
  // =========================================================================

  public async recordSortedSpring(payload: {
    batchId: string;
    bogieType: string;
    condition: string;
    springPosition: string;
    measuredFreeHeight: number;
    heightIsApproximate?: boolean;
    damageType?: string;
    syncId?: string;
  }): Promise<{ success: boolean; data: { id: string; band: string | null; bandRoman: string | null; status: string; tableReference: string | null; condemnationReason: string | null } }> {
    return this.request('/sorting/record', { method: 'POST', body: JSON.stringify(payload) });
  }

  public async getSortingBatch(batchId: string): Promise<{ success: boolean; data: { batchId: string; total: number; passed: number; condemned: number; byBand: any[] } }> {
    return this.request(`/sorting/batches/${encodeURIComponent(batchId)}`);
  }

  public async closeSortingBatch(batchId: string): Promise<{ success: boolean; data: any }> {
    return this.request(`/sorting/batches/${encodeURIComponent(batchId)}/close`, { method: 'POST', body: JSON.stringify({}) });
  }

  public async getSortingStock(bogieType: string, condition: string, forWagon?: string): Promise<{ success: boolean; data: { stock: any[]; capacity: any[] | null; wagon: any } }> {
    const params = new URLSearchParams({ bogieType, condition });
    if (forWagon) params.set('forWagon', forWagon);
    return this.request(`/sorting/stock?${params.toString()}`);
  }

  public async getSortingThroughput(date?: string): Promise<{ success: boolean; data: { date: string; total: number; passed: number; condemned: number } }> {
    const params = date ? `?date=${encodeURIComponent(date)}` : '';
    return this.request(`/sorting/throughput${params}`);
  }

  // =========================================================================
  // Phase 3 (M5): Smart Acoustic Bearing & Leak Detection APIs (R3)
  // =========================================================================

  public async logAcousticDiagnostic(payload: AcousticDiagnoseRequest): Promise<{ success: boolean; data: AcousticDiagnoseResponse; message?: string }> {
    return this.request<{ success: boolean; data: AcousticDiagnoseResponse; message?: string }>('/acoustic/diagnose', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async getAcousticHistory(wagonNumber: string): Promise<{ success: boolean; data: AcousticDiagnosticRecord[]; meta?: any }> {
    return this.request<{ success: boolean; data: AcousticDiagnosticRecord[]; meta?: any }>(`/acoustic/history/${encodeURIComponent(wagonNumber)}`);
  }
}

export const api = new ApiClient();

