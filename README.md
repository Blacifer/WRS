# Indian Railways — WRS Raipur Spring Classification & Wagon QC System

> **A Full-Stack, Offline-First Industrial PWA & API Platform for Wagon Quality Control & RDSO G-95 Revision-II Compliance.**

---

## 🚂 System Overview

The **WRS Raipur Quality Control Platform** is an enterprise-grade web application built for the **Indian Railways Wagon Repair Shop (WRS), Raipur**. It digitizes and automates the complete wagon inspection, spring classification, component lifecycle tracking, and zero-defect exit gate verification workflows.

### Key Capabilities

1. **Spring Classification Engine (RDSO G-95 Rev-II)**:
   - Automated group band classification (Bands I to IV, Condemnation thresholds) for CASNUB 22 NLB, 22 HS, and 22 RFT bogie springs.
   - Live AR caliper HUD & computer vision measurement simulations.

2. **Full Lifecycle Stage Progression (7 Stages)**:
   - Stage 1: Inward Yard Entry
   - Stage 2: Stripping & Dismantling
   - Stage 3: Bogie & Component Inspection
   - Stage 4: Body & Structural Repair
   - Stage 5: Wheelset & Reassembly
   - Stage 6: Final QC Gate & Air Brake Testing
   - Stage 7: Ready for Departure / Exit Gate Certification

3. **Component Health Passports & RFID/QR Tracking**:
   - Traceability for critical wagon assets (wheelsets, side frames, bolster, draft gears, CTRB bearings, CBC couplers).
   - Tamper-proof lifecycle history and QR certificate generation.

4. **Smart Diagnostics & AI Triage**:
   - **Voice UI ("Greasy Gloves")**: Hands-free bilingual (English / Hindi) voice checklist inspection.
   - **Acoustic Bearing & Leak Diagnostics**: Web Audio DSP with real-time 32-band FFT frequency analyzer.
   - **Pre-Arrival OMRS Telemetry**: Automated trackside sensor ingestion and stores reservation.

5. **Industrial Integrity & Audit Security**:
   - SQLite append-only audit tables with cryptographic SHA-256 hash chains.
   - Strict database-level immutability triggers preventing retrospective tampering.
   - Multi-role RBAC: Inspector, Supervisor, DRM, and Admin with supervisor overrides and OTP validation.

---

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

```bash
# Run all 41 test suites (260 test cases)
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
| **Inspector** | `inspector_ramesh` | `Railway@2026` | Ramesh Kumar |
| **Inspector** | `inspector_suresh` | `Railway@2026` | Suresh Verma |
| **Supervisor** | `supervisor_sharma` | `Railway@2026` | Alok Sharma (SSE) |
| **DRM (Divisional Railway Manager)** | `drm_raipur` | `Railway@2026` | Rajesh Agrawal (DRM) |
| **Admin** | `admin` | `Railway@2026` | System Administrator |

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
