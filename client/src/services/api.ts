/**
 * REST API Client for WRS Raipur Backend (Phase 1 & Phase 2)
 * Indian Railways Wagon Repair Shop Raipur
 */

import type { LearningSubsystem } from '../../../shared/learning/subsystems.ts';
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


/*
 * 401s that are about something the person just typed, not about their
 * session. See the auto-logout in request() below.
 */
const NOT_A_SESSION_PROBLEM = new Set([
  'INVALID_CREDENTIALS',  // a wrong password at sign-in
  'WRONG_PASSWORD',       // the current password on the change-password form
  'OTP_REQUIRED',         // an action that needs a confirmation code, without one
  'INVALID_OTP_TOKEN',    // a confirmation token that is not valid for this action
  'TOTP_REQUIRED',        // an authenticator code is needed
  'INVALID_TOTP',         // the authenticator code is wrong
  'INCORRECT_CODE'        // the emailed/inline OTP digits are wrong
]);

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

  /*
   * Told when the server stops accepting this session.
   *
   * A token lasts a day, so on a shop-floor tablet that is left signed in,
   * expiry mid-shift is a certainty rather than an edge case. Nothing handled
   * it: every request simply began failing. The work itself was safe — a
   * failed write falls back to the IndexedDB queue, and the sync keeps
   * anything the server did not accept — but the queue then never drained,
   * the pending badge climbed, and the only thing the inspector was told was
   * that things were failing.
   *
   * An inspector who is not told their session ended has no reason to think
   * signing in again would fix it, and every reason to think the app has lost
   * their work.
   */
  private sessionExpiredListeners: Array<() => void> = [];

  public onSessionExpired(cb: () => void): () => void {
    this.sessionExpiredListeners.push(cb);
    return () => {
      this.sessionExpiredListeners = this.sessionExpiredListeners.filter((l) => l !== cb);
    };
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

    /*
     * 401 while holding a token means the token is no longer good — expired,
     * or the account has been deactivated since it was issued. The session is
     * dropped and the app told, so the person is returned to a sign-in screen
     * that explains itself instead of a screen that quietly stops working.
     *
     * Deliberately not 403. That is the server refusing an action this user
     * is not allowed to take — a supervisor reaching for the divisional
     * analytics — and signing out over it would be both wrong and infuriating.
     *
     * The login route is excluded: a 401 there is a wrong password, and the
     * form already says so.
     *
     * So are the codes in NOT_A_SESSION_PROBLEM. Excluding by path was not
     * enough, because a 401 can mean two entirely different things: "your
     * session is over" and "what you just typed is wrong". Treating the second
     * as the first meant an inspector who mistyped their current password on
     * the change-password form was signed out instead of being told, and an
     * administrator who mistyped an authenticator code while confirming an
     * account change was signed out mid-change. Both were found by driving the
     * screens; neither shows up as an error anywhere, because signing out is
     * what this code is supposed to do.
     *
     * Listed by reason rather than by route on purpose. Any endpoint that
     * checks a credential the person just entered will 401 for the same
     * reason, and a list of paths would have to be remembered every time one
     * is added.
     */
    if (res.status === 401 && this.token && !path.startsWith('/auth/login') && !NOT_A_SESSION_PROBLEM.has(json?.error)) {
      this.clearSession();
      for (const cb of this.sessionExpiredListeners) {
        try { cb(); } catch { /* one bad listener must not swallow the rest */ }
      }
      throw new Error(
        json.message || 'Your session has ended. Sign in again — nothing you recorded has been lost.'
      );
    }

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
      otpToken: string;
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
    subsystem: LearningSubsystem;
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

  // Account changes carry an action token: creating an account is how someone
  // would grant themselves supervisor rights, and deactivating one is how they
  // would lock out whoever might notice.
  /**
   * Set an account's password, as an administrator.
   *
   * The remedy the production login guard names when it refuses an account
   * still on the demonstration password. No current password is asked for —
   * this exists precisely for the inspector who cannot supply one.
   */
  public async setUserPassword(id: string, password: string, otpToken: string): Promise<{ success: boolean; data: AdminUserRecord }> {
    return this.request(`/auth/users/${encodeURIComponent(id)}/password`, {
      method: 'POST',
      body: JSON.stringify({ password, otpToken })
    });
  }

  /** Change your own password. The current one is the authority for the change. */
  public async changeOwnPassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; data: { changed: boolean } }> {
    return this.request('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  }

  public async deactivateUser(id: string, otpToken: string): Promise<{ success: boolean; data: AdminUserRecord }> {
    return this.request(`/auth/users/${id}/deactivate`, { method: 'PATCH', body: JSON.stringify({ otpToken }) });
  }

  public async reactivateUser(id: string, otpToken: string): Promise<{ success: boolean; data: AdminUserRecord }> {
    return this.request(`/auth/users/${id}/reactivate`, { method: 'PATCH', body: JSON.stringify({ otpToken }) });
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

  /**
   * What each component on this wagon was FOUND as, before it was worked on.
   *
   * The checklist row holds the outcome, so a part found cracked and then
   * repaired reads REPAIRED with no trace of the finding. The history comes
   * from the audit log, which records every transition.
   */
  public async getChecklistHistory(wagonNumber: string): Promise<{ events: any[] }> {
    const res = await this.request<{ success: boolean; data: { events: any[] } }>(
      `/wagons/${encodeURIComponent(wagonNumber)}/checklist/history`
    );
    return { events: res?.data?.events || [] };
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
    /** As above: an enrolled supervisor's override needs the raw code. */
    totpCode?: string;
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

  /**
   * Add a part to one wagon's checklist.
   *
   * `addedReason` is required by the server: a row added to a single vehicle
   * has to say why it is there, because it may be enforcing the exit gate.
   * `isMandatory` needs checklist.configure — deciding a wagon cannot leave
   * without a part is a different act from noting that the part is there.
   */
  public async upsertChecklistItem(wagonNumber: string, payload: {
    category: string;
    partName: string;
    addedReason: string;
    bogiePosition?: string;
    status?: string;
    isMandatory?: boolean;
    conditionNotes?: string;
    photoId?: string;
  }): Promise<{ success: boolean; data: ChecklistItem }> {
    return this.request<{ success: boolean; data: ChecklistItem }>(`/wagons/${wagonNumber}/checklist/items`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  /** Withdraw a row somebody added to this wagon. Template rows are refused. */
  public async withdrawChecklistItem(wagonNumber: string, itemId: string, reason: string): Promise<{ success: boolean; data: { withdrawn: boolean; itemId: string }; message?: string }> {
    return this.request(`/wagons/${wagonNumber}/checklist/items/${itemId}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  }

  public async updateChecklistItem(wagonNumber: string, itemId: string, payload: {
    status?: string;
    repairAction?: string;
    repairNotes?: string;
    reinspectedStatus?: string;
    conditionNotes?: string;
    /**
     * The version of the row this verdict was formed against.
     *
     * The server has always accepted it and refused a write when the row moved
     * underneath the caller — and no screen ever sent it, so the protection
     * existed and never once engaged. Two inspectors working the same wagon
     * still overwrote each other silently, which is the exact failure the
     * check was written to stop.
     */
    expectedUpdatedAt?: string;
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
    /**
     * The six-digit code from the supervisor's authenticator.
     *
     * Sent raw rather than exchanged for an action token first. The server
     * requires this field once a supervisor is enrolled and refuses an
     * otpToken from them — "enrolled means enrolled" — so exchanging the code
     * produced a token the sign-off would not accept, and burnt the code's
     * 30-second window doing it.
     */
    totpCode?: string;
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
    /**
     * What this photograph is evidence OF: the state before work, the state
     * after it, or the defect itself.
     *
     * The server has validated and stored this from the beginning and no
     * screen ever sent one, so every photograph in the database has a null
     * evidence stage — which is why a condition report can show that a part
     * was found cracked and repaired, and cannot show the two pictures that
     * would settle it.
     */
    evidenceStage?: 'BEFORE' | 'AFTER' | 'DEFECT' | 'GENERAL';
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

  // =========================================================================
  // Checklist configuration — the shop's own list
  //
  // The API has existed from the start and had no screen. That gap is why,
  // when fourteen coupler items turned out to be for a draft gear the shop no
  // longer overhauls, the only remedy was a code change and it took five days.
  // =========================================================================

  /** The configured checklist for a wagon type, or the standard template if none is saved. */
  public async getChecklistConfig(wagonType?: string): Promise<{ success: boolean; data: any[] }> {
    const qs = wagonType ? `?wagonType=${encodeURIComponent(wagonType)}` : '';
    return this.request<{ success: boolean; data: any[] }>(`/checklist/config${qs}`);
  }

  /**
   * Adds or updates one line.
   *
   * `standardReference` is required by the server, not optional: a check that
   * cannot say where it comes from cannot be challenged by anyone.
   */
  public async upsertChecklistConfig(payload: {
    wagonType: string;
    category: string;
    partName: string;
    bogiePosition?: string;
    isMandatory: boolean;
    standardReference: string;
  }): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>('/checklist/config', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  /** Retires one line. Wagons already registered keep the checklist they were given. */
  public async retireChecklistConfig(payload: {
    wagonType: string;
    category: string;
    partName: string;
    bogiePosition?: string;
  }): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>('/checklist/config', {
      method: 'DELETE',
      body: JSON.stringify(payload)
    });
  }

  /** Whether this installation is backed up, and how large it has become. */
  public async getSystemStorage(): Promise<{ success: boolean; data: any }> {
    return this.request<{ success: boolean; data: any }>('/system/storage');
  }

  /** Which part keeps coming back, and on how many distinct wagons. */
  public async getAnalyticsFindings(limit = 40): Promise<{ success: boolean; data: any }> {
    return this.request<{ success: boolean; data: any }>(`/analytics/findings?limit=${limit}`);
  }

  public async getAnalyticsParts(): Promise<{ success: boolean; data: any }> {
    return this.request<{ success: boolean; data: any }>('/analytics/parts');
  }

  /**
   * Expected spring replacements over the coming period, so Stores can
   * pre-position rather than react. Divisional reading — analytics.read.
   */
  public async getConsumptionForecast(days = 14): Promise<{ success: boolean; data: any }> {
    return this.request<{ success: boolean; data: any }>(`/analytics/forecast?days=${days}`);
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

  /**
   * Re-derives every hash in the audit log and reports whether the chain
   * still adds up. Supervisor and above.
   *
   * The whole system's claim is that nothing can be quietly changed after the
   * fact. Append-only triggers enforce that through the application; the
   * hash chain is what catches a change that went around it — someone editing
   * the database file directly. This is the only way to ask whether that has
   * happened, so it needs to be answerable by the supervisor who signs
   * releases, not only by someone with a terminal and a hand-minted token.
   */
  /**
   * The recent end of the audit chain, at dashboard cost.
   *
   * A weaker claim than verifyAuditChain: `scope` is 'TAIL' whenever fewer
   * entries were walked than the log holds, and a screen must say so rather
   * than reporting the record intact.
   */
  public async verifyAuditChainTail(entries = 500): Promise<{
    success: boolean;
    data: { verified: boolean; entriesChecked: number; totalEntries: number; breaksFound: number; scope: 'FULL' | 'TAIL'; summary: string };
  }> {
    return this.request(`/audit/verify/tail?entries=${entries}`);
  }

  public async verifyAuditChain(): Promise<{
    success: boolean;
    data: {
      verified: boolean;
      entriesChecked: number;
      breaksFound: number;
      firstBrokenAt: {
        rowid: number;
        id: string;
        eventType: string;
        createdAt: string;
        reason: 'CONTENT_ALTERED' | 'BROKEN_LINK' | 'GENESIS_MISMATCH' | 'UNCHAINED';
        detail: string;
      } | null;
      checkedAt: string;
      summary: string;
    };
  }> {
    return this.request('/audit/verify');
  }

  /**
   * The activity ledger — every recorded action, not only springs.
   *
   * History & Logs used to query the inspections table alone, so a supervisor
   * looking for "who moved this wagon to Painting" found nothing at all. This
   * reads the audit log itself, which has held those events all along.
   */
  public async getActivityLog(options?: {
    limit?: number;
    offset?: number;
    eventType?: string;
    actor?: string;
    role?: string;
    since?: string;
    until?: string;
    search?: string;
  }): Promise<{
    success: boolean;
    data: {
      entries: Array<{
        id: string;
        eventType: string;
        inspectionId: string | null;
        actorId: string;
        actorName: string;
        actorEmployeeId: string | null;
        actorRole: string;
        ipAddress: string | null;
        occurredAt: string;
        detail: Record<string, any>;
      }>;
      total: number;
      limit: number;
      offset: number;
    };
  }> {
    const p = new URLSearchParams();
    if (options?.limit) p.set('limit', String(options.limit));
    if (options?.offset) p.set('offset', String(options.offset));
    if (options?.eventType) p.set('eventType', options.eventType);
    if (options?.actor) p.set('actor', options.actor);
    if (options?.role) p.set('role', options.role);
    if (options?.since) p.set('since', options.since);
    if (options?.until) p.set('until', options.until);
    if (options?.search) p.set('search', options.search);
    const qs = p.toString();
    return this.request(`/audit/activity${qs ? `?${qs}` : ''}`);
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

  /**
   * Records a routine overhaul. WMM 2.0 Chapter 6 tracks this in paint — one
   * more end cap screw painted yellow at each ROH — and it is what the exit
   * gate checks when it requires every bearing under a wagon to share a
   * painting scheme.
   */
  public async recordComponentRoh(serialNumber: string, notes?: string): Promise<{ success: boolean; data: SerializedComponent; message?: string }> {
    return this.request<{ success: boolean; data: SerializedComponent; message?: string }>(
      `/components/${encodeURIComponent(serialNumber)}/roh`,
      { method: 'POST', body: JSON.stringify({ notes }) }
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





  /**
   * Threshold values the running app should use, as tuned and approved.
   * Cached by tunables.ts — this is the raw fetch.
   */
  public async getEffectiveParameters(): Promise<{ success: boolean; data: Record<string, number> }> {
    return this.request('/learning/parameters/effective');
  }

  public async getLearningMemory(): Promise<{ success: boolean; data: any }> {
    return this.request('/learning/memory');
  }

  public async getParameterHistory(paramKey: string): Promise<{ success: boolean; data: any[] }> {
    return this.request(`/learning/parameters/${encodeURIComponent(paramKey)}/history`);
  }

  // =========================================================================
  // Authenticator (TOTP) — a real second factor
  // =========================================================================

  /**
   * The gauges in the register, and whether their calibration still stands.
   *
   * A reading is only worth its instrument's calibration record, and until
   * now nothing recorded which instrument produced a measurement at all.
   */
  public async getGauges(appliesTo?: string): Promise<{
    success: boolean;
    data: {
      gauges: Array<{
        id: string; gaugeCode: string; description: string; appliesTo: string | null;
        certificateNumber: string | null; issuedTo: string | null;
        calibratedOn: string | null; validUpto: string | null; isActive: boolean;
        notes: string | null;
        calibrationState: 'VALID' | 'EXPIRED' | 'UNRECORDED' | 'NO_GAUGE_NAMED';
        calibrationSummary: string;
      }>;
    };
  }> {
    return this.request(`/gauges${appliesTo ? `?appliesTo=${encodeURIComponent(appliesTo)}` : ''}`);
  }

  /** How much recorded work rests on an instrument nobody has verified. */
  public async getGaugeExposure(): Promise<{
    success: boolean;
    data: { unrecorded: number; expired: number; noGauge: number; total: number; summary: string };
  }> {
    return this.request('/gauges/exposure');
  }

  /** Record or amend a gauge, including its calibration. Administrators only. */
  public async saveGauge(gaugeCode: string, gauge: {
    description: string;
    appliesTo?: string | null;
    certificateNumber?: string | null;
    issuedTo?: string | null;
    calibratedOn?: string | null;
    validUpto?: string | null;
    notes?: string | null;
  }): Promise<{ success: boolean; data: { gauge: any } }> {
    return this.request(`/gauges/${encodeURIComponent(gaugeCode)}`, {
      method: 'PUT',
      body: JSON.stringify(gauge)
    });
  }

  public async getTotpStatus(): Promise<{ success: boolean; data: { enrolled: boolean; username: string } }> {
    return this.request('/auth/totp/status');
  }

  public async beginTotpEnrolment(): Promise<{ success: boolean; data: { secret: string; uri: string } }> {
    return this.request('/auth/totp/enrol', { method: 'POST', body: JSON.stringify({}) });
  }

  public async confirmTotpEnrolment(code: string): Promise<{ success: boolean; message?: string }> {
    return this.request('/auth/totp/confirm', { method: 'POST', body: JSON.stringify({ code }) });
  }

  /**
   * Exchanges an authenticator code for a single-use, action-scoped token.
   * The token is what the protected endpoint actually accepts.
   */
  public async verifyTotpForAction(
    action: 'OVERRIDE' | 'EXPORT' | 'USER_MGMT',
    code: string
  ): Promise<{ success: boolean; data: { otpToken: string; action: string } }> {
    return this.request('/auth/totp/verify', { method: 'POST', body: JSON.stringify({ action, code }) });
  }

  public async resetUserTotp(userId: string): Promise<{ success: boolean; message?: string }> {
    return this.request(`/auth/users/${encodeURIComponent(userId)}/totp/reset`, {
      method: 'POST',
      body: JSON.stringify({})
    });
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
    /** The gauge the reading was taken with, when one is named. */
    gaugeCode?: string | null;
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

  /**
   * How many whole bogies the sorted stock builds, and which position limits it.
   *
   * getSortingStock answers "how many groups can each band supply". This answers
   * the question the floor has: a bogie needs its outer, inner and snubber
   * groups together and is finished when the scarcest runs out.
   */
  public async getNestAllocation(bogieType: string, condition: string, forWagon: string): Promise<{ success: boolean; data: { allocation: any; wagon: any } }> {
    const params = new URLSearchParams({ bogieType, condition, forWagon });
    return this.request(`/sorting/allocation?${params.toString()}`);
  }

  /** What the inspector did about a reading the anomaly check questioned. */
  public async recordAnomalyOutcome(
    recordId: string,
    action: 'RE_MEASURED' | 'CONFIRMED',
    originalHeight?: number,
    correctedHeight?: number
  ): Promise<{ success: boolean; data: any }> {
    return this.request(`/sorting/records/${encodeURIComponent(recordId)}/anomaly-outcome`, {
      method: 'POST',
      body: JSON.stringify({ action, originalHeight, correctedHeight })
    });
  }

  /**
   * Corrects the last spring recorded in a sorting session.
   *
   * Nothing is deleted — the server appends a superseding record — so this is
   * safe to call and safe to have called by accident.
   */
  public async undoLastSortedSpring(batchId: string): Promise<{
    success: boolean;
    data: {
      corrected: boolean;
      message?: string;
      correctedId?: string;
      summary?: any;
      /** The spring that was taken out of the count, so the screen can name it. */
      withdrew?: {
        band: string | null;
        bandRoman: string | null;
        measuredHeight: number | null;
        springPosition: string | null;
        status: string | null;
      };
    };
  }> {
    return this.request(`/sorting/batches/${encodeURIComponent(batchId)}/undo`, { method: 'POST' });
  }

  /**
   * Stores a photograph of a spring against the verdict a person gave it.
   *
   * Never blocks the tap. Sorting is ~700 springs a shift and the record is
   * the work; the photograph is evidence attached to it, so a camera failure
   * must never cost a spring.
   */
  public async attachSpringImage(
    sortingRecordId: string | null,
    payload: {
      batchId: string;
      bogieType: string;
      condition: string;
      springPosition: string;
      band?: string | null;
      status: string;
      measuredFreeHeight?: number;
      imageData: string;
      width?: number;
      height?: number;
    }
  ): Promise<{ success: boolean; data: { stored: boolean; id: string | null } }> {
    return this.request(`/sorting/records/${encodeURIComponent(sortingRecordId || 'unlinked')}/image`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  /** The evidence photographs themselves, newest first. */
  public async getSpringImages(options?: { limit?: number; batchId?: string; condemnedOnly?: boolean }): Promise<{
    success: boolean;
    data: Array<{
      id: string; sortingRecordId: string | null; bogieType: string; springPosition: string;
      band: string | null; status: string; measuredHeight: number | null;
      imageData: string; inspectorId: string; createdAt: string;
    }>;
  }> {
    const p = new URLSearchParams();
    if (options?.limit) p.set('limit', String(options.limit));
    if (options?.batchId) p.set('batchId', options.batchId);
    if (options?.condemnedOnly) p.set('condemnedOnly', 'true');
    const qs = p.toString();
    return this.request(`/sorting/images${qs ? '?' + qs : ''}`);
  }

  public async getSpringDataset(): Promise<{
    success: boolean;
    data: {
      total: number;
      byLabel: Array<{ bogieType: string; condition: string; springPosition: string; band: string | null; status: string; count: number }>;
    };
  }> {
    return this.request('/sorting/dataset');
  }

  /**
   * How much labelled photographic evidence exists, and of what.
   *
   * Counts rather than images: the question is whether there is enough of a
   * given kind to attempt or score anything, and thin classes are the answer.
   */
  public async getSortingDataset(): Promise<{ success: boolean; data: { total: number; byLabel: any[] } }> {
    return this.request('/sorting/dataset');
  }

  /**
   * Bogie assembly coverage — how many bogies have been photographed from
   * every side, not how many photographs exist.
   *
   * A separate call from getSortingDataset() because the unit differs. A
   * spring set is counted per class; an assembly set is counted per BOGIE,
   * since one side of a CASNUB cannot answer whether a pocket was left empty.
   */
  /**
   * Whether this installation is actually ready to be used.
   *
   * Every item comes back measured rather than declared — the Zapheit row is
   * a live call, the audit row recomputes the chain, the password row hashes
   * real passwords — so this can be slower than an ordinary read. That is the
   * cost of a tick meaning something.
   */
  public async getSystemReadiness(): Promise<{
    success: boolean;
    data: {
      ready: boolean;
      environment: string;
      passed: number;
      warned: number;
      failed: number;
      checks: Array<{ id: string; label: string; state: 'PASS' | 'WARN' | 'FAIL'; detail: string }>;
    };
  }> {
    return this.request('/system/readiness');
  }

  public async getAssemblyDataset(limit?: number): Promise<{
    success: boolean;
    data: {
      totalPhotos: number;
      completeBogies: number;
      partialBogies: number;
      photosByDesignation: Record<string, number>;
      unusablePhotos: number;
      readiness: string;
      negativesWarning: string;
    };
  }> {
    // Coverage is summarised over the rows the route returns, so the caller
    // decides the window rather than silently accepting the route's default.
    return this.request(`/photos/dataset/assembly${limit ? `?limit=${limit}` : ''}`);
  }

  public async getSortingThroughput(date?: string): Promise<{ success: boolean; data: { date: string; total: number; passed: number; condemned: number; firstAt: string | null; lastAt: string | null } }> {
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

  /**
   * The shift, written down.
   *
   * The draft is produced from the day's own records — by a model when one is
   * reachable, by a fixed template when not — and is never stored. Only the
   * note a supervisor approves is recorded, under their own name.
   */
  /**
   * Lines the manual can propose for a wagon type's checklist, cited by page,
   * minus the ones already listed. Nothing is written by asking.
   */
  public async getChecklistProposals(wagonType: string): Promise<{
    success: boolean;
    data: {
      wagonType: string;
      proposals: Array<{ key: string; partName: string; kind: 'MUST_CHANGE' | 'PROCEDURE'; qtyPerWagon: number | null; suggestedCategory: string; page: number; chapter: string | null; excerpt: string; standardReference: string; alreadyListed: boolean }>;
      summary: { total: number; mustChange: number; procedures: number; alreadyListed: number };
    };
  }> {
    return this.request(`/checklist/proposals?wagonType=${encodeURIComponent(wagonType)}`);
  }

  /** Accept several proposed lines at once. Each must cite a source or is refused alone. */
  public async bulkUpsertChecklistConfig(wagonType: string, items: Array<{ partName: string; category: string; bogiePosition?: string; isMandatory?: boolean; standardReference: string }>): Promise<{
    success: boolean; data: { accepted: string[]; refused: Array<{ partName: string; reason: string }> };
  }> {
    return this.request('/checklist/config/bulk', { method: 'POST', body: JSON.stringify({ wagonType, items }) });
  }

  /** A spring photograph this reader has not seen, without its label. Null when none is left. */
  public async getNextBlindImage(): Promise<{ success: boolean; data: { id: string; bogieType: string; springPosition: string; imageData: string; mimeType: string } | null }> {
    return this.request('/sorting/blind-read/next');
  }

  public async recordBlindRead(payload: { imageId: string; band: string | null; status: 'PASS' | 'CONDEMNED' | 'CANNOT_TELL' }): Promise<{ success: boolean; data: { id: string; bandAgrees: boolean | null; statusAgrees: boolean | null } }> {
    return this.request('/sorting/blind-read', { method: 'POST', body: JSON.stringify(payload) });
  }

  /** The A0 number: how often a second person reads the same band from the photograph. */
  public async getBlindReadAgreement(): Promise<{ success: boolean; data: { reads: number; cannotTell: number; bandRead: number; bandAgreed: number; bandAgreementPct: number | null; statusRead: number; statusAgreed: number; statusAgreementPct: number | null; readers: number; byPosition: Array<{ springPosition: string; bandRead: number; bandAgreed: number }>; verdict: 'INSUFFICIENT' | 'ASSIST' | 'FLAG_ONLY' | 'STOP'; minReads: number } }> {
    return this.request('/sorting/blind-read/agreement');
  }


  // -------------------------------------------------------------------------
  // Parts in, parts out
  //
  // The DRM's question about what happens after a wagon leaves. Recorded
  // during dismantling and reassembly, one entry per event, and reconciled at
  // the gate.
  // -------------------------------------------------------------------------

  public async recordPartEvent(
    wagonNumber: string,
    payload: {
      category: string;
      partName: string;
      bogiePosition?: string | null;
      event: 'REMOVED' | 'REFITTED' | 'REPLACED' | 'SCRAPPED' | 'NOT_FITTED';
      quantity?: number;
      /** Required for SCRAPPED and NOT_FITTED: a part not going back needs a decision. */
      reason?: string | null;
      photoId?: string | null;
      storesItemId?: string | null;
      componentSerial?: string | null;
    }
  ): Promise<{ success: boolean; data: PartLedgerEntry }> {
    return this.request(`/wagons/${encodeURI(wagonNumber)}/parts`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async getPartLedger(
    wagonNumber: string
  ): Promise<{ success: boolean; data: { wagonNumber: string; entries: PartLedgerEntry[] } }> {
    return this.request(`/wagons/${encodeURI(wagonNumber)}/parts`);
  }

  /** Does what came off match what went back on — with what to do about it. */
  public async getPartReconciliation(
    wagonNumber: string
  ): Promise<{ success: boolean; data: PartReconciliation }> {
    return this.request(`/wagons/${encodeURI(wagonNumber)}/parts/reconciliation`);
  }

  // -------------------------------------------------------------------------
  // The camera's memory
  //
  // Loaded once when a bench opens the camera, and added to every time an
  // inspector confirms or corrects what it proposed. Kept on the server rather
  // than in the browser so that what one bench learns, every bench knows — and
  // so that it is inside the database the weekly backup carries off the
  // machine.
  // -------------------------------------------------------------------------

  /** Everything the camera has been taught, so the browser can rebuild it. */
  public async getVisionBrain(domain: 'SPRING' | 'WAGON_PART' = 'SPRING'): Promise<{
    success: boolean;
    data: {
      domain: string;
      counts: Record<string, Record<string, number>>;
      examples: Array<{
        id: string;
        head: 'CATEGORY' | 'SURFACE' | 'DAMAGE' | 'PART_ID';
        label: string;
        embedding: string;
        thumbnail: string | null;
        sourceImageId: string | null;
        partName: string | null;
        taughtBy: string;
        createdAt: string;
      }>;
    };
    meta: { total: number };
  }> {
    return this.request(`/vision/brain?domain=${encodeURIComponent(domain)}`);
  }

  /**
   * One photograph, and what a person called it.
   *
   * `proposedLabel` is what the camera offered, and passing it is what makes
   * the accuracy figures honest — the server derives "was this a correction"
   * from the difference rather than taking the client's word for it. Omit it
   * when the camera stayed silent; a teaching with no proposal says nothing
   * about accuracy and must not be counted as agreement.
   */
  public async teachVisionBrain(payload: {
    domain: 'SPRING' | 'WAGON_PART';
    head: 'CATEGORY' | 'SURFACE' | 'DAMAGE' | 'PART_ID';
    label: string;
    embedding: string;
    /** A small JPEG data URL of the crop, so an answer can be shown, not just stated. */
    thumbnail?: string | null;
    proposedLabel?: string | null;
    confidence?: number | null;
    sourceImageId?: string | null;
    partName?: string | null;
    bogiePosition?: string | null;
  }): Promise<{ success: boolean; data: { id: string; head: string; label: string; wasCorrection: boolean } }> {
    return this.request('/vision/brain/teach', { method: 'POST', body: JSON.stringify(payload) });
  }

  /** Is it actually getting better — agreement week by week, not example count. */
  public async getVisionBrainProgress(
    domain: 'SPRING' | 'WAGON_PART' = 'SPRING',
    head?: 'CATEGORY' | 'SURFACE' | 'DAMAGE' | 'PART_ID'
  ): Promise<{
    success: boolean;
    data: {
      domain: string;
      head: string | null;
      counts: Record<string, Record<string, number>>;
      weeks: Array<{ week: string; taught: number; proposed: number; corrections: number; agreementRate: number | null }>;
      summary: string;
    };
  }> {
    return this.request(
      `/vision/brain/progress?domain=${encodeURIComponent(domain)}${head ? `&head=${encodeURIComponent(head)}` : ''}`
    );
  }

  public async draftShiftHandover(date?: string): Promise<{
    success: boolean;
    data: { shiftDate: string; facts: Record<string, number | string>; draft: string; source: 'MODEL' | 'TEMPLATE'; rejectedNumbers: string[] };
  }> {
    return this.request(`/shift/handover/draft${date ? `?date=${encodeURIComponent(date)}` : ''}`);
  }

  public async recordShiftHandover(payload: { shiftDate: string; body: string; draftSource: 'MODEL' | 'TEMPLATE'; edited: boolean }): Promise<{ success: boolean; data: { id: string; shiftDate: string } }> {
    return this.request('/shift/handover', { method: 'POST', body: JSON.stringify(payload) });
  }

  public async getShiftHandovers(limit = 10): Promise<{
    success: boolean;
    data: Array<{ id: string; shiftDate: string; body: string; draftSource: string; edited: boolean; recordedByName: string; createdAt: string }>;
  }> {
    return this.request(`/shift/handover?limit=${limit}`);
  }

  public async getAcousticHistory(wagonNumber: string): Promise<{ success: boolean; data: AcousticDiagnosticRecord[]; meta?: any }> {
    return this.request<{ success: boolean; data: AcousticDiagnosticRecord[]; meta?: any }>(`/acoustic/history/${encodeURIComponent(wagonNumber)}`);
  }
}

/** One thing that happened to one part, on one wagon. */
export interface PartLedgerEntry {
  id: string;
  wagonNumber: string;
  partKey: string;
  category: string;
  partName: string;
  bogiePosition: string;
  event: 'REMOVED' | 'REFITTED' | 'REPLACED' | 'SCRAPPED' | 'NOT_FITTED';
  quantity: number;
  reason: string | null;
  photoId: string | null;
  storesItemId: string | null;
  componentSerial: string | null;
  stage: string;
  inspectorId: string;
  inspectorName: string;
  createdAt: string;
}

export interface PartBalance {
  partKey: string;
  category: string;
  partName: string;
  bogiePosition: string;
  removed: number;
  refitted: number;
  replaced: number;
  scrapped: number;
  notFitted: number;
  outstanding: number;
  unaccounted: boolean;
  photographs: number;
  /** What to do next, assembled from the ledger, stores and the cited standard. */
  suggestion: string | null;
}

export interface PartReconciliation {
  wagonNumber: string;
  balanced: boolean;
  totalRemoved: number;
  totalBack: number;
  outstandingParts: PartBalance[];
  unaccountedParts: PartBalance[];
  parts: PartBalance[];
  summary: string;
}

export const api = new ApiClient();

