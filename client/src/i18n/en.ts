/**
 * English Translation Dictionary (Phase 1 & Phase 2)
 * Indian Railways WRS Raipur
 */

export const en = {
  app: {
    title: 'Wagon Quality Control & Spring Inspection System',
    subtitle: 'Indian Railways — Wagon Repair Shop (WRS) Raipur',
    workshop: 'WRS Raipur Bogie & Wagon QC Section',
    tagline: 'RDSO G-95 Revision-II & CASNUB Standards Compliant',
    online: 'Online',
    offline: 'Offline Mode',
    syncQueue: 'Pending Sync',
    syncNow: 'Sync Now',
    syncing: 'Syncing...',
    syncedSuccess: 'Synced successfully'
  },
  nav: {
    inspection: 'Single Spring',
    wagons: 'Wagons Pipeline',
    dashboard: 'DRM Dashboard',
    inventory: 'Stores & Depot Inventory',
    passports: 'Component Passports',
    history: 'History & Logs',
    analytics: 'Spring Analytics',
    // Not a page. This entry opens the audit-trail export dialog and leaves
    // the current screen where it was — the only nav item that does not
    // navigate — so it is named for what it does rather than promising a
    // console that does not exist.
    admin: 'Export Audit Trail',
    manual: 'Ask the Manual',
    learning: 'System Learning',
    audit: 'Audit Chain',
    users: 'User Accounts',
    logout: 'Logout',
    sync: 'Sync Data',
    shiftTarget: 'Shift Target: 1,800 - 2,000'
  },
  roles: {
    Inspector: 'Inspector',
    Supervisor: 'Supervisor',
    Admin: 'Admin / DRM Officer',
    INSPECTOR: 'Inspector',
    SUPERVISOR: 'Supervisor',
    ADMIN: 'Admin / DRM Officer'
  },
  bogieTypes: {
    CASNUB_22_NLB: 'CASNUB 22 NLB / NLB(M)',
    CASNUB_22_HS: 'CASNUB 22 HS / HS(M)',
    CASNUB_22_RFT: 'CASNUB 22 RFT'
  },
  positions: {
    OUTER: 'Outer Spring',
    INNER: 'Inner Spring',
    SNUBBER: 'Snubber Spring',
    SNUBBER_OUTER: 'Snubber Outer',
    SNUBBER_INNER: 'Snubber Inner'
  },
  conditions: {
    USED: 'Used / Old Spring (6 Bands)',
    NEW: 'New Spring (3 Bands)'
  },
  bands: {
    BLUE: 'Blue Band (Band I)',
    GREEN: 'Green Band (Band II)',
    YELLOW: 'Yellow Band (Band III)',
    ORANGE: 'Orange Band (Band IV)',
    WHITE: 'White Band (Band V)',
    RED: 'Red Band (Band VI)',
    CONDEMNED: 'Condemned / Reject'
  },
  statuses: {
    PASS: 'PASS / SERVICEABLE',
    FAIL: 'FAIL / DEFECTIVE',
    CONDEMNED: 'CONDEMNED / SCRAP',
    REPAIRED: 'REPAIRED & TESTED',
    REPLACED: 'REPLACED (NEW/RECON)',
    PENDING: 'PENDING INSPECTION'
  },
  damages: {
    NONE: 'No Visible Damage',
    CRACK: 'Surface Crack / Fracture',
    CORROSION: 'Heavy Corrosion / Pitting',
    DEFORMATION: 'Permanent Set / Tilt Deformation',
    OTHER: 'Other Defect'
  },
  actions: {
    capture: 'Capture Caliper Image',
    retake: 'Retake Photo',
    manualEntry: 'Manual Height Entry',
    cameraOcr: 'Camera OCR',
    sampleImages: 'Sample Test Calipers',
    classify: 'Classify Spring',
    saveInspection: 'Save & Log Inspection',
    override: 'Supervisor Override',
    confirmOverride: 'Authorize Override',
    exportData: 'Export Audit Trail',
    requestOtp: 'Request OTP',
    verifyOtp: 'Verify OTP',
    cancel: 'Cancel',
    filter: 'Filter Logs',
    resetFilter: 'Reset Filters',
    viewDetails: 'View Details',
    exportCsv: 'Export CSV',
    exportJson: 'Export JSON',
    exportPdf: 'Export PDF Report',
    close: 'Close',
    login: 'Log In',
    registerWagon: 'Register New Wagon',
    advanceStage: 'Advance Stage',
    overrideStage: 'Supervisor Stage Override',
    viewChecklist: 'CASNUB Checklist',
    viewGate: 'Zero-Defect Exit Gate',
    signoffRelease: 'Digital Sign-off & Release',
    viewCertificate: 'Release Certificate',
    takePhoto: 'Capture Photo Evidence',
    comparePhotos: 'Compare Photos',
    printCertificate: 'Print Certificate',
    // Labels the caliper button on a checklist item. It read "Spring Batch",
    // which is the name of a different screen entirely — so a wheel gauge, a
    // brake block and a coupler all carried a button offering to sort springs.
    smartVision: 'Measure',
    openArCaliper: 'Launch Smart Vision AR',
    freezeReading: 'Freeze Reading',
    autoPopulate: 'Auto-Populate Checklist'
  },
  form: {
    wagonNumber: 'Wagon Number',
    wagonPlaceholder: 'e.g. NR/BOXNHL/12345',
    wagonType: 'Wagon Type',
    owningRailway: 'Owning Railway',
    bogieType: 'Bogie Type',
    condition: 'Spring Condition',
    position: 'Spring Position',
    measuredHeight: 'Free Height (mm)',
    damageAssessment: 'Damage & Defect Assessment',
    damageNotes: 'Inspection / Damage Notes',
    damageNotesPlaceholder: 'Enter any remarks on component physical condition...',
    overrideBand: 'Override RDSO Band',
    overrideReason: 'Override Justification (Required)',
    overrideReasonPlaceholder: 'Enter technical justification for override (min 10 characters)...',
    otpCode: '6-Digit Supervisor OTP Code',
    otpPlaceholder: 'Enter 6-digit OTP',
    entryNotes: 'Intake Condition Notes',
    entryNotesPlaceholder: 'Enter initial condition remarks on wagon intake...'
  },
  ocr: {
    title: 'Digital Caliper Display Reader',
    instruction: 'Align caliper digital LCD screen inside the guide box below and capture or upload.',
    alignGuide: 'Align Digital Display Here',
    detectedReading: 'OCR Reading',
    confidence: 'Confidence',
    latency: 'Latency',
    sampleSelector: 'Select Test Fixture Image:'
  },
  messages: {
    classificationSuccess: 'Spring successfully classified per RDSO G-95 Revision-II',
    condemnedAlert: 'WARNING: Spring is CONDEMNED. Remove immediately from bogie nest assembly.',
    overrideRequired: 'Override requires supervisor OTP authentication and mandatory justification (min 10 chars).',
    offlineSaved: 'Offline: Record saved locally. Will sync automatically when online.',
    syncSuccess: 'Sync completed: all offline records uploaded successfully.',
    invalidMeasurement: 'Please enter a valid numeric measurement between 100.00mm and 500.00mm.',
    loginSuccess: 'Login successful',
    loginFailed: 'Invalid username or password',
    exportSuccess: 'Export generated successfully',
    exportOtpRequired: 'Admin OTP verification required to download audit trail',
    wagonRegistered: 'Wagon registered successfully',
    stageAdvanced: 'Wagon advanced to next stage successfully',
    signoffSuccess: 'Wagon certified and released successfully with official certificate'
  },
  lifecycle: {
    title: '7-Stage Wagon Lifecycle Tracking',
    currentStage: 'Current Stage',
    entryDate: 'Intake Date',
    releaseDate: 'Release Date',
    tat: 'Turnaround Time (TAT)',
    stages: {
      ENTRY_REGISTRATION: '1. Entry Registration',
      DISMANTLING: '2. Dismantling',
      COMPONENT_INSPECTION: '3. Component Inspection',
      REPAIR_REPLACEMENT: '4. Repair & Replacement',
      REASSEMBLY: '5. Reassembly',
      FINAL_QC_GATE: '6. Final QC Gate',
      RELEASE: '7. Certified Release'
    },
    stageDescriptions: {
      ENTRY_REGISTRATION: 'Wagon intake, RFID/QR scan, initial defect assessment',
      DISMANTLING: 'Bogie and component stripping, subassembly cataloging',
      COMPONENT_INSPECTION: '8-category CASNUB checklist + Phase 1 spring classification',
      REPAIR_REPLACEMENT: 'Component machining, welding, and new parts fitting',
      REASSEMBLY: 'Bogie reassembly, wheelsets drop, brake rigging setup',
      FINAL_QC_GATE: 'Zero-defect blocker evaluation & supervisor digital sign-off',
      RELEASE: 'Certified release for Indian Railways mainline traffic'
    }
  },
  checklist: {
    title: 'CASNUB Bogie Parts Quality Checklist',
    mandatory: 'MANDATORY',
    advisory: 'ADVISORY',
    safetyCritical: 'Safety Critical Part',
    springSyncNotice: 'Auto-synchronized with Phase 1 Spring Classification records',
    categories: {
      SPRINGS: '1. Springs (Outer, Inner, Snubber)',
      WHEELS_AXLES: '2. Wheels & Axles',
      BEARINGS: '3. Bearings (CTRB & Adapters)',
      BRAKE_SYSTEM: '4. Brake System & Rigging',
      COUPLERS_DRAFT_GEAR: '5. Couplers & Draft Gear (CBC)',
      BOGIE_FRAME_BOLSTER: '6. Bogie Frame & Bolster',
      FRICTION_WEDGES: '7. Friction Wedges',
      BODY_UNDERFRAME: '8. Body & Underframe'
    }
  },
  exitGate: {
    title: 'Zero-Defect Exit Gate & Release Certification',
    clearanceStatus: 'Clearance Status',
    readyForRelease: 'Ready for Certified Release',
    blocked: 'Release Blocked by Quality Discrepancies',
    rule1: '1. All Mandatory Components Inspected & Passed',
    rule2: '2. Zero Unaddressed Condemned Components',
    rule3: '3. Phase 1 Spring Nest Clearance (0 Condemned)',
    rule4: '4. Stage 6 (FINAL_QC_GATE) Prerequisite',
    activeBlockers: 'Active Blockers Breakdown',
    digitalSignoffTitle: 'Supervisor Digital Sign-off & Cryptographic Certification',
    signAndReleaseBtn: 'Authorize Digital Sign-off & Issue Certificate'
  },
  photos: {
    title: 'Photo Evidence & QC Gallery',
    takePhoto: 'Take Photo',
    smartVisionScan: 'Smart Vision AR Scan',
    filterCategory: 'Filter by Subsystem',
    allCategories: 'All Categories',
    beforeAfter: 'Before / After Comparison',
    zoomPan: 'Pinch/Click to Zoom & Inspect',
    watermarkNotice: 'All photos automatically watermarked with WRS Raipur QC stamp, wagon number, inspector, and timestamp.'
  },
  smartVision: {
    title: 'Smart Vision AR Caliper',
    subtitle: 'Real-Time Computer Vision & AR Tolerance Gauge',
    targetComponent: 'Target Component',
    selectComponent: 'Select Component Target',
    trackingComponent: 'TRACKING COMPONENT...',
    targetLocked: 'TARGET LOCKED',
    confidence: 'Confidence',
    freezeReading: 'Freeze & Use Reading',
    unfreezeReading: 'Unfreeze / Live Stream',
    captureSnapshot: 'Capture AR Snapshot',
    saveAndPopulate: 'Save & Auto-Populate Checklist',
    measuredHeight: 'Measured Free Height',
    nominalHeight: 'Nominal Height',
    delta: 'Deviation (Delta Δ)',
    wireDiameter: 'Wire Diameter (Ø)',
    toleranceBand: 'RDSO Tolerance Band',
    withinTolerance: 'WITHIN RDSO TOLERANCE',
    outOfTolerance: 'OUT OF TOLERANCE — CONDEMNED',
    passVerdict: 'PASS / SERVICEABLE',
    condemnVerdict: 'CONDEMNED / SCRAP',
    tableReference: 'RDSO Reference Table',
    simulatedNotice: 'Hardware camera simulated. Running animated test pattern.',
    autoPopulatedSuccess: 'Measurement successfully auto-populated into checklist & photo gallery.',
    targets: {
      OUTER_SPRING: 'Outer Spring (Free Height)',
      INNER_SPRING: 'Inner Spring (Free Height)',
      SNUBBER_SPRING: 'Snubber Spring (Free Height)',
      FRICTION_WEDGE: 'Friction Wedge (Wear Profile)',
      CTRB_END_CAP: 'CTRB End Cap (Diameter & Screws)'
    }
  },
  dashboard: {
    title: 'DRM Officer Management Dashboard & Analytics',
    pipelineTitle: '7-Stage Workshop Pipeline Load',
    tatTitle: 'Turnaround Time (TAT) Analytics',
    throughputTitle: 'Workshop Monthly Throughput & Outturn',
    partsTitle: 'CASNUB Parts Defect & Pareto Breakdown',
    inspectorsTitle: 'Inspector Productivity & Quality Performance',
    blockersTitle: 'Active QC Blockers & Bottlenecks',
    meanTat: 'Mean TAT',
    medianTat: 'Median TAT',
    p90Tat: '90th Percentile TAT',
    activeInShop: 'Active in Workshop',
    releasedThisMonth: 'Released This Month'
  },
  analytics: {
    shiftThroughput: 'Shift Throughput & Outturn',
    target: 'Target: 1,800 - 2,000 springs/shift',
    passed: 'Passed / Serviceable',
    condemned: 'Condemned / Reject',
    condemnRate: 'Condemnation Rate',
    bandDistribution: 'RDSO Color Band Distribution'
  },
  charts: {
    tatTrend: '30-Day Turnaround Time (TAT) Trend',
    partsDistribution: 'CASNUB Parts Health Distribution',
    dailyThroughput: 'Daily Wagon Throughput (Last 30 Days)',
    springBands: 'Spring Band Distribution (RDSO G-95)',
    days30: 'Last 30 Days',
    entered: 'Wagons Entered',
    released: 'Wagons Released',
    avgTatHours: 'Average TAT (Hours)',
    passed: 'Passed',
    condemned: 'Condemned',
    repaired: 'Repaired',
    replaced: 'Replaced',
    totalInspected: 'Total Inspected',
    wagonsCount: 'Wagons Count'
  },
  /*
   * The roi block is gone.
   *
   * It held "+122% Throughput Gain", "2.2x Speed Acceleration", "99.8% RDSO
   * G-95 Compliance" and "Manual: 900 springs/day → With AI: 2,000+
   * springs/day". Every one was a hardcoded string, on the DRM's own
   * dashboard. Nothing measured them, there is no AI classifying springs,
   * and the shop's own SSE puts the daily pile at 700 rather than the 900
   * the percentage was computed against.
   *
   * The dashboard shows what can be measured instead, with its source.
   */

  // Was "AI-Powered Quality Control for Indian Railways". The system's real
  // strength is deterministic RDSO classification against a cited clause and
  // a record that cannot be altered — not AI, which currently classifies
  // nothing. The first screen should claim what the last screen can defend.
  loginTagline: 'RDSO G-95 Classification & Zero-Defect Release Control',
  inventory: {
    title: 'Stores Depot Inventory & Material Management',
    subtitle: 'WRS Raipur CASNUB Parts Stock, Auto-Reservations & Shop Floor Issuing',
    totalParts: 'Total Catalog Parts',
    lowStock: 'Low Stock Alerts',
    activeReservations: 'Active Reservations',
    totalValuation: 'Depot Stock Valuation',
    searchPlaceholder: 'Search part code, name, bin...',
    allCategories: 'All Categories',
    partCode: 'Part Code',
    partName: 'Part Name',
    category: 'Category',
    stockLevel: 'Stock / Reserved / Available',
    unitCost: 'Unit Cost (₹)',
    binLocation: 'Bin Location',
    supplier: 'Supplier / Source Depot',
    status: 'Stock Status',
    actions: 'Actions',
    inStock: 'In Stock',
    lowStockBadge: 'Low Stock',
    criticalStock: 'Critical',
    issueBtn: 'Issue to Floor',
    restockBtn: 'Restock Depot',
    restockTitle: 'Restock Material Inventory',
    restockQuantity: 'Restock Quantity',
    restockConfirm: 'Confirm Restock',
    issueTitle: 'Issue Part to Shop Floor',
    issueQuantity: 'Quantity to Issue',
    issueConfirm: 'Confirm Issue',
    reservationsTab: 'Active Reservations & Pre-Arrival Allocations',
    partsTab: 'Stores Catalog & Stock Levels',
    wagonNumber: 'Wagon Number',
    source: 'Reservation Source',
    predictedDefect: 'Predicted Defect / Reason',
    confidence: 'AI Confidence',
    resStatus: 'Status',
    allocatedAt: 'Issued / Allocated At',
    noReservations: 'No active inventory reservations found.',
    omrsTriageBadge: 'OMRS AI Triage',
    manualBadge: 'Manual Allocation',
    issuedBadge: 'Issued to Floor',
    reservedBadge: 'Reserved'
  },
  omrs: {
    title: 'Pre-Arrival Trackside OMRS Telemetry & AI Triage',
    subtitle: 'Acoustic Bearing, WILD Wheel Impact & Hot Axle Pre-Intake Anomaly Diagnostics',
    wildImpact: 'WILD Wheel Impact',
    abdAcoustic: 'ABD Acoustic Peak',
    habdTemp: 'HABD Axle Temperature',
    profileDeviation: 'Wheel Profile Deviation',
    trainSpeed: 'Train Speed',
    scanLocation: 'Array Location',
    triageStatus: 'AI Triage Status',
    criticalTriage: 'Critical Defect Detected',
    advisoryTriage: 'Advisory Warning',
    normalTriage: 'Normal / Zero Defect',
    runTriageBtn: 'Run AI Triage & Auto-Reserve Parts',
    triagedBadge: 'Pre-Arrival Triaged',
    notTriagedBadge: 'Pending AI Triage',
    predictedDefectsTitle: 'AI Predicted Failing Components & Automatic Stores Reservations',
    autoReservedParts: 'Auto-Reserved Material in Stores Depot',
    scanTimestamp: 'Scan Timestamp',
    simulateScan: 'Simulate Trackside Scan',
    noScanData: 'No trackside OMRS telemetry recorded for this wagon yet.'
  },
  acoustic: {
    title: 'Smart Acoustic Bearing & Pneumatic Leak Detection',
    subtitle: 'Real-Time Web Audio FFT Spectrum & Oscilloscope Waveform Analysis',
    liveAnalysis: 'Live Microphone Diagnostic',
    startMic: 'Start Live Microphone',
    stopAnalysis: 'Stop Analysis',
    dominantFreq: 'Peak Dominant Frequency',
    splGauge: 'Sound Pressure Level (SPL)',
    statusNominal: 'CLEAR / NOMINAL — Zero Acoustic Anomalies',
    statusAirLeak: 'WARNING: AIR LEAK DETECTED (>4.5 kHz High-Frequency Hiss)',
    statusBearingDefect: 'CRITICAL: CTRB BEARING DEFECT (1.2 kHz Periodic Knock / Spall)',
    simTitle: 'Acoustic Signal Simulation Presets',
    simAirLeak: 'Simulate Air Leak Hiss (6.5 kHz)',
    simBearingKnock: 'Simulate Bearing Knock (1.2 kHz)',
    simNormalSound: 'Simulate Normal Workshop Ambient',
    simMic: 'Microphone Live Feed',
    logDefectBtn: 'Log Defect to Exit Gate Blockers',
    loggingDefect: 'Logging Defect...',
    defectLoggedSuccess: 'Acoustic defect recorded and active gate blockers updated successfully!',
    diagnosticDetails: 'Diagnostic Telemetry & DSP Spectrum Details',
    crestFactor: 'Waveform Crest Factor',
    highFreqRatio: 'High-Frequency Power Ratio (>4.5 kHz)',
    confidence: 'AI Detection Confidence',
    recommendedAction: 'Recommended Remedial Action',
    equalizerTitle: '32-Band Real-Time FFT Frequency Equalizer',
    oscilloscopeTitle: 'Real-Time Oscilloscope Waveform',
    targetComponent: 'Target Component',
    targetCategory: 'Target Subsystem',
    autoTargeted: 'Auto-Targeted Subsystem',
    targetBrake: 'Brake System (Air Hose & Angle Cocks)',
    targetBearings: 'Bearings (CTRB Cartridge Bearing)',
    defectLoggedNotice: 'Defect logged will set checklist item to FAIL and immediately block Stage 7 Certified Release.'
  },
  voice: {
    title: 'Hands-Free Voice Inspection',
    badge: 'Greasy-Gloves Mode',
    start: 'Start Voice Inspection',
    stop: 'Stop Voice Inspection',
    listening: 'Listening continuously for component & status...',
    listeningPill: 'Listening for speech input...',
    noSpeechYet: 'No voice command spoken yet. Press microphone or click simulation chips.',
    tryCommand: 'Speak: "Outer spring passes", "Condemn friction wedge", "Undo"',
    helpBtn: 'Guide',
    simulation: {
      title: 'Quick Voice Simulation Chips:'
    },
    help: {
      title: 'Hands-Free Voice Command Reference'
    }
  }
};


