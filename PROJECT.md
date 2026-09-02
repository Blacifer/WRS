# Project: WRS Raipur Wagon Quality Control Application (Phase 3: The Holy Grail)

## Architecture
The application is a full-stack, offline-first PWA for Indian Railways Wagon Repair Shop (WRS) Raipur:
- **Frontend**: React 18, TypeScript, Tailwind CSS, Vite, Canvas 2D AR HUD renderer, Web Audio API DSP engine, Web Speech API bilingual parser, IndexedDB offline sync.
- **Backend**: Node.js 22, Express-compatible modular router, SQLite (`DatabaseSync`) with WAL mode, foreign keys, and strict append-only triggers.
- **Hardware Simulation Layer**: Standard Web APIs simulate industrial hardware (webcam for AR vision & QR, microphone for acoustic FFT & voice recognition, simulated OMRS sensor streams).
- **Security & Integrity**: JWT authentication, Role-Based Access Control (`INSPECTOR`, `SUPERVISOR`, `DRM`, `ADMIN`), OTP verification, immutable audit logs.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | R1: Hands-Free Voice UI ("Greasy Gloves") | Web Speech API bilingual (En/Hi) speech recognition for CASNUB checklist items, live visual ring feedback, audio cues, and audit logging | M3 | ORIGINAL_REQUEST §R1 |
| F2 | R2: Direct Computer Vision Measurement (AR) | Live webcam Canvas 2D 60 FPS AR HUD, bounding boxes, dynamic AR calipers, RDSO tolerance badges, watermarked snapshots, `/api/cv/measure` | M3 | ORIGINAL_REQUEST §R2 |
| F3 | R3: Smart Acoustic Bearing & Leak Detection | Web Audio API 32-band FFT equalizer & oscilloscope, continuous hiss (>4kHz) air leak and harmonic bearing knock detection, Final QC Gate blocker | M3 | ORIGINAL_REQUEST §R3 |
| F4 | R4: Component Health Passports (Backend/DB) | Serialized components DDL (`components`, `component_history`), append-only triggers, component repository, `/api/components` REST endpoints, certificate manifest | M1 | ORIGINAL_REQUEST §R4 |
| F5 | R4: Component Health Passports (Frontend UI) | `ComponentPassportsPage`, `PassportQRScannerModal`, wagon assignment drawer, navigation routing, and certificate embedding | M2 | ORIGINAL_REQUEST §R4 |
| F6 | R5: Pre-Arrival AI Triage & Stores Inventory | Trackside OMRS telemetry ingestion, AI defect predictions, auto-reservations in Stores Depot Inventory, stock decrement on issuance | M3 | ORIGINAL_REQUEST §R5 |
| F7 | Test Harness Search Filter Bug Fix | Fix `tests/harness/audit_db.ts:814` search filter to ensure 100% baseline pass rate across all existing Phase 1 & 2 tests | M1 | Survey Finding |
| F8 | E2E Testing Suite (Tiers 1-4) | Comprehensive opaque-box test suites covering all 5 features across Category-Partition, BVA, Pairwise Combinatorial, and Workshop Workload scenarios | M4 | ORIGINAL_REQUEST §Acceptance Criteria |
| F9 | Adversarial Coverage Hardening (Tier 5) | White-box stress testing, tamper resistance, SQLite trigger immutability, and forensic integrity audit | M5 | Integrity Forensics |

## Milestones

All five milestones are delivered and in the build. This table is kept as the
record of how the work was broken up, not as a plan of outstanding work — see
`README.md` for what the system does now, and `docs/` for how to run it.

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | R4 Component Health Passports (Backend/DB) & Harness Fix | Schema DDL, append-only triggers, `componentRepository.ts`, `/api/components` router, seed data, certificate manifest, and `audit_db.ts` search fix | none | DELIVERED |
| M2 | R4 Component Health Passports (Frontend UI) | `ComponentPassportsPage.tsx`, `PassportQRScannerModal.tsx`, wagon assignment UI in `WagonDetailPage.tsx`, header navigation | M1 | DELIVERED |
| M3 | R1-R5 Full Feature Integration & Polish | Verification of Voice UI, CV AR Vision, Acoustic Diagnostics, Passports, and OMRS Stores Inventory across all 7 stages | M2 | DELIVERED |
| M4 | E2E Test Suite 100% Pass (Tiers 1-4) | Requirement-driven opaque-box testing across all 5 features (Tiers 1 to 4) with 100% passing tests | M3 | DELIVERED |
| M5 | Adversarial Hardening (Tier 5) & Victory Audit | White-box adversarial testing, forensic integrity audit verification, zero-regression certification | M4 | DELIVERED |

## Interface Contracts
### Client ↔ Server: `/api/components`
- `GET /api/components`: returns `{ success: true, data: SerializedComponent[], pagination: { total, page, limit, pages } }`
- `GET /api/components/:serialNumber`: returns `{ success: true, data: SerializedComponent & { history: ComponentHistoryEvent[] } }`
- `GET /api/components/qr/:qrCode`: returns `{ success: true, data: SerializedComponent }`
- `GET /api/components/wagon/:wagonNumber`: returns `{ success: true, data: SerializedComponent[] }`
- `POST /api/components/register`: body `{ serialNumber, componentType, category, partName, manufacturer, manufacturingDate, initialStatus?, rfidTag?, binLocation? }` -> returns `{ success: true, data: SerializedComponent }`
- `POST /api/components/:serialNumber/assign`: body `{ wagonNumber, bogiePosition, stage?, notes? }` -> returns `{ success: true, data: SerializedComponent }`
- `POST /api/components/:serialNumber/unassign`: body `{ reason?, targetStatus?, notes? }` -> returns `{ success: true, data: SerializedComponent }`

### Client ↔ Server: `/api/checklist/voice-action`
- `POST /api/checklist/voice-action`: body `{ wagonNumber, itemId?, itemName?, category?, bogiePosition?, status, defectNotes?, repairAction?, repairNotes?, transcript, language, confidence }` -> returns `{ success: true, data: { item, auditLogId, actionRecorded } }`

### Client ↔ Server: `/api/cv/measure`
- `POST /api/cv/measure`: body `{ wagonId?, wagonNumber?, componentType, measuredValue, wireDiameter?, nominalValue?, bogieType?, condition?, bogiePosition?, damageType?, damageNotes?, imageSnapshot?, metadata? }` -> returns `{ success: true, verdict, componentType, measuredValue, delta, toleranceRange, band, bandRoman, colorHex, rdsoTable, wireDiameterCheck?, condemnationReason?, auditLogId, auditHash, checklistUpdated, photoRecorded, timestamp }`

> **Known defect (2 Sep 2026):** `checklistUpdated` is always returned as
> `false`. In `server/src/routes/cv.ts` the guard reads
> `getChecklistItems(wagonNumber, category)` and then tests `catItems.length`,
> but that method takes one argument and returns `{ categories, allItems }` —
> an object with no `length` — so the branch never runs and an AR-caliper
> reading is never written to the checklist. Verified against a live wagon
> holding 6 SPRINGS items.

### Client ↔ Server: `/api/acoustic/diagnose`
- `POST /api/acoustic/diagnose`: body `{ wagonNumber, dominantFrequencyHz, peakDb, anomalyType, confidence?, details?, targetCategory?, targetPartName?, inspectorId? }` -> returns `{ success: true, data: { diagnosticResult, diagnosticRecord, checklistItem, gateBlocked, blockers } }`

### Client ↔ Server: `/api/inventory`

There is no `/api/omrs` router. An earlier draft of this file specified
`POST /api/omrs/triage/:wagonNumber`; no such route is mounted in
`server/src/routes/index.ts` and no client code calls one. OMRS remains as
schema, seed and audit vocabulary only. Do not treat the triage endpoint as an
available contract.

- `GET /api/inventory`: returns `{ success: true, data: StoresPart[] }`
- `GET /api/inventory/stats`
- `GET /api/inventory/reservations`
- `GET /api/inventory/part/:partCode`
- `POST /api/inventory/reserve`: body `{ wagonNumber, partCode, quantity, source?, predictedDefect?, confidenceScore? }` -> returns `{ success: true, data: InventoryReservation }`
- `POST /api/inventory/issue`
- `POST /api/inventory/restock` (requires the `stores.manage` capability)

## Code Layout
- `client/src/` — React 18 UI components, pages, hooks, services, and utilities.
- `server/src/` — Express backend runtime, routes, controllers, repository layers, SQLite schemas.
- `shared/types.ts` — Single source of truth for TypeScript data models, enums, and API payloads.
- `tests/` — Test suites, runners, fixtures, and hardware simulation harnesses.
