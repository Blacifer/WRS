# docs/manuals — the documents Ask the Manual cites

The Wagon Maintenance Manual and the RDSO depot audit sheet are the shop's
documents; their text is not kept in git. Put them here as plain text, made
on a machine that has poppler:

```
pdftotext -layout "Vol-I (System Documentation).pdf"              docs/manuals/WMM-Vol-I.txt
pdftotext -layout docs/Quality_Audit_check-sheet_for_Wagon_Depot.pdf docs/manuals/ROH_AUDIT-check-sheet.txt
```

The part of the file name before the first hyphen is the source label in
citations (`WMM`, `ROH_AUDIT`). `npm run package:shop` copies this folder into
the bundle, and `INDEX-MANUALS.cmd` on the shop PC indexes every `.txt` here —
a Windows PC has no pdftotext, which is why the conversion happens before the
stick is made. `DEMO-DATA.cmd` runs it too. On this machine:
`npm run index-manual -- docs/manuals/WMM-Vol-I.txt`.

## The documents found online, 18 Sep 2026

Issued editions only. Two rules, learned the hard way the same day: **no
drafts** (a 2026 "Revision-1" of 02-ABR-02 and a "draft copy" maintenance
manual were left out), and **no online G-95** — a 124-page Revision-2 text
found online has five bands and different table numbers from the copy the
shop holds; the shop's printed G-95 is transcribed in the code as `G95` and
that is what *Ask the Manual* cites.

| File | Label | What it is |
|---|---|---|
| `IRCA_PART_III-conference-rules-2020.txt` | IRCA_PART_III | IRCA Conference Rules Part III, 2020 edition (429 pp) |
| `WMM_VOL2-oem-documentation-2022.txt` | WMM_VOL2 | Wagon Maintenance Manual Vol-II, CAMTECH Aug 2022 (799 pp) |
| `G112-lccf-lwlh-bogies.txt` | G112 | RDSO Technical Pamphlet G-112 |
| `G81-ctrb-class-e.txt` | G81 | RDSO Technical Pamphlet G-81, Class E CTRB |
| `G113-ctrb-class-k.txt` | G113 | RDSO Technical Pamphlet G-113, Class K CTRB (Sept 2021) |
| `AIR_BRAKE_HANDBOOK-camtech-2012.txt` | AIR_BRAKE_HANDBOOK | CAMTECH Handbook on Air Brake System of Freight Stock |
| `ABR_02-air-brake-specification.txt` | ABR_02 | RDSO 02-ABR-02 (2003, amendments 1–3) |
| `BLC_UNDERFRAME-rdso-repair-guidelines.txt` | BLC_UNDERFRAME | RDSO procedure for BLC underframe repair |

All made with `pdftotext -layout` from the PDFs in Pratik's Downloads; the
PDFs themselves are not in git.
