# Indian Railways — WRS Raipur Spring Classification & Wagon QC System

> **A Full-Stack, Offline-First Industrial PWA & API Platform for Wagon Quality Control & RDSO G-95 Revision-II Compliance.**

---

## 🚂 System Overview

The **WRS Raipur Quality Control Platform** is an enterprise-grade web application built for the **Indian Railways Wagon Repair Shop (WRS), Raipur**. It digitizes and automates the complete wagon inspection, spring classification, component lifecycle tracking, and zero-defect exit gate verification workflows.

### Key Capabilities

1. **Spring classification — RDSO G-95 Rev-II**
   - Deterministic band classification for CASNUB 22 NLB / HS / RFT springs, verified value-by-value against the printed tables.
   - **Band-first entry**: inspectors check the spring against the strip and tap the band, as RDSO's "Grouping of Springs (By strip method)" describes. One tap, no typing.
   - **Bulk sorting** of dismantled springs with no wagon number, which is the ~900/day work — with per-band tallies and, more usefully, how many *complete matched nests* the stock can supply.
   - **Set-level checks** a person cannot perform by eye: nest free-height variation, band mixing, and new/old mixing.

2. **Wagon type registry (WMM 2.0 Tables 1.1–1.3)**
   - 33 wagon designations — BOXN, BOSTHS M1/M2, BOXNLW, BRN, BCNA and others — each carrying its bogie, axle load and spring configuration from the manual.
   - Pick the wagon and the spring count follows. BOSTHS M1 is 64 springs a wagon; M2 is 56.

3. **Full lifecycle stage progression (7 stages)**, from inward yard entry to exit gate certification, with every transition timestamped and dwell time tracked.

4. **Zero-defect exit gate**
   - Server-enforced. A wagon does not leave with a mandatory component unaddressed, a condemned spring, an incomplete spring sweep, a failed air brake test, or bearings at mismatched overhaul cycles.
   - Advisory findings do not block, but must be **acknowledged by name** at sign-off and are recorded inside the signed certificate.

5. **Single Wagon Test — air brake (WMM 2.0 §720-C)**
   - The full sixteen-row proforma with published limits, including piston stroke keyed per wagon type from §308B and separate single/twin pipe limits.
   - A blank row is not a pass; neither is a row with no published limit.

6. **Component passports & CTRB overhaul-cycle matching**
   - QR/RFID traceability for wheelsets, bearings, draft gear and couplers.
   - Enforces WMM 2.0 Chapter 6 clause (f): every bearing under one wagon must share its overhaul cycle — the rule currently kept in yellow paint on end cap screws and verified by sample check.

7. **Tamper-evident record**
   - SHA-256 hash chain across every event, with database-level append-only triggers.
   - The **Audit Chain** screen (supervisor and above), or `GET /api/audit/verify`, re-derives the whole chain and names the first altered entry. A changed *role* breaks it, not just changed data. The screen also states what a pass does *not* prove: that no record was altered after it was written is not the same as every measurement having been correct.
   - Release certificates carry a keyed HMAC over their own contents and can be re-verified from the stored record.

8. **Built for the shop floor**
   - Offline-first PWA with an IndexedDB queue; work continues without a network and syncs without duplicating.
   - Bilingual throughout (English / Hindi).
   - Hands-free voice checklist entry, and acoustic bearing/leak diagnostics using real Web Audio FFT.
   - Full-text search over the RDSO manual (2,341 passages, 659 pages) with real citations.

### What it deliberately does not do

Stated plainly, because a system used for safety decisions should be clear about its own limits:

- **It does not identify a spring, or a wagon, from a photograph.** Free height cannot be recovered from an image without a scale. The spring queue and the wagon number are entered, not detected.
- **It does not detect cracks or corrosion automatically.** Visible defects are recorded by the inspector, with a mandatory photograph as evidence.
- **It does not invent limits.** Where the manual publishes no figure — the CTRB end-cap gap, the RFT spring count — the app measures and records but returns no verdict, and says why.
- **The supervisor OTP is not a second factor.** With no SMS gateway integrated, the code is returned in the API response. It is an audited two-step confirmation; `OTP_DELIVERY` makes that posture explicit rather than implied.

## 🛠️ Architecture & Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Vite, HTML5 Canvas 2D AR HUD, Web Audio API DSP, Web Speech API, IndexedDB offline store.
- **Backend**: Node.js 22, Express REST API router, Node native SQLite (`DatabaseSync`) with WAL mode, foreign keys, and cryptographic audit log triggers.
- **Testing**: 41 comprehensive E2E test suites with 260 automated test cases (Boundary Value Analysis, Combinatorial, High-Load multi-shift simulation, and adversarial integrity tests).

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `v22.0.0` or higher
- **NPM**: `v10.0.0` or higher
- **Git**

### Installation

Clone the repository and install all root and sub-package dependencies:

```bash
# Clone repository
git clone git@github.com:Blacifer/WRS.git
cd WRS

# Install all dependencies (root, server, and client)
npm install
npm install --prefix server
npm install --prefix client
```

### Database Seeding

Seed the SQLite database with rich demo data (13 multi-stage wagons, 40+ spring records, component passports, and audit trails):

```bash
npm run seed
```

### Running the Application

#### Development Mode (Concurrent Server & Client with Live Reload)
```bash
npm run dev
```
- **Backend API**: `http://localhost:3000`
- **Frontend Client (Vite Dev Server)**: `http://localhost:5173`

#### Live Demo Mode (Seed + Concurrent Dev)
```bash
npm run start:live
```

#### Production Build & Run
```bash
# Build backend and frontend bundle
npm run build

# Start production server (serves both API and client on port 3000)
npm start
```
Access the application at `http://localhost:3000`.

---

## 🧪 Testing

Execute the end-to-end verification suite across all tiers:

The suite that exercises the real server is `server/tests` — **503 cases**. Run it with:

```bash
node --experimental-strip-types --test server/tests/*.test.ts
```

The root harness is a separate, largely hand-written parallel suite — 38 suites and
239 cases, of which 7 files import the real server and the rest test a mock harness.
It is useful, but a green run there is not on its own evidence that the product works:

```bash
npm test

# Run specific tiers
npm run test:tier1    # Feature & functional tests
npm run test:tier2    # RDSO boundary condition tests
npm run test:tier3    # Cross-feature and supervisor override flows
npm run test:tier4    # Heavy workload batch simulation
npm run test:tier5    # Adversarial stress & immutability trigger validation
```

---

## 👥 Default Demo Credentials

| Role | Username | Password | Full Name |
|------|----------|----------|-----------|
| **Inspector** | `inspector1` … `inspector4` | `password123` | Ramesh Kumar, and others |
| **Supervisor** | `supervisor1` | `password123` | S. K. Verma |
| **Admin** | `admin1` | `password123` | A. K. Mishra |
| **DRM** | `drm1` | `password123` | Divisional Railway Manager |

> These exist in development only. The server refuses to create them when
> `NODE_ENV=production`, so a deployment cannot come up with a working
> `admin1 / password123` on it — which is what used to happen, since seeding
> ran on every start in every environment.
>
> On a fresh production deployment, create the first real administrator by
> setting `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD` (at least
> 12 characters) before the first start, then add the rest of the roster from
> the **User Accounts** screen. The bootstrap account is a way in, not a
> standing one: it is only created when the database has no accounts at all.
>
> `SEED_DEMO_USERS=true` puts the demo logins back on a production build. It
> is there for a supervised demonstration and has to be typed on purpose.

---

## 📁 Repository Structure

```text
├── client/              # React 18 frontend PWA application
│   ├── src/             # UI components, pages, AR HUD canvas, audio DSP, hooks
│   ├── build.js         # Client build script
│   └── vite.config.ts   # Vite configuration & API proxy
├── server/              # Express + SQLite Node.js 22 backend
│   ├── src/             # REST controllers, routes, repositories, triggers, migrations
│   ├── data/            # SQLite database file (wrs_inspections.db)
│   └── build.js         # Backend build script
├── shared/              # Shared TypeScript types, enums, RDSO data structures
├── tests/               # E2E test harness & multi-tier test suites
└── package.json         # Workspace root scripts & orchestration
```

---

## 📜 Standards & Compliance

- **RDSO Technical Pamphlet G-95 (Revision-II)**: Technical specification for CASNUB bogie springs and maintenance standards.
- **Indian Railways Freight Quality Manual**: 7-stage POH / IOH wagon inspection protocols.
