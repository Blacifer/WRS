# E2E Test Infra: WRS Raipur Wagon Quality Control Application (Phase 3)

## Test Philosophy
- Opaque-box, requirement-driven testing covering all 5 Phase 3 features and existing Phase 1 & 2 lifecycles.
- Hardware-simulated Web APIs (Web Speech, Web Audio, MediaDevices Canvas AR, QR scanning) tested with 100% deterministic assertion coverage.
- Zero-tolerance integrity enforcement: no mocks bypassing business rules, strict SQLite trigger validation.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise Combinatorial + Real-World Workshop Workloads.

## Feature Inventory
| # | Feature | Source (Requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | R1: Hands-Free Voice UI ("Greasy Gloves") | ORIGINAL_REQUEST §R1 | ≥5 | ≥5 | ✓ |
| 2 | R2: Direct CV Measurement (AR Simulation) | ORIGINAL_REQUEST §R2 | ≥5 | ≥5 | ✓ |
| 3 | R3: Smart Acoustic Bearing & Leak Detection | ORIGINAL_REQUEST §R3 | ≥5 | ≥5 | ✓ |
| 4 | R4: Component Health Passports (Serialization) | ORIGINAL_REQUEST §R4 | ≥5 | ≥5 | ✓ |
| 5 | R5: Pre-Arrival AI Triage & Stores Inventory | ORIGINAL_REQUEST §R5 | ≥5 | ≥5 | ✓ |

## Test Architecture
- **Master Test Runner**: `tests/runner.ts` / `tests/run_e2e.sh`
- **Backend Unit/Integration**: `npm test --prefix server` (Node.js 22 native test runner)
- **Frontend**: `npm test --prefix client` (Vitest)
- **Directory Layout** (as on disk — earlier drafts of this file named three of
  these directories incorrectly, so check here rather than guessing):
  - `tests/e2e/tier1-features/` — Tier 1 Feature functional tests (16 suites)
  - `tests/e2e/tier2-boundary/` — Tier 2 Boundary & edge case tests (6 suites)
  - `tests/e2e/tier3-cross-feature/` — Tier 3 Cross-feature integration flows (5 suites)
  - `tests/e2e/tier4-scenarios/` — Tier 4 Full workshop multi-bay shift simulations (5 suites)
  - `tests/e2e/tier5-adversarial/` — Tier 5 Adversarial stress & security penetration tests (7 suites)

  39 suites in total, all registered and executed.
  - `tests/harness/` — Hardware simulation layer (`speech_mock.ts`, `audio_mock.ts`, `camera_mock.ts`, `qr_mock.ts`, `audit_db.ts`, `test_app.ts`)

## Adding a suite — read this before writing one

`tests/runner.ts` does **not** discover suites from the filesystem. It runs a
hardcoded `SUITES` list, so **register a new file in `tests/runner.ts` in the
same commit that creates it**.

Forgetting used to be silent, and that is the worst failure mode a test runner
has: `phase3_challenger2_concurrency_immutability.test.ts` sat on disk passing
12/12 while the runner printed `✅ ALL TESTS PASSED` over the other 38 and
never opened it. It is registered now, and `assertNoUnregisteredSuites()` runs
before any suite does — a `.test.ts` under `tests/e2e/` that belongs to no tier
is a hard error (exit 1) naming the file, rather than a pass over work nobody
checked.

Note also that the runner's per-test counters are not wired up: the summary
always reports `Total Test Cases: 0`. Suite pass/fail is accurate; the test
case numbers in that block are not.

## Coverage Thresholds
- **Tier 1**: ≥5 test cases per feature (5 × 5 = 25+ cases)
- **Tier 2**: ≥5 boundary/corner test cases per feature (25+ cases)
- **Tier 3**: Pairwise combinatorial coverage across all feature interactions (10+ scenarios)
- **Tier 4**: ≥5 realistic multi-bay workshop application scenarios
- **Tier 5**: Adversarial stress & forensic integrity hardening
- **Target Total**: 100% Pass Rate across all suites with 0 regressions.
