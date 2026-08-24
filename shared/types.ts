/**
 * Shared Type Definitions for Indian Railways WRS Raipur
 * Spring Classification & Inspection System (RDSO Technical Pamphlet G-95 Revision-II)
 *
 * Single source of truth for domain models, enums, tables, and API contracts.
 */

// -------------------------------------------------------------------------
// Domain Enums & Literals
// -------------------------------------------------------------------------

export type BogieType = 
  | 'CASNUB_22_NLB' 
  | 'CASNUB_22_HS' 
  | 'CASNUB_22_RFT';

export type SpringCondition = 
  | 'USED' 
  | 'NEW';

export type SpringPosition = 
  | 'OUTER' 
  | 'INNER' 
  | 'SNUBBER' 
  | 'SNUBBER_OUTER' 
  | 'SNUBBER_INNER';

export type BandColor = 
  | 'BLUE' 
  | 'GREEN' 
  | 'YELLOW' 
  | 'ORANGE' 
  | 'WHITE' 
  | 'RED';

export type BandRoman = 
  | 'Band I' 
  | 'Band II' 
  | 'Band III' 
  | 'Band IV' 
  | 'Band V' 
  | 'Band VI';

export type InspectionStatus = 
  | 'PASS' 
  | 'CONDEMNED';

export type DamageType = 
  | 'NONE' 
  | 'CRACK' 
  | 'CORROSION' 
  | 'DEFORMATION' 
  | 'OTHER';

export type UserRole = 
  | 'INSPECTOR' 
  | 'SUPERVISOR' 
  | 'ADMIN' 
  | 'Inspector' 
  | 'Supervisor' 
  | 'Admin';

export type OtpAction = 
  | 'OVERRIDE' 
  | 'EXPORT' 
  | 'USER_MGMT';

export type MeasurementSource = 
  | 'MANUAL' 
  | 'OCR';

export type LanguageCode = 
  | 'hi' 
  | 'en';

// -------------------------------------------------------------------------
// User & Auth Types
// -------------------------------------------------------------------------

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  employeeId?: string;
  shopFloor?: string;
  isActive?: boolean;
  token?: string;
}

export interface AuthLoginRequest {
  username: string;
  password: string;
}

export interface AuthLoginResponse {
  token: string;
  expiresIn: number;
  user: User;
}

// -------------------------------------------------------------------------
// RDSO G-95 Table & Band Definitions
// -------------------------------------------------------------------------

export interface RangeInterval {
  min: number; // Inclusive lower bound
  max: number; // Inclusive upper bound
}

export interface RDSOBandDefinition {
  band: BandColor;
  bandRoman: BandRoman;
  minHeight: number; // inclusive lower bound
  maxHeight: number; // inclusive upper bound for Band 1, exclusive upper bound for lower bands
  isHighestBand?: boolean;
  bandNumber?: number;
}

export interface TableBandDefinition {
  band: BandColor;
  bandRoman: BandRoman;
  range: RangeInterval;
}

export interface RDSOTableDefinition {
  tableNumber: string; // 'Table 28', 'Table 29', etc.
  tableReference?: string;
  bogieType: BogieType;
  condition: SpringCondition;
  position: SpringPosition;
  nominalFreeHeight?: number;
  nominalHeight?: number;
  tolerance?: number;
  condemningMinHeight: number;
  condemningMaxHeight: number;
  validRange?: RangeInterval;
  bands: RDSOBandDefinition[];
}

export type SpringTableEntry = RDSOTableDefinition;

// -------------------------------------------------------------------------
// Classification Request & Response
// -------------------------------------------------------------------------

export interface ClassificationRequest {
  bogieType: BogieType;
  condition: SpringCondition;
  position: SpringPosition;
  measuredHeight: number; // in mm
  damageType?: DamageType;
  damageNotes?: string;
}

export interface ClassificationResult {
  band: BandColor | null;
  bandRoman: BandRoman | null;
  status: InspectionStatus;
  tableReference: string; // e.g. 'Table 28'
  validRange: RangeInterval;
  bandRange?: RangeInterval | null;
  measuredHeight?: number;
  bogieType?: BogieType;
  condition?: SpringCondition;
  position?: SpringPosition;
  condemnationReason?: string | null;
  isOverridden?: boolean;
  colorHex?: string;
  details?: {
    bogieType: BogieType;
    condition: SpringCondition;
    position: SpringPosition;
    measuredHeight: number;
    matchedBandIndex?: number;
  };
}

// -------------------------------------------------------------------------
// Inspection & Audit Logging Types
// -------------------------------------------------------------------------

export interface InspectionRecord {
  id: string;
  sequenceNumber?: number;
  sequence_number?: number;
  timestamp: string; // ISO 8601 UTC
  created_at?: string;
  clientTimestamp?: string;
  offline_created_at?: string;
  inspectorId: string;
  inspector_id?: string;
  inspectorName?: string;
  inspector_name?: string;
  wagonNumber: string;
  wagon_number?: string;
  bogieType: BogieType;
  bogie_type?: BogieType;
  springPosition: SpringPosition;
  spring_position?: SpringPosition;
  bogiePosition?: 'BOGIE_1' | 'BOGIE_2' | null;
  bogie_position?: 'BOGIE_1' | 'BOGIE_2' | null;
  condition: SpringCondition;
  spring_condition?: SpringCondition;
  measuredFreeHeight: number;
  measured_height?: number;
  classifiedBand: BandColor | null;
  classified_band?: BandColor | null;
  band?: BandColor | null;
  bandRoman: BandRoman | null;
  band_roman?: BandRoman | null;
  status: InspectionStatus;
  damageType: DamageType;
  damage_type?: DamageType;
  damageNotes?: string | null;
  damage_notes?: string | null;
  condemnationReason?: string | null;
  condemnation_reason?: string | null;
  tableReference: string;
  table_reference?: string;
  valid_range_min?: number;
  valid_range_max?: number;
  isOverridden: boolean;
  supervisor_override?: number;
  originalBand?: BandColor | null;
  original_band?: BandColor | null;
  overrideBand?: BandColor | null;
  override_band?: BandColor | null;
  overrideReason?: string | null;
  override_reason?: string | null;
  supervisorId?: string | null;
  override_supervisor_id?: string | null;
  supervisorName?: string | null;
  override_supervisor_name?: string | null;
  otpTokenRef?: string | null;
  otp_token_ref?: string | null;
  measurementSource?: MeasurementSource;
  measurement_source?: MeasurementSource;
  ocrConfidence?: number | null;
  ocr_confidence?: number | null;
  ocrImageRef?: string | null;
  ocr_image_ref?: string | null;
  syncStatus?: 'LOCAL' | 'SYNCED';
  sync_id?: string | null;
  synced_at?: string | null;
  auditHash?: string;
}

export interface InspectionCreateRequest {
  wagonNumber: string;
  bogieType: BogieType;
  condition: SpringCondition;
  position?: SpringPosition;
  springPosition?: SpringPosition;
  /** Which bogie the spring came off — required to link it to the right checklist item. */
  bogiePosition?: 'BOGIE_1' | 'BOGIE_2';
  measuredHeight?: number;
  measuredFreeHeight?: number;
  damageType?: DamageType;
  damageNotes?: string;
  clientTimestamp?: string;
  syncId?: string;
  measurementSource?: MeasurementSource;
  ocrConfidence?: number;
  ocrImageRef?: string;
  // Override fields
  overrideBand?: BandColor | null;
  overrideReason?: string | null;
  otpToken?: string | null;
  otpTokenRef?: string | null;
}

export interface InspectionFilter {
  wagonNumber?: string;
  startDate?: string;
  endDate?: string;
  inspectorId?: string;
  band?: BandColor | string;
  status?: InspectionStatus | string;
  bogieType?: BogieType | string;
  condition?: SpringCondition | string;
  position?: SpringPosition | string;
  supervisorOverride?: boolean;
  damageType?: DamageType | string;
  page?: number;
  limit?: number;
  sortBy?: 'timestamp' | 'created_at' | 'wagonNumber' | 'wagon_number' | 'measuredHeight' | 'measured_height' | 'id';
  sortOrder?: 'asc' | 'desc' | 'ASC' | 'DESC';
}

export type InspectionQueryParams = InspectionFilter;

export interface InspectionStats {
  totalInspections: number;
  totalPassed: number;
  totalCondemned: number;
  condemnationRatePercentage: number;
  totalOverrides?: number;
  overrideRatePercentage?: number;
  uniqueWagonsCount?: number;
  activeInspectorsCount?: number;
  bandDistribution: Record<BandColor, number>;
  bogieTypeDistribution: Record<BogieType, number>;
  conditionDistribution: Record<SpringCondition, number>;
  damageTypeDistribution: Record<DamageType, number>;
  hourlyThroughput?: Array<{ hour: string; count: number; passCount?: number; condemnCount?: number }>;
  inspectorProductivity?: Array<{
    inspectorId: string;
    inspectorName: string;
    inspectionsCount: number;
    passedCount?: number;
    condemnedCount: number;
  }>;
}

// -------------------------------------------------------------------------
// Audit Log Entry
// -------------------------------------------------------------------------

export type AuditEventType = 
  | 'INSPECTION_CREATED' 
  | 'SUPERVISOR_OVERRIDE_RECORDED' 
  | 'INSPECTION_SYNCED' 
  | 'BATCH_EXPORTED' 
  | 'SECURITY_ALERT'
  | 'AUTH_LOGIN'
  | 'OTP_GENERATED'
  | 'OTP_VERIFIED';

export interface AuditLogEntry {
  id: string;
  inspectionId?: string | null;
  eventType: AuditEventType;
  userId: string;
  userRole: string;
  ipAddress?: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

// -------------------------------------------------------------------------
// OTP Verification Types
// -------------------------------------------------------------------------

export interface OTPRequest {
  action: OtpAction;
  userId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface OTPRequestResponse {
  otpId: string;
  action: OtpAction;
  expiresInSeconds: number;
  message: string;
  devOtpCode?: string; // For testing/development environment
}

export interface OTPVerification {
  otpId: string;
  otpCode: string;
}

export interface OTPVerifyResponse {
  otpToken: string;
  tokenRef?: string;
  action: OtpAction;
  validUntil: string;
}

// -------------------------------------------------------------------------
// Caliper OCR Types
// -------------------------------------------------------------------------

export interface CaliperOCRRequest {
  imageBase64?: string;
  imageBuffer?: Buffer;
  mimeType?: string;
}

export interface CaliperOCRResult {
  measuredHeight: number;
  confidence: number; // 0.0 - 1.0
  processingTimeMs: number;
  rawText?: string;
  digits?: string;
  unit?: string;
  isWithinValidRange?: boolean;
  suggestedBand?: BandColor | null;
  fallbackSuggested?: 'MANUAL_INPUT' | null;
}

// -------------------------------------------------------------------------
// Offline Sync Types
// -------------------------------------------------------------------------

export interface SyncPayload {
  records: Array<Omit<InspectionRecord, 'id' | 'sequenceNumber'> & { clientTempId?: string; syncId?: string }>;
  deviceId?: string;
  syncTimestamp?: string;
}

export interface SyncResponse {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  duplicateCount?: number;
  syncedRecords: Array<{ clientTempId?: string; serverId: string; sequenceNumber: number }>;
  syncedIds?: string[];
  errors?: Array<{ clientTempId?: string; error: string }>;
}

// -------------------------------------------------------------------------
// Bilingual & Internationalization
// -------------------------------------------------------------------------

export interface BilingualEntry {
  en: string;
  hi: string;
}

// -------------------------------------------------------------------------
// API Response Wrappers
// -------------------------------------------------------------------------

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: {
    timestamp: string;
    requestId?: string;
    [key: string]: unknown;
  };
}

export interface ApiPaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  message: string;
  statusCode: number;
  details?: unknown;
  timestamp: string;
}

// -------------------------------------------------------------------------
// Phase 2: 7-Stage Wagon Lifecycle Tracking
// -------------------------------------------------------------------------

export type LifecycleStage =
  | 'ENTRY_REGISTRATION'
  | 'DISMANTLING'
  | 'COMPONENT_INSPECTION'
  | 'REPAIR_REPLACEMENT'
  | 'REASSEMBLY'
  | 'FINAL_QC_GATE'
  | 'RELEASE';

export const LIFECYCLE_STAGES: readonly LifecycleStage[] = [
  'ENTRY_REGISTRATION',
  'DISMANTLING',
  'COMPONENT_INSPECTION',
  'REPAIR_REPLACEMENT',
  'REASSEMBLY',
  'FINAL_QC_GATE',
  'RELEASE'
] as const;

export interface WagonRecord {
  /** Hours since entry, computed server-side (wagonRepository.mapWagonRow). */
  totalElapsedHours?: number;
  id: string;
  wagonNumber: string; // e.g. 'NR/BOXNHL/12345'
  wagonType: string;   // e.g. 'BOXNHL', 'BCNHL', 'BOBRN'
  owningRailway: string; // e.g. 'NR', 'SECR', 'CR'
  currentStage: LifecycleStage;
  status?: 'IN_PROGRESS' | 'BLOCKED' | 'RELEASED' | 'CONDEMNED' | 'HELD' | string;
  entryDate: string;   // ISO timestamp
  releaseDate?: string | null;
  conditionNotes?: string | null;
  isReleased: boolean;
  createdAt: string;
  updatedAt: string;
}


export interface WagonRegisterRequest {
  wagonNumber: string;
  wagonType: string;
  owningRailway: string;
  entryNotes?: string;
  conditionNotes?: string;
  entryDate?: string;
}

export interface WagonTransitionRequest {
  targetStage: LifecycleStage;
  notes?: string;
  supervisorOverride?: boolean;
  overrideJustification?: string;
  otp?: string;
  otpToken?: string;
}

export interface LifecycleTransition {
  id: string;
  wagonNumber: string;
  fromStage: LifecycleStage;
  toStage: LifecycleStage;
  timestamp: string;
  userId: string;
  userName?: string;
  userRole: UserRole;
  notes?: string | null;
  isOverride: boolean;
  overrideJustification?: string | null;
  otpToken?: string | null;
  // Additional fields as actually returned by WagonRepository's transition mapping
  performedBy?: string;
  performerName?: string;
  performerRole?: string;
  overrideReason?: string | null;
  durationInStageHours?: number;
}

/** Alias — the wagon timeline API returns LifecycleTransition rows under this name */
export type WagonTransition = LifecycleTransition;

// -------------------------------------------------------------------------
// Phase 2: CASNUB Bogie Parts Checklist
// -------------------------------------------------------------------------

export type CASNUBCategory =
  | 'SPRINGS'
  | 'WHEELS_AXLES'
  | 'BEARINGS'
  | 'BRAKE_SYSTEM'
  | 'COUPLERS_DRAFT_GEAR'
  | 'BOGIE_FRAME_BOLSTER'
  | 'FRICTION_WEDGES'
  | 'BODY_UNDERFRAME';

export const CASNUB_CATEGORIES: readonly CASNUBCategory[] = [
  'SPRINGS',
  'WHEELS_AXLES',
  'BEARINGS',
  'BRAKE_SYSTEM',
  'COUPLERS_DRAFT_GEAR',
  'BOGIE_FRAME_BOLSTER',
  'FRICTION_WEDGES',
  'BODY_UNDERFRAME'
] as const;

export type PartInspectionStatus =
  // PENDING is the schema default and is checked for throughout the server
  // (exit gate, certificate, wagon summary). It was missing here, so any
  // client-side comparison against it failed to typecheck even though it is
  // the most common status a checklist item ever holds.
  | 'PENDING'
  | 'PASS'
  | 'FAIL'
  | 'CONDEMNED'
  | 'REPAIRED'
  | 'REPLACED';

export type PartCriticality =
  | 'MANDATORY'
  | 'ADVISORY';

export type RepairActionType =
  | 'REPAIRED'
  | 'REPLACED_NEW'
  | 'REPLACED_RECONDITIONED';

export interface ChecklistItem {
  id: string;
  wagonNumber: string;
  category: CASNUBCategory;
  partName: string;
  status: PartInspectionStatus;
  criticality: PartCriticality;
  isMandatory?: boolean;
  bogiePosition?: 'BOGIE_1' | 'BOGIE_2' | 'UNDERFRAME' | 'BODY' | 'NONE';
  conditionNotes?: string | null;
  repairAction?: RepairActionType | null;
  repairNotes?: string | null;
  reinspectedStatus?: PartInspectionStatus | null;
  photoId?: string | null;
  inspectedBy?: string;
  inspectedByName?: string;
  inspectedAt?: string;
  updatedAt?: string;
}

export interface ChecklistItemCreateRequest {
  category: CASNUBCategory;
  partName: string;
  status: PartInspectionStatus;
  criticality?: PartCriticality;
  conditionNotes?: string;
  photoId?: string;
}

export interface ChecklistItemUpdateRequest {
  status: PartInspectionStatus;
  repairAction?: RepairActionType;
  repairNotes?: string;
  photoId?: string;
}

export interface ChecklistCategoryGroup {
  category: CASNUBCategory;
  categoryLabelEn: string;
  categoryLabelHi: string;
  items: ChecklistItem[];
  mandatoryCount: number;
  passedCount: number;
  failedCount: number;
  condemnedCount: number;
  isComplete: boolean;
}

export interface ChecklistConfigEntry {
  wagonType: string;
  category: CASNUBCategory;
  partName: string;
  criticality: PartCriticality;
}

// -------------------------------------------------------------------------
// Phase 2: Zero-Defect Exit Gate & Release Certification
// -------------------------------------------------------------------------

export interface GateStatusResponse {
  canRelease: boolean;
  currentStage: LifecycleStage;
  blockers: string[];
  summary: {
    totalItems: number;
    totalMandatory: number;
    passedMandatory: number;
    failedMandatory: number;
    totalCondemned: number;
    unaddressedCondemned: number;
    springCheck: {
      totalSprings: number;
      passedSprings: number;
      condemnedSprings: number;
      hasCondemnedSprings: boolean;
    };
    hasSupervisorSignoff: boolean;
  };
}

export interface GateSignoffRequest {
  supervisorId: string;
  digitalSignature: string;
  otp?: string;
  otpToken?: string;
  notes?: string;
}

export interface ReleaseCertificate {
  certificateNumber: string;
  wagonNumber: string;
  wagonType: string;
  owningRailway: string;
  entryDate: string;
  releaseDate: string;
  supervisorId: string;
  supervisorName: string;
  digitalSignature: string;
  checklistSummary: {
    total: number;
    passed: number;
    repaired: number;
    replaced: number;
  };
  springSummary: {
    totalInspected: number;
    passed: number;
  };
  qrVerificationCode: string;
  generatedAt: string;
  pdfBase64?: string;
  html?: string;
}

export interface GateSignoffRecord {
  id: string;
  wagonNumber: string;
  supervisorId: string;
  supervisorName: string;
  supervisorEmployeeId?: string;
  digitalSignature: string;
  otpTokenRef?: string | null;
  signoffNotes?: string | null;
  checksSummaryJson?: string;
  certificateNumber: string;
  certificateHash: string;
  signedAt: string;
}

// -------------------------------------------------------------------------
// Phase 2: DRM Officer Analytics & Reports
// -------------------------------------------------------------------------

export interface AnalyticsPipelineResponse {
  counts: Record<LifecycleStage, number>;
  totalActive: number;
  totalReleased: number;
  timestamp: string;
}

export interface AnalyticsTATResponse {
  averageHours: number;
  medianHours: number;
  minHours: number;
  maxHours: number;
  completedWagonsCount: number;
  trends: Array<{
    period: string;
    avgHours: number;
    count: number;
  }>;
}

export interface AnalyticsThroughputResponse {
  daily: Array<{ date: string; entered: number; released: number }>;
  weekly: Array<{ week: string; entered: number; released: number }>;
  monthly: Array<{ month: string; entered: number; released: number }>;
}

export interface AnalyticsPartsResponse {
  totalInspected: number;
  totalPassed: number;
  totalFailed: number;
  totalCondemned: number;
  totalRepaired: number;
  totalReplaced: number;
  categoryBreakdown: Record<CASNUBCategory, {
    total: number;
    pass: number;
    fail: number;
    condemned: number;
    repaired: number;
    replaced: number;
  }>;
}

export interface AnalyticsInspectorsResponse {
  inspectors: Array<{
    inspectorId: string;
    inspectorName: string;
    inspectionsCompleted: number;
    partsPassed: number;
    partsFailed: number;
    partsCondemned: number;
  }>;
}

export interface AnalyticsBlockersResponse {
  blockedWagons: Array<{
    wagonNumber: string;
    wagonType: string;
    currentStage: LifecycleStage;
    blockers: string[];
    entryDate: string;
  }>;
}

// -------------------------------------------------------------------------
// Phase 2: Photo Evidence & Mobile Sync
// -------------------------------------------------------------------------

export interface PhotoRecord {
  id: string;
  wagonNumber: string;
  partCategory: CASNUBCategory;
  partName: string;
  inspectorId: string;
  inspectorName?: string;
  timestamp: string;
  imageBase64: string;
  tags: string[];
}

/** Shape actually returned by the wagon photo endpoints (WagonRepository.mapPhotoRow) */
export interface WagonPhotoRecord {
  id: string;
  wagonNumber: string;
  checklistItemId?: string | null;
  category?: CASNUBCategory | string | null;
  partCategory?: CASNUBCategory | string | null;
  partName: string;
  stage?: string | null;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  imageData?: string;
  imageBase64?: string;
  inspectorId: string;
  inspectorName?: string;
  tags: string[];
  timestamp: string;
  capturedAt?: string;
  createdAt?: string;
}

export interface PhotoUploadRequest {
  wagonNumber: string;
  partCategory: CASNUBCategory;
  partName: string;
  imageBase64: string;
  tags?: string[];
}

export interface WagonBatchSyncPayload {
  wagons?: WagonRecord[];
  transitions?: LifecycleTransition[];
  checklistItems?: ChecklistItem[];
  photos?: PhotoRecord[];
  deviceId?: string;
  syncTimestamp?: string;
}

export interface WagonBatchSyncResponse {
  success: boolean;
  syncedWagons: number;
  syncedTransitions: number;
  syncedChecklistItems: number;
  syncedPhotos: number;
  failedCount: number;
  errors?: string[];
}

// -------------------------------------------------------------------------
// Phase 3 (M1): Stores Depot Inventory & Pre-Arrival OMRS AI Triage (R5)
// -------------------------------------------------------------------------

export type ChecklistCategory = CASNUBCategory;

export type ReservationSource =
  | 'OMRS_AI_TRIAGE'
  | 'MANUAL_INSPECTION'
  | 'SUPERVISOR_ALLOCATION';

export type ReservationStatus =
  | 'RESERVED'
  | 'ALLOCATED'
  | 'ISSUED_TO_FLOOR'
  | 'CANCELLED'
  | 'RETURNED';

export type OMRSTriageSeverity =
  | 'NORMAL'
  | 'ADVISORY'
  | 'CRITICAL_TRIAGE';

export interface StoresPart {
  id: string;
  partCode: string;
  partName: string;
  category: CASNUBCategory;
  unitOfMeasure: string;
  stockQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  reorderThreshold: number;
  unitCostInr: number;
  binLocation: string;
  supplierName: string;
  updatedAt?: string;
}

export interface InventoryReservation {
  id: string;
  wagonNumber: string;
  partCode: string;
  quantity: number;
  source: ReservationSource;
  predictedDefect?: string | null;
  confidenceScore?: number | null;
  status: ReservationStatus;
  allocatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  partName?: string;
  binLocation?: string;
  category?: CASNUBCategory;
}

export interface OMRSPredictedDefect {
  component: string;
  defectType: string;
  severity: 'ADVISORY' | 'CRITICAL';
  confidence: number;
  recommendedPartCode: string;
  quantity: number;
}

export interface OMRSScanRecord {
  id: string;
  wagonNumber: string;
  scanTimestamp: string;
  location: string;
  trainSpeedKmph: number;
  wheelImpactKn?: number | null;
  acousticBearingPeakDb?: number | null;
  temperatureCelsius?: number | null;
  wheelProfileDeviationMm?: number | null;
  predictedDefects: OMRSPredictedDefect[];
  triageSeverity: OMRSTriageSeverity;
  isTriaged: boolean;
  autoReservationTriggered: boolean;
  createdAt: string;
}

export interface InventoryStats {
  totalParts: number;
  lowStockCount: number;
  totalReservedCount: number;
  totalValuationInr: number;
}

export interface AITriageResult {
  scan: OMRSScanRecord;
  reservations: InventoryReservation[];
  triageSummary: string;
}

export interface ReservePartRequest {
  wagonNumber: string;
  partCode: string;
  quantity: number;
  source?: ReservationSource;
  predictedDefect?: string;
  confidenceScore?: number;
}

export interface IssuePartRequest {
  reservationId?: string;
  partCode?: string;
  quantity?: number;
  wagonNumber?: string;
}

export interface RestockPartRequest {
  partCode: string;
  quantity: number;
}

export interface SimulateOMRSScanRequest {
  wagonNumber: string;
  trainSpeedKmph?: number;
  wheelImpactKn?: number;
  acousticBearingPeakDb?: number;
  temperatureCelsius?: number;
  wheelProfileDeviationMm?: number;
  location?: string;
  predictedDefects?: OMRSPredictedDefect[];
  triageSeverity?: OMRSTriageSeverity;
}

// -------------------------------------------------------------------------
// Phase 3 (M5): Smart Acoustic Bearing & Leak Detection (R3)
// -------------------------------------------------------------------------

export type AcousticAnomalyType = 'NONE' | 'AIR_LEAK' | 'BEARING_DEFECT';

export interface AcousticDiagnosticResult {
  timestamp: string;
  dominantFrequencyHz: number;
  peakDb: number;
  anomalyType: AcousticAnomalyType;
  confidence: number;
  details: string;
  recommendedAction?: string;
}

export interface AcousticDiagnosticRecord {
  id: string;
  wagonNumber: string;
  dominantFrequencyHz: number;
  peakDb: number;
  anomalyType: AcousticAnomalyType;
  confidence: number;
  details?: string | null;
  targetCategory?: CASNUBCategory | null;
  targetPartName?: string | null;
  checklistItemId?: string | null;
  inspectorId?: string | null;
  createdAt: string;
}

export interface AcousticDiagnoseRequest {
  wagonNumber: string;
  dominantFrequencyHz: number;
  peakDb: number;
  anomalyType: AcousticAnomalyType;
  targetCategory?: CASNUBCategory;
  targetPartName?: string;
  details?: string;
  confidence?: number;
  inspectorId?: string;
}

export interface AcousticDiagnoseResponse {
  diagnosticResult: AcousticDiagnosticResult;
  diagnosticRecord?: AcousticDiagnosticRecord;
  checklistItem?: ChecklistItem | null;
  gateBlocked: boolean;
  blockers: string[];
}

// -------------------------------------------------------------------------
// Phase 3 (M2): Component Health Passports & Serialization (R4)
// -------------------------------------------------------------------------

export type SerializedComponentType =
  | 'WHEELSET'
  | 'BEARING'
  | 'DRAFT_GEAR'
  | 'BOGIE_FRAME_BOLSTER'
  | 'BRAKE_VALVE'
  | 'COUPLER'
  | 'FRICTION_WEDGE';

export type ComponentStatus =
  | 'AVAILABLE_IN_STORES'
  | 'RESERVED'
  | 'IN_SERVICE'
  | 'UNDER_MAINTENANCE'
  | 'RECONDITIONED'
  | 'CONDEMNED';

export type ComponentHealthStatus =
  | 'EXCELLENT'
  | 'GOOD'
  | 'FAIR'
  | 'ATTENTION_REQUIRED'
  | 'CRITICAL';

export type ComponentEventType =
  | 'MANUFACTURED'
  | 'COMMISSIONED'
  | 'ASSIGNED_TO_WAGON'
  | 'REMOVED_FROM_WAGON'
  | 'INSPECTED'
  | 'MAINTENANCE_PERFORMED'
  | 'RECONDITIONED'
  | 'CONDEMNED'
  | 'RESERVED_STORES';

export interface ComponentHistoryEvent {
  id: string;
  componentId: string;
  serialNumber: string;
  eventType: ComponentEventType;
  wagonNumber?: string;
  stage?: string;
  actionDetails: string;
  performedBy: string;
  performerName: string;
  notes?: string;
  createdAt: string;
}

export interface SerializedComponent {
  id: string;
  serialNumber: string;
  componentType: SerializedComponentType;
  category: CASNUBCategory;
  partName: string;
  qrCode: string;
  rfidTag?: string;
  status: ComponentStatus;
  currentWagonNumber: string | null;
  currentBogiePosition: 'BOGIE_1' | 'BOGIE_2' | 'UNDERFRAME' | 'BODY' | 'NONE';
  manufacturingDate: string;
  manufacturer: string;
  totalKmTravelled: number;
  overhaulCount: number;
  lastPohDate?: string;
  nextPohDue?: string;
  healthScore: number;
  healthStatus: ComponentHealthStatus;
  binLocation?: string;
  history?: ComponentHistoryEvent[];
  createdAt?: string;
  updatedAt?: string;
}

export interface RegisterComponentRequest {
  serialNumber: string;
  componentType: SerializedComponentType;
  category?: CASNUBCategory;
  partName?: string;
  manufacturer?: string;
  manufacturingDate?: string;
  initialStatus?: ComponentStatus;
  rfidTag?: string;
  binLocation?: string;
  totalKmTravelled?: number;
  healthScore?: number;
  wagonNumber?: string;
  bogiePosition?: 'BOGIE_1' | 'BOGIE_2' | 'UNDERFRAME' | 'BODY' | 'NONE';
  inspectorId?: string;
  inspectorName?: string;
}

export interface AssignComponentRequest {
  wagonNumber: string;
  bogiePosition?: 'BOGIE_1' | 'BOGIE_2' | 'UNDERFRAME' | 'BODY' | 'NONE';
  stage?: string;
  notes?: string;
}

export interface UnassignComponentRequest {
  reason?: string;
  targetStatus?: ComponentStatus;
  notes?: string;
}

export interface ComponentFilter {
  componentType?: SerializedComponentType | string;
  status?: ComponentStatus | string;
  category?: CASNUBCategory | string;
  wagonNumber?: string;
  search?: string;
  healthStatus?: ComponentHealthStatus | string;
  page?: number;
  limit?: number;
  sortBy?: 'serial_number' | 'manufacturing_date' | 'health_score' | 'created_at' | 'updated_at' | string;
  sortOrder?: 'ASC' | 'DESC' | 'asc' | 'desc';
}

export interface ComponentStats {
  totalComponents: number;
  availableInStores: number;
  inService: number;
  underMaintenance: number;
  reconditioned: number;
  condemned: number;
  averageHealthScore: number;
  criticalHealthCount: number;
  typeDistribution?: Record<SerializedComponentType, number>;
  statusDistribution?: Record<ComponentStatus, number>;
}

// -------------------------------------------------------------------------
// Phase 3 (M4): Direct Computer Vision Measurement & AR Simulation (R2)
// -------------------------------------------------------------------------

export type CVComponentTarget =
  | 'OUTER_SPRING'
  | 'INNER_SPRING'
  | 'SNUBBER_SPRING'
  | 'FRICTION_WEDGE'
  // Split from FRICTION_WEDGE: WMM 2.0 §309D gives distinct wear limits per
  // surface (vertical 7mm / slope 3mm), and the checklist already has two
  // separate line items for them ("Wedge Vertical Face & Spigot Fit" /
  // "Wedge Main Slope Surface") — this wires the digital measurement to
  // match instead of sharing one ambiguous target between both.
  | 'FRICTION_WEDGE_VERTICAL'
  | 'FRICTION_WEDGE_SLOPE'
  | 'CTRB_END_CAP'
  | 'CTRB_BEARING_END_CAP'
  | 'WHEEL_FLANGE'
  | 'BRAKE_BLOCK'
  // Mark-50 Draft Gear recondition gauges (WRS Raipur shop-floor gauge boards,
  // Gauge Nos. BE/91-6x — see comments in server/src/routes/cv.ts).
  | 'DG_HOUSING_WALL_THICKNESS'
  | 'DG_CENTRE_WEDGE_LOCATION'
  | 'DG_MOVABLE_PLATE_LOCATION'
  | 'DG_OUTER_COIL_SPRING'
  | 'DG_INNER_COIL_SPRING'
  | 'DG_CORNER_COIL_SPRING'
  | 'DG_RELEASE_SPRING';

export interface SmartVisionMeasurement {
  componentType: CVComponentTarget;
  measuredValue: number;      // e.g. 258.4 mm
  nominalValue: number;       // e.g. 260.0 mm
  delta: number;              // e.g. -1.6 mm
  wireDiameter?: number;      // e.g. 30.5 mm
  status: 'PASS' | 'CONDEMNED';
  band?: BandColor | null;
  bandRoman?: string | null;
  toleranceRange: { min: number; max: number };
  confidence: number;         // 0.0 - 1.0 (e.g. 0.98)
  tableReference: string;     // e.g. 'Table 28'
  snapshotBase64?: string;    // Composite AR + video image
  timestamp: string;
  metadata?: {
    contextFilterActive?: boolean;
    noiseObjectsFilteredCount?: number;
    noiseCategoriesFiltered?: string[];
    targetComponentIsolated?: string;
    [key: string]: any;
  };
}

export interface CVMeasureRequest {
  wagonId?: string;
  wagonNumber?: string;
  componentType: CVComponentTarget | string;
  measuredValue: number;
  wireDiameter?: number;
  nominalValue?: number;
  bogieType?: BogieType;
  condition?: SpringCondition;
  bogiePosition?: 'BOGIE_1' | 'BOGIE_2' | 'UNDERFRAME' | 'BODY' | 'NONE';
  damageType?: DamageType;
  damageNotes?: string;
  imageSnapshot?: string;
  metadata?: {
    confidence?: number;
    latencyMs?: number;
    boundingBox?: { x: number; y: number; width: number; height: number };
    deviceId?: string;
    inspectorId?: string;
    inspectorName?: string;
    notes?: string;
    timestamp?: string;
    contextFilterActive?: boolean;
    noiseObjectsFilteredCount?: number;
    noiseCategoriesFiltered?: string[];
    targetComponentIsolated?: string;
    [key: string]: any;
  };
}

export interface CVMeasureResponse {
  success: boolean;
  verdict: 'PASS' | 'CONDEMNED' | 'WARNING';
  componentType: string;
  measuredValue: number;
  nominalValue: number;
  delta: number;
  toleranceRange: { min: number; max: number };
  band: BandColor | null;
  bandRoman: BandRoman | null;
  colorHex?: string;
  rdsoTable: string;
  wireDiameterCheck?: {
    measured: number;
    nominal: number;
    status: 'PASS' | 'WARNING' | 'CONDEMNED';
    message?: string;
  };
  condemnationReason?: string | null;
  auditLogId: string;
  auditHash: string;
  checklistUpdated?: boolean;
  photoRecorded?: boolean;
  timestamp: string;
  message?: string;
  metadata?: {
    contextFilterActive?: boolean;
    noiseObjectsFilteredCount?: number;
    noiseCategoriesFiltered?: string[];
    targetComponentIsolated?: string;
    [key: string]: any;
  };
}

// -------------------------------------------------------------------------
// Phase 3 (M3): Hands-Free Voice UI ("Greasy Gloves" Solution) (R1)

// -------------------------------------------------------------------------

export type VoiceLanguageCode = 'en-IN' | 'hi-IN' | 'en' | 'hi';

export type VoiceCommandIntent =
  | 'UPDATE_STATUS'
  | 'SWITCH_CATEGORY'
  | 'UNDO'
  | 'CLASSIFY_SPRING'
  | 'UNKNOWN';

export interface VoiceActionRequest {
  wagonId?: string;
  wagonNumber: string;
  inspectionId?: string | null;
  itemId?: string;
  itemName?: string;
  category?: CASNUBCategory;
  bogiePosition?: string;
  status: PartInspectionStatus;
  defectNotes?: string | null;
  repairAction?: RepairActionType | null;
  repairNotes?: string | null;
  transcript: string;
  language: VoiceLanguageCode;
  confidence?: number;
  timestamp?: string;
}

export interface VoiceActionResponse {
  success: true;
  message: string;
  messageHi: string;
  data: {
    item: ChecklistItem;
    auditLogId: string;
    actionRecorded: {
      wagonNumber: string;
      itemId: string;
      itemName: string;
      category: CASNUBCategory;
      status: PartInspectionStatus;
      defectNotes?: string | null;
      transcript: string;
      language: string;
      confidence: number;
      timestamp: string;
    };
  };
  meta: {
    timestamp: string;
    source: 'VOICE_DICTATION';
  };
}

export interface VoiceParseResult {
  matched: boolean;
  actionType: VoiceCommandIntent;
  intent?: VoiceCommandIntent;
  itemId?: string;
  itemName?: string;
  targetPartName?: string;
  targetCategory?: CASNUBCategory;
  targetItemId?: string;
  status?: PartInspectionStatus;
  defectNotes?: string;
  category?: CASNUBCategory | string;
  categoryToSwitch?: CASNUBCategory;
  feedbackMessage: string;
  feedbackMessageHi?: string;
  rawTranscript: string;
  transcript?: string;
  normalizedTranscript?: string;
  confidence?: number;
  detectedLanguage?: 'en' | 'hi' | 'mixed';
  springParams?: {
    measuredHeight?: number;
    bogieType?: BogieType;
    position?: SpringPosition;
    condition?: SpringCondition;
    isSaveCommand?: boolean;
  };
}

export interface VoiceSimulationChip {
  id: string;
  label: string;
  labelHi: string;
  phrase: string;
  intent: VoiceCommandIntent;
  category?: CASNUBCategory;
  expectedStatus?: PartInspectionStatus;
}

// -------------------------------------------------------------------------
// Navigation Tabs & Role Route Guards (Phase 3 UX Simplification)
// -------------------------------------------------------------------------

export type NavigationTab =
  | 'inspector_home'
  | 'inspection'
  | 'wagons'
  | 'dashboard'
  | 'inventory'
  | 'passports'
  | 'history'
  | 'analytics'
  | 'admin'
  | 'smart_vision'
  | 'users'
  | 'learning'
  | 'manual';

export interface AdminUserRecord {
  id: string;
  username: string;
  role: 'INSPECTOR' | 'SUPERVISOR' | 'ADMIN';
  full_name: string;
  employee_id: string;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export function isUserInspector(role?: string | null): boolean {
  return role?.toUpperCase() === 'INSPECTOR';
}

export function isUserSupervisorOrAdmin(role?: string | null): boolean {
  const r = role?.toUpperCase();
  return r === 'SUPERVISOR' || r === 'ADMIN';
}

export function canAccessTab(role: string | undefined, tab: NavigationTab, hasSelectedWagon: boolean = false): boolean {
  const roleUpper = role?.toUpperCase();
  if (roleUpper === 'INSPECTOR') {
    if (tab === 'inspector_home' || tab === 'inspection' || tab === 'smart_vision') return true;
    // The manual is for the person holding the component — inspectors included.
    if (tab === 'manual') return true;
    // An inspector can access 'wagons' ONLY when a specific wagon is active/selected (WagonDetailPage)
    if (tab === 'wagons' && hasSelectedWagon) return true;
    return false;
  }
  if (roleUpper === 'SUPERVISOR') {
    if (tab === 'dashboard' || tab === 'analytics' || tab === 'users') return false;
    // Supervisors may VIEW learning data; only admins can approve changes.
    return true;
  }
  if (roleUpper === 'ADMIN') {
    return true;
  }
  return false;
}
