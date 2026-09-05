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
   - **How many whole bogies the pile builds**, and which spring position is holding that number down — a bogie needs its outer, inner and snubber groups together and is finished when the scarcest runs out, which a per-band tally cannot show. Springs stranded in a band too thin to fill a group are counted rather than left looking like stock.
   - **A reading that does not belong is questioned.** Every free height here is entered by hand, so a transposed digit — 260.5 typed as 206.5 — is a permanent hazard rather than one an instrument could remove. Readings are compared against others of their kind using median and MAD, and an odd one raises an advisory naming the likely typo. It never changes a verdict, never blocks a save, and stays silent until it has seen a dozen springs of that kind. Note which way the error runs: a typo of this sort does not pass a bad spring, it condemns a good one.

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

7. **What Stores should expect to issue**
   - Expected spring replacements for the coming fortnight, built from three inputs of deliberately different kinds: the shop's own out-turn return (5,747 wagons last year, BOXNHL 43.6% of them), RDSO's published spring counts, and the condemnation rate observed here. Only the last is learned.
   - There is no model, and that is a choice. The arithmetic is the answer and a supervisor can check it on paper; every line reports how many observations its rate rests on.
   - A spring type with fewer than 30 condemnations on record is reported as *not forecast yet* rather than given a number. An order quantity invented from four observations is worse than a blank, because somebody acts on it.

8. **Tamper-evident record**
   - SHA-256 hash chain across every event, with database-level append-only triggers.
   - The **Audit Chain** screen (supervisor and above), or `GET /api/audit/verify`, re-derives the whole chain and names the first altered entry. A changed *role* breaks it, not just changed data. The screen also states what a pass does *not* prove: that no record was altered after it was written is not the same as every measurement having been correct.
   - Release certificates carry a keyed HMAC over their own contents and can be re-verified from the stored record.

9. **Built for the shop floor**
   - Offline-first PWA with an IndexedDB queue; work continues without a network and syncs without duplicating.
   - Bilingual throughout (English / Hindi).
   - Hands-free voice checklist entry, and acoustic bearing/leak diagnostics using real Web Audio FFT.
   - Full-text search over the RDSO manual (2,341 passages, 659 pages) with real citations.

### What it deliberately does not do

Stated plainly, because a system used for safety decisions should be clear about its own limits:

- **It does not identify a spring, or a wagon, from a photograph.** Free height cannot be recovered from an image without a scale. The spring queue and the wagon number are entered, not detected.
- **It does not detect cracks or corrosion automatically.** Visible defects are recorded by the inspector. In the per-wagon spring flow a photograph is mandatory — the verdict cannot be saved without one. On the loose-spring sorting bench, which runs at roughly 700 springs a shift, the photograph is attached automatically when "Photograph springs while sorting" is on, and condemning for a visible defect with it off prompts to switch it on rather than blocking the bench. A height condemnation asks for no photograph at all, for the same reason a band cannot be read off one.
- **It does not invent limits.** Where the manual publishes no figure — the CTRB end-cap gap, the RFT spring count — the app measures and records but returns no verdict, and says why.
- **The supervisor OTP is not a second factor.** With no SMS gateway integrated, the code is returned in the API response. It is an audited two-step confirmation; `OTP_DELIVERY` makes that posture explicit rather than implied.

## 🛠️ Architecture & Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Vite, HTML5 Canvas 2D AR HUD, Web Audio API DSP, Web Speech API, IndexedDB offline store.
- **Backend**: Node.js 22, Node native SQLite (`DatabaseSync`) with WAL mode, foreign keys, and cryptographic audit log triggers.
- **No web framework and no ORM.** The HTTP layer is a small Express-shaped router of our own over `node:http` (`server/src/framework/`), and the only runtime dependencies are `dotenv` and `qrcode-generator`. This is deliberate for a system that has to be auditable and to keep running on a workshop LAN for years: there is no dependency tree to audit, and nothing to patch on someone else's release schedule.
- **Testing**: 697 server tests, 173 client tests, and 39 E2E suites (Boundary Value Analysis, Combinatorial, High-Load multi-shift simulation, and adversarial integrity tests).

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

#### Type checking

```bash
npm run typecheck        # server and client, both must report zero errors
```

The server runs under `node --experimental-strip-types`, which removes type
annotations without checking them. That means nothing catches a type error at
runtime until the line executes, so `npm run typecheck` is the only thing that
does — run it before pushing. It is wired into `npm run build` for that reason.

#### Production Build & Run
```bash
# Type-check, then build backend and frontend bundle
npm run build

# Start production server (serves both API and client on port 3000)
npm start
```
Access the application at `http://localhost:3000`.

---

## 🧪 Testing

Execute the end-to-end verification suite across all tiers:

The suite that exercises the real server is `server/tests` — **697 tests across 139 suites** in 59 files. Run it with:

```bash
node --experimental-strip-types --test server/tests/*.test.ts
```

The root harness is a separate, largely hand-written parallel suite — **39 suites**,
of which 7 files import the real server and the rest test a mock harness. It is
useful, but a green run there is not on its own evidence that the product works.

Note the runner refuses to start if a `.test.ts` under `tests/e2e/` is registered
in no tier of `tests/runner.ts`, rather than passing over a suite it never opened:

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
│   └── vite.config.ts   # Vite configuration & API proxy
├── server/              # Node.js 22 + native SQLite backend
│   ├── src/             # Routes, repositories, triggers, migrations
│   │   └── framework/   # The small node:http router used in place of Express
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
