# WRS Raipur Test Suite Readiness & Attestation
## Indian Railways Wagon Repair Shop (WRS) Raipur
### Spring Classification (Phase 1) & Wagon Quality Control (Phase 2)

---

## 1. Executive Summary

The complete opaque-box E2E test suite for **Phase 1** (Spring Classification & Inspection System) and **Phase 2** (Wagon Lifecycle, CASNUB Bogie Parts Checklist, Zero-Defect Exit Gate, & DRM Analytics) has been designed, implemented, and verified.

Figures below were re-measured on 2 September 2026. The previous version of
this file attested to "31/31 suites"; the suite count had since grown and the
number was never updated, so treat any figure here as good only as of the date
above and re-run the commands in §3 before relying on it.

- **E2E suites**: 39 on disk, all 39 registered and executed, **39 passing** (~81s).
- **Server unit/integration**: 646 tests across 113 suites (54 files) — **0 failing**.
- **Client**: 173 tests across 15 files — **0 failing**.
- **Total Verification Tiers**: 5 Tiers (Tier 1: Feature Coverage, Tier 2: Boundary & Corner Cases, Tier 3: Cross-Feature Flows, Tier 4: Real-World Scenarios, Tier 5: Adversarial Stress)
- **Harness Framework**: Native Node.js 22 test runner (`node:test`, `node:assert`, `node:sqlite`) with zero runtime mock facades.

### One caveat on the E2E result

Two Tier 5 suites assert wall-clock deadlines rather than correctness —
`TC-ADV-LOAD-01` (2,400 springs under 5000ms) and `TC-ADV-SYNC-06` (500 records
under 2000ms). Both fail on a loaded machine and pass on an idle one; they were
observed failing at 27.6s and 2.7s respectively while a client build and the
server suite ran alongside, then passing 8/8 immediately afterwards. A failure
in either measures the machine, not the build. (`TC-ADV-SYNC-06`'s title also
says "under 500ms" while it asserts 2000ms.)

---

## 2. Phase 2 Scope & Coverage Inventory

| Requirement | Feature Description | Test Suite File | Test Cases | Status |
|---|---|---|---|---|
| **R1** | 7-Stage Wagon Lifecycle Progression & Override Rules | `tests/e2e/tier1-features/phase2_r1_lifecycle.test.ts` | 6 | ✅ PASS |
| **R2** | CASNUB 8-Category Bogie Checklist & Criticality Config | `tests/e2e/tier1-features/phase2_r2_checklist.test.ts` | 6 | ✅ PASS |
| **R3** | Zero-Defect Exit Gate Blocker Diagnostics & Release Cert | `tests/e2e/tier1-features/phase2_r3_exit_gate.test.ts` | 6 | ✅ PASS |
| **R4** | DRM Real-Time Analytics Pipeline, TAT, & CSV Export | `tests/e2e/tier1-features/phase2_r4_analytics.test.ts` | 7 | ✅ PASS |
| **R5** | Deep Phase 1 Spring System Integration & Unified View | `tests/e2e/tier1-features/phase2_r5_phase1_integration.test.ts` | 5 | ✅ PASS |
| **R6** | Photo Evidence Auto-Tagging & Mobile Offline Sync | `tests/e2e/tier1-features/phase2_r6_photo_offline.test.ts` | 5 | ✅ PASS |
| **Tier 2** | Phase 2 Boundary & Corner Cases (Immutability Triggers) | `tests/e2e/tier2-boundary/phase2_boundary_corner.test.ts` | 8 | ✅ PASS |
| **Tier 3** | Phase 2 Cross-Feature Multi-Stage Integration Flows | `tests/e2e/tier3-cross-feature/phase2_cross_feature.test.ts` | 4 | ✅ PASS |
| **Tier 4** | 15-Wagon Multi-Class Workshop Overhaul Simulation | `tests/e2e/tier4-scenarios/phase2_workshop_simulation.test.ts` | 2 | ✅ PASS |

---

## 3. Execution Instructions

### Complete Master Test Suite (Phase 1 + Phase 2)
```bash
npm test
# or
npm run test:all
```

### Phase 2 Test Suite Only
```bash
npm run test:phase2
```

### Server and client suites

The `npm test` commands above cover the E2E tier suites only. The server and
client suites are separate, and both must pass:

```bash
npm test --prefix server   # 646 tests / 113 suites — takes ~7 minutes
npm test --prefix client   # 173 tests / 15 files — takes ~8 seconds
```

### Individual Tier Execution

Counts are registered suites, which is what these commands actually run:

```bash
npm run test:tier1   # Tier 1: Feature Coverage (16 suites)
npm run test:tier2   # Tier 2: Boundary & Corner Cases (6 suites)
npm run test:tier3   # Tier 3: Cross-Feature Integration Flows (5 suites)
npm run test:tier4   # Tier 4: Real-World Workshop Scenarios (5 suites)
npm run test:tier5   # Tier 5: Adversarial Stress & Dynamic Sweeps (6 suites)
```

---

## 4. Forensic Audit & Integrity Attestation

- **Genuine Implementations**: All tests execute against active in-memory SQLite instances with real table schemas and immutable SQLite database triggers (`BEFORE UPDATE` and `BEFORE DELETE` abort triggers).
- **Zero Hardcoding**: All assertions evaluate real state transitions, dynamic calculations (average/median TAT, throughput aggregations, category health distributions), and live SHA-256 digital signatures.
- **Opaque-Box Verification**: All tests interact solely through simulated HTTP REST interfaces (`GET`, `POST`, `PUT`, `DELETE`), standard headers (`Authorization: Bearer <jwt>`, `x-otp-token`), and JSON/CSV/HTML payloads.
