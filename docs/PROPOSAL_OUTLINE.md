# WRS Raipur — Spring & Wagon QC System: proposal outline

For the DRM's office. Prices are left blank on purpose: fill them once the
DRM has said what the shop will provide itself. Everything listed under
"what is delivered" exists today and has been run end to end on a production
build; nothing in this document is planned software.

## 1. What it is, in one paragraph

A workshop quality system for the spring sorting bench and the wagon POH
line at WRS Raipur. Inspectors record each spring's free height and band on a
tablet with one tap, against the RDSO G-95 tables and a named, calibrated
gauge; each wagon carries its checklist, wheel readings, air-brake test,
parts ledger and photographs; a wagon can only be released when a fixed set
of rules is satisfied, and the supervisor's sign-off produces a certificate
that verifies itself anywhere. Every record is append-only and hash-chained.
The system works with no internet, on the shop's own PC, and shows the DRM
the shop's numbers with the count behind every one.

## 2. What is delivered (software)

| Item | Status |
|---|---|
| Spring sorting bench (bands, gauges, undo, throughput) | Delivered, in use on the demo |
| Wagon lifecycle: 7 stages, 41-item CASNUB checklist, exit gate | Delivered |
| Wheel readings against published limits (tread, flange, variation) | Delivered |
| Single Wagon Test (air brake) proforma, 14 rows against WMM limits | Delivered |
| Parts ledger (off / on / scrapped per position) | Delivered |
| Photographic evidence, assembly frames, pocket counts | Delivered |
| Release certificate (Ed25519-signed, offline verification page), wagon passport | Delivered |
| DRM dashboard, spring analytics, standard report, forecast, gauge drift, inspector quality | Delivered |
| Ask the Manual / Ask the Records with citations | Delivered |
| Shadow-run log and verdict (for the go-live decision) | Delivered |
| Offline-first tablet app, English and Hindi | Delivered |
| Camera on the bench (learns this shop's springs; gated until proven) | Delivered, gated |
| Encrypted backups, restart-on-failure, readiness panel, cloud copy | Delivered |
| Security: capability-based roles, one-time codes / authenticator, audit chain | Delivered |
| Installation bundle for a Windows PC (USB stick), tablet trust guide | Delivered |

## 3. What the workshop provides

| Item | Notes | Provided by |
|---|---|---|
| One Windows PC in the shop (any from the last ~8 years, 8 GB RAM) | Runs the server; existing office PC is fine | Shop / quote |
| 1–2 Android tablets, rugged case with strap | The bench and the wagon line | Shop / quote |
| Wi-Fi covering the bay, or a cable to the PC | LAN only; no internet needed to work | Shop |
| One external/USB disk kept in another room | Off-site backup | Shop / quote |
| Optional: cloud storage bucket (S3-compatible) | Off-site copy of encrypted backups; any Indian S3 provider or RailTel/NIC | Shop / quote |
| Optional: a lamp at the assembly photo position | For pocket counts | Shop |
| Optional: digital wheel gauge with data output | Wheel readings without chalk | Quote |
| Wagon Maintenance Manual PDF, IRCA Part III wheel page | For citations and to confirm wheel limits | Shop |
| Gauge calibration certificates for the bench gauges | The register shows blank dates today | Shop |
| Roster: name, employee ID, role | Accounts are created in minutes | Shop |

## 4. Services and support (quote here)

| Line | Description | Effort | Price |
|---|---|---|---|
| Installation | Bundle on the shop PC, accounts, gauges, tablets trusted, backup scheduled, cloud copy (if chosen) | ½ day on site | |
| Training | Inspectors (1 h at the bench), supervisors (1 h), admin (1 h), DRM walk-through (30 min) | 1 day on site | |
| Shadow run support | Two weeks beside the paper register; daily read of the shadow log; fixes as found | 2 weeks, remote + 2 visits | |
| Go-live | Register retired on the shadow verdict; sign-off with CWM | ½ day | |
| Support, year 1 | Fixes, updates, backup/restore drill quarterly, phone support | 12 months | |
| Camera enablement | When the bench has produced its labelled photographs: evaluation, gate opening, blind-read review | as earned | |
| Pocket-count model | When 300 bogies and the agreement figure are reached: build, measure, gate | as earned | |
| Extension to a second shop | Same bundle, own key, passports between shops | per shop | |

## 5. How the first month goes

1. **Day 0** — install (half a day). Inspectors sort springs on the tablet the same afternoon.
2. **Days 1–14** — the app is in full use; the paper register runs alongside; the supervisor notes each disagreement on the *Shadow Run* screen (30 seconds each).
3. **Day 15** — the shadow verdict: how often the app and the register disagreed, who was right, and whether the app ever passed a spring the register condemned (must be zero). CWM decides on retiring the register.
4. **Days 15–30** — forecast, standard report and gauge drift are live on real numbers; the DRM dashboard shows the shop's month.

## 6. What it does not do, and says so

- It does not decide. Every verdict is a person's; the system computes, records, proves and asks.
- The camera does not judge springs until it has proven itself on this shop's own photographs; the dashboard shows the score.
- No trackside "AI triage", no predicted failures, no confidence number nobody computed. Every rate on screen carries its count.
- Wheel limits are reproduced from IRIMEE training material and are marked "confirm against IRCA Part III" on the screen until the shop does so.

## 7. Data, ownership and security (one paragraph for the file)

All data stays on the workshop's PC. Nothing is sent anywhere unless the shop
chooses a cloud backup, in which case only encrypted files leave and the key
stays in the shop. Records cannot be edited or deleted after they are
written; every change is an addition, hash-chained, and verifiable by the
DRM's office with one button. Access is by named account with roles that
match the shop's own (inspector, supervisor, DRM, administrator), and the
administrator cannot release a wagon. A release certificate is signed with
the workshop's own key and can be verified by any railway, with no account
and no server, from the QR code on the certificate.
