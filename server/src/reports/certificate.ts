/**
 * Official RDSO Rolling Stock Release Certificate Generator
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Generates official high-resolution printable HTML and JSON release certificates
 * with bilingual headers, CASNUB bogie clearance matrix, Phase 1 spring nest table,
 * and cryptographic HMAC supervisor sign-off verification.
 */

import { WagonRepository } from '../db/wagonRepository.ts';
import { InspectionRepository } from '../db/repository.ts';
import { ComponentRepository } from '../db/componentRepository.ts';
import { getDatabase } from '../db/connection.ts';
import qrcode from 'qrcode-generator';
import { SIGNATURE_ALGORITHM, certificateKeyFingerprint } from './certificateSigning.ts';

/**
 * Renders the certificate's verification payload as a real, scannable QR code.
 *
 * This block used to be a styled box reading "QR VERIFIED / Scan for
 * Authenticity" while the payload built a few lines above was discarded. A
 * certificate is the document that says a named supervisor released a
 * particular wagon; printing an unscannable box captioned "scan for
 * authenticity" on it is a false claim on exactly the record that most needs
 * to be true.
 *
 * Error correction is 'H' (~30% recoverable) rather than the usual 'M'. These
 * are printed, handled in a workshop, and stuck to paperwork, so a smudge or
 * a staple through one corner should not cost the read.
 *
 * Rendered as inline SVG rather than a raster: it stays sharp at any print
 * size and keeps the document self-contained, with no external request from
 * a page that may be opened on a machine with no network.
 */
function renderQrSvg(payload: string): string {
  const qr = qrcode(0, 'H');
  qr.addData(payload);
  qr.make();
  return qr.createSvgTag({ cellSize: 3, margin: 1, scalable: true });
}

export class CertificateGenerator {
  public static generate(
    wagonNumber: string,
    wagonRepo: WagonRepository,
    inspectionRepo: InspectionRepository,
    componentRepoOrFormat?: ComponentRepository | 'html' | 'json',
    format: 'html' | 'json' = 'html',
    // Options object rather than a positional boolean: parameter 4 is
    // overloaded (repo OR format string), which makes positional args past it
    // genuinely easy to misalign.
    options: { provisional?: boolean } = {}
  ): { html?: string; json?: Record<string, unknown> } {
    const provisional = options.provisional === true;
    const normalizedWagonNumber = wagonNumber.trim().toUpperCase();
    const wagon = wagonRepo.getWagonByNumber(normalizedWagonNumber);
    if (!wagon) {
      throw new Error(`Wagon ${normalizedWagonNumber} not found.`);
    }

    let actualFormat = format;
    let compRepo: ComponentRepository;

    if (typeof componentRepoOrFormat === 'string') {
      actualFormat = componentRepoOrFormat as 'html' | 'json';
      compRepo = new ComponentRepository(getDatabase());
    } else if (componentRepoOrFormat) {
      compRepo = componentRepoOrFormat;
    } else {
      compRepo = new ComponentRepository(getDatabase());
    }

    const signoff = wagonRepo.getGateSignoff(normalizedWagonNumber);
    const checklistData = wagonRepo.getChecklistItems(normalizedWagonNumber);
    const springInspections = inspectionRepo.queryInspections({ wagonNumber: normalizedWagonNumber, limit: 100 });
    const components = compRepo.getComponentsByWagon(normalizedWagonNumber);

    // -----------------------------------------------------------------------
    // SAFETY GATE. A release certificate is a formal attestation that this
    // wagon was inspected and cleared. It must never be producible for a
    // wagon that has not actually been signed off — previously this method
    // generated a full "100% PASSED" certificate for ANY wagon at ANY stage,
    // including ones the exit gate was actively blocking.
    //
    // Callers that legitimately need to preview an in-progress wagon must opt
    // in explicitly via `provisional`, which produces a conspicuously
    // watermarked NOT-A-RELEASE-CERTIFICATE document instead.
    // -----------------------------------------------------------------------
    const isSigned = !!signoff?.certificateNumber && !!signoff?.digitalSignature;
    if (!isSigned && !provisional) {
      const err: any = new Error(
        `Wagon ${normalizedWagonNumber} has no gate sign-off. A release certificate cannot be issued ` +
        `for a wagon that has not been formally released. Request a provisional preview if you need ` +
        `to see the current inspection state.`
      );
      err.name = 'CertificateNotAuthorized';
      throw err;
    }

    const certNumber = signoff?.certificateNumber || 'PROVISIONAL — NOT A RELEASE CERTIFICATE';
    const certHash = signoff?.certificateHash || 'UNSIGNED';
    const signedAt = signoff?.signedAt || wagon.actualReleaseDate || new Date().toISOString();
    // No fallback to a real person's name. An unsigned document must never
    // attribute itself to a named supervisor who did not sign it.
    const supervisorName = signoff?.supervisorName || 'NOT SIGNED';
    const supervisorEmpId = signoff?.supervisorEmployeeId || '—';
    const digitalSignature = signoff?.digitalSignature || 'UNSIGNED';

    const entryTime = new Date(wagon.entryDate).getTime();
    const releaseTime = new Date(signedAt).getTime();
    const tatDays = Math.max(0.1, Math.round(((releaseTime - entryTime) / (1000 * 60 * 60 * 24)) * 10) / 10);

    const checklistItems: any[] = checklistData.allItems || [];
    const isItemCleared = (i: any) =>
      i.status === 'PASS' || (['REPAIRED', 'REPLACED'].includes(i.status) && i.reinspectedStatus === 'PASS');
    const passedCount = checklistItems.filter(isItemCleared).length;
    const totalCount = checklistItems.length;

    // -----------------------------------------------------------------------
    // Category clearance matrix, computed from the actual checklist.
    // Previously all eight rows were hardcoded in the HTML as "100% PASSED",
    // so the certificate asserted full compliance regardless of the data.
    // -----------------------------------------------------------------------
    const CATEGORY_MATRIX: { key: string; label: string; scope: string; std: string }[] = [
      { key: 'SPRINGS',             label: '1. Springs',           scope: 'Outer, Inner, Snubber (Bogie 1 & 2)',          std: 'RDSO G-95 Table 28-33' },
      { key: 'WHEELS_AXLES',        label: '2. Wheels & Axles',    scope: 'Wheel profile, tread wear, flange, UST',       std: 'RDSO C-9901 / ND-97' },
      { key: 'BEARINGS',            label: '3. Bearings',          scope: 'CTRB cartridge bearings, adapter, seals',      std: 'RDSO G-81' },
      { key: 'BRAKE_SYSTEM',        label: '4. Brake System',      scope: 'Brake blocks, rigging, SAB, cylinder, DV',     std: 'RDSO 02-ABR-02' },
      { key: 'COUPLERS_DRAFT_GEAR', label: '5. Couplers & Draft',  scope: 'CBC body, knuckle, Mark-50 draft gear',        std: 'RDSO 48-BD-08 / WRS gauge boards' },
      { key: 'BOGIE_FRAME_BOLSTER', label: '6. Bogie Frame',       scope: 'Side frames, bolster, centre plate, bearers',  std: 'RDSO G-95' },
      { key: 'FRICTION_WEDGES',     label: '7. Friction Wedges',   scope: 'Slope wear, vertical face, spigot fit',        std: 'RDSO G-95 / WMM 2.0 §309D' },
      { key: 'BODY_UNDERFRAME',     label: '8. Body / Underframe', scope: 'Centre sill, flooring, doors, stencilling',    std: 'RDSO G-70' }
    ];

    const categoryStats = CATEGORY_MATRIX.map(cat => {
      const items = checklistItems.filter(i => i.category === cat.key);
      const total = items.length;
      const cleared = items.filter(isItemCleared).length;
      const condemned = items.filter(i => i.status === 'CONDEMNED').length;
      const failed = items.filter(i => i.status === 'FAIL').length;
      const pending = items.filter(i => !i.status || i.status === 'PENDING').length;

      let verdict: 'CLEARED' | 'NOT CLEARED' | 'NO DATA';
      if (total === 0) verdict = 'NO DATA';
      else if (cleared === total) verdict = 'CLEARED';
      else verdict = 'NOT CLEARED';

      return { ...cat, total, cleared, condemned, failed, pending, verdict };
    });

    const categoriesCleared = categoryStats.filter(c => c.verdict === 'CLEARED').length;

    const qrData = `INDIAN_RAILWAYS|WRS_RAIPUR|QC_CERT|${certNumber}|${normalizedWagonNumber}|${wagon.wagonType}|${signedAt}|${certHash.slice(0, 16)}`;

    const jsonPayload = {
      certificateNumber: certNumber,
      certificateHash: certHash,
      issuedAt: signedAt,
      wagon: {
        wagonNumber: normalizedWagonNumber,
        wagonType: wagon.wagonType,
        owningRailway: wagon.owningRailway,
        entryDate: wagon.entryDate,
        releaseDate: signedAt,
        tatDays
      },
      isProvisional: !isSigned,
      bogiePartsSummary: {
        totalInspected: totalCount,
        passedCount,
        categoriesPassed: categoriesCleared,
        categoryBreakdown: categoryStats.map(c => ({
          category: c.key,
          total: c.total,
          cleared: c.cleared,
          condemned: c.condemned,
          failed: c.failed,
          pending: c.pending,
          verdict: c.verdict
        }))
      },
      springNestSummary: {
        totalSprings: springInspections.records.length,
        springs: springInspections.records.map(s => ({
          bogieType: s.bogieType,
          springPosition: s.springPosition,
          measuredHeight: s.measuredFreeHeight,
          band: s.classifiedBand,
          bandRoman: s.bandRoman,
          status: s.status
        }))
      },
      componentManifest: {
        totalSerializedComponents: components.length,
        components: components.map(c => ({
          serialNumber: c.serialNumber,
          componentType: c.componentType,
          category: c.category,
          partName: c.partName,
          bogiePosition: c.currentBogiePosition,
          healthScore: c.healthScore,
          healthStatus: c.healthStatus,
          manufacturer: c.manufacturer,
          manufacturingDate: c.manufacturingDate,
          totalKmTravelled: c.totalKmTravelled,
          qrCode: c.qrCode,
          status: c.status
        }))
      },
      serializedComponents: components.map(c => ({
        serialNumber: c.serialNumber,
        componentType: c.componentType,
        category: c.category,
        partName: c.partName,
        bogiePosition: c.currentBogiePosition,
        healthScore: c.healthScore,
        healthStatus: c.healthStatus,
        manufacturer: c.manufacturer,
        manufacturingDate: c.manufacturingDate,
        totalKmTravelled: c.totalKmTravelled,
        qrCode: c.qrCode,
        status: c.status
      })),
      signoff: {
        supervisorName,
        supervisorEmployeeId: supervisorEmpId,
        digitalSignature,
        signedAt
      },

      /*
       * Everything needed to check the signature without this server.
       *
       * signedContent is the exact byte sequence that was signed. Without it a
       * verifier would have to reconstruct the canonical JSON — same fields,
       * same order, same formatting — by reading the source, and would get a
       * verification failure indistinguishable from tampering if they got any
       * of it subtly wrong. Publishing the signed bytes turns third-party
       * verification into three lines of Ed25519 rather than an exercise in
       * guessing a serialisation.
       *
       * The fields inside signedContent are also visible on the certificate
       * itself, so a reader can confirm the signed content says the same thing
       * the printed document does.
       */
      verification: isSigned
        ? {
            algorithm: SIGNATURE_ALGORITHM,
            signature: digitalSignature,
            signedContent: signoff
              ? JSON.stringify({
                  wagonNumber: normalizedWagonNumber,
                  certificateNumber: signoff.certificateNumber,
                  supervisorId: signoff.supervisorId,
                  supervisorEmployeeId: signoff.supervisorEmployeeId,
                  signedAt: signoff.signedAt,
                  summary: signoff.checksSummary
                })
              : null,
            publicKeyFingerprint: certificateKeyFingerprint(),
            publicKeyUrl: '/api/audit/certificate-key'
          }
        : null,
      qrData
    };

    if (actualFormat === 'json') {
      return { json: jsonPayload };
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Rolling Stock Release Certificate - ${normalizedWagonNumber}</title>
  <style>
    @page { size: A4 portrait; margin: 15mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 24px;
      line-height: 1.4;
    }
    .cert-border {
      border: 3px double #1e3a8a;
      padding: 24px;
      position: relative;
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #1e3a8a;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .gov-title {
      font-size: 14px;
      font-weight: 700;
      color: #1e3a8a;
      letter-spacing: 1px;
    }
    .main-title {
      font-size: 20px;
      font-weight: 900;
      color: #0f172a;
      margin: 4px 0;
      text-transform: uppercase;
    }
    .cert-badge {
      display: inline-block;
      background: #1e3a8a;
      color: white;
      padding: 4px 14px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 700;
      margin-top: 6px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 16px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
    }
    .meta-label {
      color: #64748b;
      font-weight: 600;
    }
    .meta-val {
      font-weight: 700;
      color: #0f172a;
    }
    .section-title {
      font-size: 13px;
      font-weight: 800;
      color: #1e3a8a;
      text-transform: uppercase;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 4px;
      margin: 14px 0 8px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
      margin-bottom: 12px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      text-align: left;
    }
    th {
      background: #f1f5f9;
      font-weight: 700;
      color: #334155;
    }
    .status-pass {
      color: #166534;
      background: #dcfce7;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      text-align: center;
      display: inline-block;
    }
    .status-fail {
      color: #991b1b;
      background: #fee2e2;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      text-align: center;
      display: inline-block;
    }
    .provisional-banner {
      background: #7f1d1d;
      color: #ffffff;
      padding: 14px 18px;
      margin-bottom: 18px;
      border-radius: 6px;
      font-weight: 800;
      font-size: 14px;
      letter-spacing: 0.04em;
      text-align: center;
      line-height: 1.5;
    }
    .provisional-banner span {
      display: block;
      font-weight: 500;
      font-size: 12px;
      letter-spacing: 0;
      margin-top: 5px;
      opacity: 0.92;
    }
    .provisional-watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-32deg);
      font-size: 88px;
      font-weight: 900;
      color: rgba(153, 27, 27, 0.13);
      letter-spacing: 0.05em;
      pointer-events: none;
      z-index: 999;
      white-space: nowrap;
    }
    .signoff-box {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 16px;
      border: 1px dashed #1e3a8a;
      background: #f8fafc;
      padding: 12px 16px;
      border-radius: 6px;
      margin-top: 16px;
    }
    .sig-details {
      font-size: 12px;
    }
    .sig-hash {
      font-family: monospace;
      font-size: 10px;
      color: #475569;
      word-break: break-all;
    }
    .qr-box {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border-left: 1px solid #e2e8f0;
      padding-left: 12px;
    }
    .qr-code {
      width: 88px;
      height: 88px;
    }
    .qr-code svg {
      width: 100%;
      height: 100%;
      display: block;
      /* Print drivers routinely drop background graphics; without this the
         modules vanish and the certificate carries a blank square. */
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .footer {
      text-align: center;
      font-size: 10px;
      color: #94a3b8;
      margin-top: 16px;
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
    }
    @media print {
      body { padding: 0; }
      .cert-border { border: 2px solid #1e3a8a; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 16px; text-align: right;">
    <button onclick="window.print()" style="background: #1e3a8a; color: white; border: none; padding: 8px 16px; border-radius: 4px; font-weight: bold; cursor: pointer;">
      🖨️ Print / Save as PDF
    </button>
  </div>

  ${!isSigned ? `<div class="provisional-watermark">PROVISIONAL</div>` : ''}

  <div class="cert-border">
    ${!isSigned ? `
    <div class="provisional-banner">
      ⚠ PROVISIONAL INSPECTION SUMMARY — THIS IS NOT A RELEASE CERTIFICATE
      <span>
        This wagon has not been signed off at the exit gate. This document reflects the
        current inspection state only and must not be used to authorise release or movement.
      </span>
    </div>` : ''}
    <div class="header">
      <div class="gov-title">भारतीय रेल / INDIAN RAILWAYS • दक्षिण पूर्व मध्य रेलवे / SECR</div>
      <div class="main-title">Wagon Repair Shop (WRS), Raipur (C.G.)</div>
      <div style="font-size: 13px; font-weight: 700; color: #334155;">रोलिंग स्टॉक विमुक्ति प्रमाणपत्र / ROLLING STOCK QUALITY RELEASE CERTIFICATE</div>
      <div class="cert-badge">CERTIFICATE NO: ${certNumber}</div>
    </div>

    <div class="meta-grid">
      <div class="meta-row"><span class="meta-label">Wagon Number:</span><span class="meta-val">${normalizedWagonNumber}</span></div>
      <div class="meta-row"><span class="meta-label">Wagon Type:</span><span class="meta-val">${wagon.wagonType}</span></div>
      <div class="meta-row"><span class="meta-label">Owning Railway:</span><span class="meta-val">${wagon.owningRailway}</span></div>
      <div class="meta-row"><span class="meta-label">Intake Date:</span><span class="meta-val">${wagon.entryDate.slice(0, 10)}</span></div>
      <div class="meta-row"><span class="meta-label">Release Date:</span><span class="meta-val">${signedAt.slice(0, 10)}</span></div>
      <div class="meta-row"><span class="meta-label">Workshop TAT:</span><span class="meta-val">${tatDays} Days</span></div>
    </div>

    <div class="section-title">1. CASNUB Bogie 8-Category RDSO Quality Clearance Matrix</div>
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th>Subsystem Inspection Scope</th>
          <th>Standard Ref</th>
          <th>Clearance Status</th>
        </tr>
      </thead>
      <tbody>
        ${categoryStats.map(c => {
          const cls = c.verdict === 'CLEARED' ? 'status-pass' : 'status-fail';
          let detail: string;
          if (c.verdict === 'NO DATA') {
            detail = 'NO ITEMS RECORDED';
          } else if (c.verdict === 'CLEARED') {
            detail = `${c.cleared}/${c.total} CLEARED`;
          } else {
            const parts: string[] = [];
            if (c.pending) parts.push(`${c.pending} not inspected`);
            if (c.failed) parts.push(`${c.failed} failed`);
            if (c.condemned) parts.push(`${c.condemned} condemned`);
            detail = `${c.cleared}/${c.total} CLEARED — ${parts.join(', ')}`;
          }
          return `<tr><td>${c.label}</td><td>${c.scope}</td><td>${c.std}</td><td><span class="${cls}">${detail}</span></td></tr>`;
        }).join('')}
      </tbody>
    </table>

    <div class="section-title">2. RDSO G-95 Rev-II Spring Nest Classification Summary</div>
    <table>
      <thead>
        <tr>
          <th>Bogie Position</th>
          <th>Spring Position</th>
          <th>Measured Height</th>
          <th>Classified Band</th>
          <th>Color Badge</th>
          <th>Quality Status</th>
        </tr>
      </thead>
      <tbody>
        ${
          springInspections.records.length > 0
            ? springInspections.records.slice(0, 12).map(s => `
              <tr>
                <td>${s.bogieType}</td>
                <td>${s.springPosition}</td>
                <td>${s.measuredFreeHeight.toFixed(1)} mm</td>
                <td>${s.bandRoman || '<em>not recorded</em>'}</td>
                <td><span style="font-weight: bold; color: ${s.classifiedBand ? s.classifiedBand.toLowerCase() : '#b45309'}">${s.classifiedBand || 'NOT RECORDED'}</span></td>
                <td><span class="${s.status === 'PASS' ? 'status-pass' : 'status-fail'}">${s.status}</span></td>
              </tr>
            `).join('')
            : `<tr><td colspan="6" style="text-align: center; color: #b45309; font-weight: bold;">NO SPRING INSPECTIONS RECORDED FOR THIS WAGON</td></tr>`
        }
      </tbody>
    </table>

    <div class="section-title">3. Serialized Component Health Passport Manifest (RDSO R4 Serialization)</div>
    <table>
      <thead>
        <tr>
          <th>Subsystem / Part Name</th>
          <th>Serial Number</th>
          <th>Position</th>
          <th>Health Score</th>
          <th>Health Status</th>
          <th>Manufacturer</th>
        </tr>
      </thead>
      <tbody>
        ${
          components.length > 0
            ? components.map(c => `
              <tr>
                <td><strong>${c.partName}</strong><br><span style="font-size: 10px; color: #64748b;">${c.componentType}</span></td>
                <td><code>${c.serialNumber}</code></td>
                <td>${c.currentBogiePosition}</td>
                <td><strong>${c.healthScore.toFixed(1)}%</strong></td>
                <td>
                  <span class="status-pass" style="background: ${c.healthStatus === 'EXCELLENT' || c.healthStatus === 'GOOD' ? '#dcfce7' : c.healthStatus === 'FAIR' ? '#fef3c7' : '#fee2e2'}; color: ${c.healthStatus === 'EXCELLENT' || c.healthStatus === 'GOOD' ? '#166534' : c.healthStatus === 'FAIR' ? '#92400e' : '#991b1b'};">
                    ${c.healthStatus}
                  </span>
                </td>
                <td>${c.manufacturer} (${c.manufacturingDate ? c.manufacturingDate.slice(0, 7) : '2024'})</td>
              </tr>
            `).join('')
            : // An empty manifest means no serialised component was linked to this
              // wagon. It used to print "All high-value serialized components
              // ... verified in Stores Passport Ledger", which turned an
              // absence of records into a positive assurance on a safety
              // certificate — a reader would take it as confirmation that the
              // wheelsets and bearings had been checked against the ledger,
              // when nothing had been recorded at all. State the fact instead.
              `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 10px;">No serialised components are linked to this wagon. This section makes no statement about them.</td></tr>`
        }
      </tbody>
    </table>

    <div class="signoff-box">
      <div class="sig-details">
        <div style="font-weight: 800; color: #1e3a8a; margin-bottom: 4px;">SUPERVISOR DIGITAL SIGN-OFF & CERTIFICATION</div>
        <div><strong>Certifying Supervisor:</strong> ${supervisorName} (${supervisorEmpId})</div>
        <div><strong>Certification Timestamp:</strong> ${signedAt}</div>
        <div><strong>Verification Algorithm:</strong> ${SIGNATURE_ALGORITHM} public-key signature</div>
        <div class="sig-hash"><strong>Signature:</strong> ${digitalSignature}</div>
        <!-- The fingerprint lets whoever holds this on paper confirm which key
             to check it against, without transcribing the whole key. The key
             itself is published and needs no account to fetch, because a
             signature only the issuer can verify is not much of a signature. -->
        <div class="sig-hash"><strong>Signing key:</strong> ${certificateKeyFingerprint()}
          &nbsp;·&nbsp; verify at /api/audit/certificate-key</div>
        <div class="sig-hash"><strong>Certificate SHA-256:</strong> ${certHash}</div>
      </div>
      <div class="qr-box">
        <div class="qr-code">${renderQrSvg(qrData)}</div>
        <div style="font-size: 8.5px; color: #64748b; margin-top: 4px;">Scan to verify</div>
      </div>
    </div>

    <div class="footer">
      This document is an authenticated Electronic Quality Clearance Certificate issued under the authority of Chief Workshop Manager (CWM), WRS Raipur.
    </div>
  </div>
</body>
</html>`;

    return { html, json: jsonPayload };
  }
}
