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
