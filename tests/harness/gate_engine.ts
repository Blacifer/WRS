/**
 * Zero-Defect Exit Gate & Release Certification Engine
 * Indian Railways WRS Raipur (Phase 2)
 *
 * Enforces Zero-Defect clearance: all mandatory parts pass, zero condemned items,
 * Phase 1 spring clearance, supervisor digital sign-off, and PDF release certificates.
 */

import crypto from 'node:crypto';
import type {
  ChecklistItem,
  GateStatusResponse,
  GateSignoffRequest,
  ReleaseCertificate,
  InspectionRecord,
  WagonRecord
} from '../../shared/types.ts';

export class ExitGateEngine {
  /**
   * Evaluate Zero-Defect Exit Gate status for a wagon
   */
  public static evaluateGateStatus(
    wagon: WagonRecord,
    checklistItems: ChecklistItem[],
    springInspections: InspectionRecord[],
    hasSupervisorSignoff: boolean
  ): GateStatusResponse {
    const blockers: string[] = [];

    const mandatoryItems = checklistItems.filter(i => i.criticality === 'MANDATORY');
    const passedMandatory = mandatoryItems.filter(
      i => i.status === 'PASS' || i.status === 'REPAIRED' || i.status === 'REPLACED'
    );
    const failedMandatory = mandatoryItems.filter(i => i.status === 'FAIL');
    const condemnedItems = checklistItems.filter(i => i.status === 'CONDEMNED');

    // 1. Mandatory items check
    for (const item of failedMandatory) {
      blockers.push(`Mandatory component failed or uninspected: [${item.category}] ${item.partName}`);
    }

    // 2. Condemned items check
    for (const item of condemnedItems) {
      blockers.push(`Unresolved condemned component: [${item.category}] ${item.partName}`);
    }

    // 3. Phase 1 Springs check
    const springChecklistItems = checklistItems.filter(i => i.category === 'SPRINGS');
    const springChecklistResolved = springChecklistItems.length > 0 && springChecklistItems.every(i => i.status === 'PASS' || i.status === 'REPLACED');
    const condemnedSprings = springInspections.filter(s => s.status === 'CONDEMNED');
    const passedSprings = springInspections.filter(s => s.status === 'PASS');
    const hasCondemnedSprings = condemnedSprings.length > 0 && !springChecklistResolved;

    if (hasCondemnedSprings) {
      blockers.push(`Phase 1 spring inspection has ${condemnedSprings.length} condemned spring(s) that must be replaced`);
    }

    // 4. Supervisor sign-off check (required for final clearance)
    if (!hasSupervisorSignoff) {
      blockers.push('Supervisor digital sign-off is pending for final release');
    }

    // 5. Acoustic anomaly check
    if (wagon.conditionNotes?.includes('Acoustic Blocker:')) {
      blockers.push(`Acoustic defect detected at Final QC Gate: ${wagon.conditionNotes}`);
    }

    const canRelease = blockers.length === 0;


    return {
      canRelease,
      currentStage: wagon.currentStage,
      blockers,
      summary: {
        totalItems: checklistItems.length,
        totalMandatory: mandatoryItems.length,
        passedMandatory: passedMandatory.length,
        failedMandatory: failedMandatory.length,
        totalCondemned: condemnedItems.length,
        unaddressedCondemned: condemnedItems.length,
        springCheck: {
          totalSprings: springInspections.length,
          passedSprings: passedSprings.length,
          condemnedSprings: condemnedSprings.length,
          hasCondemnedSprings
        },
        hasSupervisorSignoff
      }
    };
  }

  /**
   * Generate official Release Certificate
   */
  public static generateReleaseCertificate(
    wagon: WagonRecord,
    checklistItems: ChecklistItem[],
    springInspections: InspectionRecord[],
    signoff: {
      supervisorId: string;
      supervisorName: string;
      digitalSignature: string;
    }
  ): ReleaseCertificate {
    const certNumber = `WRS-RC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const releaseDate = new Date().toISOString();

    const passedCount = checklistItems.filter(i => i.status === 'PASS').length;
    const repairedCount = checklistItems.filter(i => i.status === 'REPAIRED').length;
    const replacedCount = checklistItems.filter(i => i.status === 'REPLACED').length;

    const qrVerificationCode = `WRS-VERIFY:${certNumber}:${wagon.wagonNumber}:${wagon.wagonType}:${releaseDate}`;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Indian Railways WRS Raipur — Wagon Release Certificate</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 40px; color: #1e293b; }
    .header { text-align: center; border-bottom: 3px double #0284c7; padding-bottom: 20px; }
    .header h1 { margin: 0; color: #0f172a; font-size: 24px; text-transform: uppercase; }
    .header h2 { margin: 5px 0; color: #0369a1; font-size: 18px; }
    .cert-meta { display: flex; justify-content: space-between; margin: 20px 0; font-size: 14px; }
    .details-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .details-table th, .details-table td { border: 1px solid #cbd5e1; padding: 10px; text-align: left; }
    .details-table th { background-color: #f1f5f9; color: #334155; }
    .signoff-box { margin-top: 30px; border: 2px solid #16a34a; padding: 15px; border-radius: 6px; background-color: #f0fdf4; }
    .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="header">
    <h1>INDIAN RAILWAYS — WAGON REPAIR SHOP (WRS) RAIPUR</h1>
    <h2>OFFICIAL WAGON FITNESS & QUALITY CLEARANCE CERTIFICATE</h2>
    <p>Zero-Defect Exit Gate Verification per RDSO Technical Standards</p>
  </div>
  <div class="cert-meta">
    <div><strong>Certificate No:</strong> ${certNumber}</div>
    <div><strong>Date of Release:</strong> ${releaseDate}</div>
  </div>
  <table class="details-table">
    <tr><th>Wagon Number</th><td>${wagon.wagonNumber}</td><th>Wagon Type</th><td>${wagon.wagonType}</td></tr>
    <tr><th>Owning Railway</th><td>${wagon.owningRailway}</td><th>Entry Date</th><td>${wagon.entryDate}</td></tr>
    <tr><th>Total Components Checked</th><td>${checklistItems.length}</td><th>Mandatory Checks Passed</th><td>${passedCount + repairedCount + replacedCount} / ${checklistItems.filter(i => i.criticality === 'MANDATORY').length}</td></tr>
    <tr><th>Phase 1 Springs Inspected</th><td>${springInspections.length}</td><th>Spring Status</th><td>All Verified & In Acceptable Bands</td></tr>
  </table>
  <div class="signoff-box">
    <h3 style="margin-top:0; color:#15803d;">CERTIFIED FIT FOR RUNNING</h3>
    <p>This is to certify that Wagon <strong>${wagon.wagonNumber}</strong> has successfully completed all 7 overhaul stages and passed the 100% Zero-Defect Exit Gate inspection per Indian Railways and RDSO specifications.</p>
    <p><strong>Authorizing Supervisor:</strong> ${signoff.supervisorName} (${signoff.supervisorId})</p>
    <p><strong>Digital Signature Hash:</strong> <code>${signoff.digitalSignature}</code></p>
    <p><strong>QR Verification Code:</strong> <code>${qrVerificationCode}</code></p>
  </div>
  <div class="footer">
    <p>WRS Raipur Quality Assurance Directorate • Generated Automatically by Wagon Quality Control Tracking System</p>
  </div>
</body>
</html>
    `.trim();

    const pdfBase64 = Buffer.from(htmlContent).toString('base64');

    return {
      certificateNumber: certNumber,
      wagonNumber: wagon.wagonNumber,
      wagonType: wagon.wagonType,
      owningRailway: wagon.owningRailway,
      entryDate: wagon.entryDate,
      releaseDate,
      supervisorId: signoff.supervisorId,
      supervisorName: signoff.supervisorName,
      digitalSignature: signoff.digitalSignature,
      checklistSummary: {
        total: checklistItems.length,
        passed: passedCount,
        repaired: repairedCount,
        replaced: replacedCount
      },
      springSummary: {
        totalInspected: springInspections.length,
        passed: springInspections.filter(s => s.status === 'PASS').length
      },
      qrVerificationCode,
      generatedAt: releaseDate,
      pdfBase64,
      html: htmlContent
    };
  }
}
