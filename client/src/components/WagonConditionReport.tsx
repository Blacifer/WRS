/**
 * What came in, what we did, what left
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * Every part of this was already recorded and none of it was ever shown
 * together. A checklist row carries the finding, the note the inspector
 * typed, the repair action, the re-inspection verdict, and the name and time
 * against each — but the app rendered it as a list of current statuses, which
 * is the one view that throws away the history. Ask "what was wrong with this
 * wagon when it arrived, and what did we do about it" and the answer had to be
 * reconstructed by reading the audit log.
 *
 * That question is the report a workshop writes by hand today, and it is the
 * one a DRM, a receiving railway or an auditor actually asks. The certificate
 * says a wagon is fit to leave. This says what it took to get there.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It states no verdict of its own and computes no score. Every line is a
 * record somebody made, attributed to them, with the time they made it. Where
 * a component was never inspected it says so rather than leaving a gap that
 * reads as a pass — the same rule the certificate follows for an empty
 * component manifest.
 */

import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.ts';
import type { ChecklistItem, WagonRecord, WagonPhotoRecord, InspectionRecord } from '../../../shared/types.ts';

interface WagonConditionReportProps {
  wagon: WagonRecord;
  categories: Record<string, ChecklistItem[]>;
  photos: WagonPhotoRecord[];
  gateStatus: any;
  lang: 'en' | 'hi';
}

/** Statuses that mean somebody found something. */
const FINDING_STATUSES = ['FAIL', 'CONDEMNED', 'REPAIRED', 'REPLACED'];

const CATEGORY_LABELS: Record<string, string> = {
  SPRINGS: 'Springs',
  WHEELS_AXLES: 'Wheels & Axles',
  BEARINGS: 'Bearings',
  BRAKE_SYSTEM: 'Brake System',
  COUPLERS_DRAFT_GEAR: 'Couplers & Draft Gear',
  BOGIE_FRAME_BOLSTER: 'Bogie Frame & Bolster',
  BODY_UNDERFRAME: 'Body & Underframe',
  GENERAL_WAGON: 'General'
};

const fmt = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

export const WagonConditionReport: React.FC<WagonConditionReportProps> = ({
  wagon, categories, photos, gateStatus, lang
}) => {
  const isHi = lang === 'hi';
  const [springs, setSprings] = useState<InspectionRecord[]>([]);
  const [history, setHistory] = useState<any[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.queryInspections({ wagonNumber: wagon.wagonNumber, limit: 200 })
      .then((res) => { if (!cancelled) setSprings(res.records || []); })
      .catch(() => { if (!cancelled) setSprings([]); });
    return () => { cancelled = true; };
  }, [wagon.wagonNumber]);

  useEffect(() => {
    let cancelled = false;
    api.getChecklistHistory(wagon.wagonNumber)
      .then((res) => { if (!cancelled) setHistory(res.events || []); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [wagon.wagonNumber]);

  /*
   * The finding, as opposed to the outcome.
   *
   * A checklist row is updated in place, so its status ends up holding what
   * the part BECAME. Printing that under "found" produced the same word twice
   * — "found REPAIRED, work done REPAIRED" — which is not a before and after
   * and quietly overstates what is known.
   *
   * The first transition away from PENDING is the moment somebody looked at
   * the part and said what it was. Where no such event exists — a row seeded
   * outside the inspection path, or work done before this was recorded — the
   * report says the arrival state was not recorded rather than falling back
   * to the current status under a heading that would misdescribe it.
   */
  const arrivalByItem = useMemo(() => {
    const map = new Map<string, { status: string; notes: string | null; at: string }>();
    for (const e of history || []) {
      if (!e?.itemId || !e.newStatus || e.newStatus === 'PENDING') continue;
      if (map.has(e.itemId)) continue;   // events arrive oldest first
      map.set(e.itemId, { status: e.newStatus, notes: e.conditionNotes ?? null, at: e.at });
    }
    return map;
  }, [history]);

  const allItems = useMemo(
    () => Object.values(categories || {}).flat() as ChecklistItem[],
    [categories]
  );

  const findings = useMemo(
    () => allItems
      .filter((i) => FINDING_STATUSES.includes(i.status) || !!i.repairAction)
      .sort((a, b) => (a.category || '').localeCompare(b.category || '')),
    [allItems]
  );

  const clean = allItems.filter((i) => i.status === 'PASS' && !i.repairAction);
  const notInspected = allItems.filter((i) => i.status === 'PENDING');

  /* A photograph is attached to a checklist row by id, so the finding it
   * belongs to can show it rather than the gallery being a separate place a
   * reader has to correlate by hand. */
  /*
   * The photographs belonging to one finding, separated by what they show.
   *
   * A repair produces two pictures that mean different things, and a report
   * that prints one of them at random settles nothing. Matched by checklist
   * id where the photograph has one, and by part otherwise — an older
   * photograph, or one taken before the link was carried offline, still finds
   * its finding.
   */
  const photosFor = (item: ChecklistItem) => {
    const mine = photos.filter(
      (p) => p.checklistItemId === item.id
        || (p.partName === item.partName && (p.category || p.partCategory) === item.category)
    );
    const stage = (s2: string) => mine.find((p) => (p as any).evidenceStage === s2);
    return {
      before: stage('BEFORE'),
      after: stage('AFTER'),
      // Anything not labelled still gets shown rather than hidden: every
      // photograph taken before this field was wired has no stage at all.
      any: stage('DEFECT') || mine.find((p) => !(p as any).evidenceStage) || mine[0]
    };
  };

  const released = wagon.currentStage === 'RELEASE';
  const condemnedSprings = springs.filter((s) => s.status === 'CONDEMNED');

  const t = (en: string, hi: string) => (isHi ? hi : en);

  /*
   * The printed report.
   *
   * A DRM or a receiving railway wants paper, and the screen is not paper —
   * dark, scrollable, and dependent on a tablet being in the room. This
   * builds the same content as a plain document in its own window.
   *
   * It is generated from the SAME derived arrays the screen renders, so the
   * two cannot drift apart and print something the app does not show. Where a
   * fact is unknown it prints the same words the screen uses — "not recorded"
   * rather than a blank, because a blank cell on paper reads as nothing to
   * report.
   */
  const printReport = () => {
    const esc = (v: unknown) =>
      String(v ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const findingRows = findings.map((item) => {
      const a = arrivalByItem.get(item.id);
      const shots = photosFor(item);
      return `
        <tr>
          <td><strong>${esc(item.partName)}</strong><br><span class="sub">${esc(CATEGORY_LABELS[item.category] || item.category)}${
            item.bogiePosition && item.bogiePosition !== 'NONE' ? ' · ' + esc(item.bogiePosition) : ''
          }</span></td>
          <td>${a ? esc(a.status) : '<span class="muted">not recorded</span>'}${
            a?.notes || item.conditionNotes ? `<br><span class="sub">“${esc(a?.notes || item.conditionNotes)}”</span>` : ''
          }</td>
          <td>${item.repairAction ? esc(item.repairAction) : '<span class="muted">not recorded</span>'}${
            item.repairNotes ? `<br><span class="sub">“${esc(item.repairNotes)}”</span>` : ''
          }</td>
          <td>${item.reinspectedStatus ? esc(item.reinspectedStatus) : '<span class="muted">re-inspection not recorded</span>'}</td>
          <td class="sub">${esc(item.inspectedByName || '—')}<br>${esc(fmt(a?.at || item.updatedAt))}</td>
          <td>${
            [[shots.before, 'before'], [shots.after, 'after'],
             [!shots.before && !shots.after ? shots.any : null, '']]
              .map(([shot, label]) => shot
                ? `<figure style="display:inline-block;margin:0 4px 0 0"><img class="ev" src="${esc((shot as any).imageBase64 || (shot as any).imageData)}">` +
                  `${label ? `<figcaption class="sub">${label}</figcaption>` : ''}</figure>`
                : '')
              .join('')
          }</td>
        </tr>`;
    }).join('');

    const springRows = springs.map((s2) => `
      <tr>
        <td>${esc(s2.springPosition)}</td>
        <td>${esc(s2.bogiePosition || '—')}</td>
        <td class="num">${esc(s2.measuredFreeHeight)}${s2.heightIsApproximate ? '≈' : ''} mm</td>
        <td>${esc(s2.classifiedBand || '—')}</td>
        <td><strong>${esc(s2.status)}</strong></td>
        <td class="sub">${esc(s2.inspectorName || '—')}</td>
      </tr>`).join('');

    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Condition Report ${esc(wagon.wagonNumber)}</title>
<style>
  body { font: 11px/1.45 system-ui, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  h2 { font-size: 12px; margin: 18px 0 6px; border-bottom: 1.5px solid #111; padding-bottom: 3px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
  .mono { font-family: ui-monospace, monospace; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .04em;
       border-bottom: 1px solid #666; padding: 4px 6px 4px 0; }
  td { border-bottom: 1px solid #ddd; padding: 5px 6px 5px 0; vertical-align: top; }
  .sub { font-size: 9.5px; color: #555; }
  .muted { color: #777; font-style: italic; }
  /* Left, to sit under a left-aligned header: right-aligning the value alone
     pushed the height against the band beside it on paper. */
  .num { font-family: ui-monospace, monospace; white-space: nowrap; }
  .ev { max-width: 90px; max-height: 62px; border: 1px solid #bbb; }
  .stats { display: flex; gap: 18px; margin: 10px 0 4px; }
  .stat b { display: block; font-size: 17px; }
  .stat span { font-size: 9px; text-transform: uppercase; color: #555; }
  .note { border: 1px solid #999; padding: 6px 8px; margin-top: 8px; font-size: 10px; }
  @media print { body { margin: 12mm; } tr { break-inside: avoid; } }
</style></head><body>
  <div class="head">
    <div>
      <h1>Wagon Condition Report</h1>
      <div class="sub">What arrived, what was done to it, and what left. Every line attributed to the person who recorded it.</div>
    </div>
    <div style="text-align:right">
      <div class="mono"><strong>${esc(wagon.wagonNumber)}</strong></div>
      <div class="sub">${esc(wagon.wagonType)} · ${esc(wagon.owningRailway)}</div>
      <div class="sub">In ${esc(fmt(wagon.entryDate))}</div>
      <div class="sub">Printed ${esc(fmt(new Date().toISOString()))}</div>
    </div>
  </div>

  <div class="stats">
    <div class="stat"><b>${allItems.length}</b><span>components checked</span></div>
    <div class="stat"><b>${findings.length}</b><span>findings raised</span></div>
    <div class="stat"><b>${springs.length}</b><span>springs measured</span></div>
    <div class="stat"><b>${condemnedSprings.length}</b><span>springs condemned</span></div>
    <div class="stat"><b>${notInspected.length}</b><span>not yet inspected</span></div>
  </div>

  <h2>1. Findings, and what was done about each</h2>
  ${findings.length
    ? `<table><thead><tr><th>Assembly / Part</th><th>Found as</th><th>Work done</th><th>Left as</th><th>Recorded by</th><th>Evidence</th></tr></thead><tbody>${findingRows}</tbody></table>`
    : '<p class="muted">No component on this wagon was recorded as failed, condemned, repaired or replaced.</p>'}

  <h2>2. Spring readings</h2>
  ${springs.length
    ? `<table><thead><tr><th>Position</th><th>Bogie</th><th>Height</th><th>Band</th><th>Verdict</th><th>Recorded by</th></tr></thead><tbody>${springRows}</tbody></table>`
    : '<p class="muted">No spring free-height reading has been recorded against this wagon. This section makes no statement about its springs.</p>'}

  <h2>3. Components cleared without a finding</h2>
  <p>${clean.length} of ${allItems.length} checked components were passed with nothing recorded against them.</p>
  <p class="sub">${clean.map((i) => esc(i.partName)).join(' · ') || '—'}</p>
  ${notInspected.length
    ? `<div class="note"><strong>${notInspected.length} component(s) have not been inspected.</strong> They are listed as pending, not as passed.<br>
       <span class="sub">${notInspected.map((i) => esc(i.partName)).join(' · ')}</span></div>`
    : ''}

  <h2>4. Release</h2>
  ${released
    ? '<p>Released. The signed certificate records the findings accepted at sign-off.</p>'
    : `<p>${gateStatus?.canRelease
          ? 'The exit gate is clear. This wagon has not been signed off yet.'
          : 'The exit gate is holding this wagon.'}</p>
       ${(gateStatus?.blockers || []).length
          ? '<ul>' + gateStatus.blockers.map((b: string) => `<li>${esc(b)}</li>`).join('') + '</ul>' : ''}
       ${(gateStatus?.advisories || []).length
          ? '<ul>' + gateStatus.advisories.map((a: string) => `<li>Advisory: ${esc(a)}</li>`).join('') + '</ul>' : ''}`}

  <p class="sub" style="margin-top:18px;border-top:1px solid #999;padding-top:6px">
    Generated by the WRS Raipur Bogie &amp; Wagon QC system. This report states what is recorded; it is not a release certificate.
  </p>
</body></html>`;

    const w = window.open('', '_blank');
    if (!w) return;   // pop-up blocked; nothing is lost, the screen still has it
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  const Stat = ({ label, value, tone }: { label: string; value: string | number; tone?: string }) => (
    <div className={`rounded-control border p-3 ${tone || 'border-line bg-raised'}`}>
      <p className="text-2xl font-black text-white tabular-nums leading-none">{value}</p>
      <p className="text-[11px] font-bold text-ink-muted mt-1 leading-snug">{label}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------------ */}
      <section className="bg-card border border-line rounded-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-black text-white">
              {t('Wagon Condition Report', 'वैगन स्थिति रिपोर्ट')}
            </h2>
            <p className="text-xs text-ink-muted mt-1">
              {t(
                'What arrived, what was done to it, and what left — every line attributed to the person who recorded it.',
                'क्या आया, उस पर क्या काम हुआ, और क्या निकला — हर पंक्ति उस व्यक्ति के नाम के साथ जिसने दर्ज किया।'
              )}
            </p>
          </div>
          <div className="text-right space-y-2">
            <p className="font-mono text-sm font-black text-white">{wagon.wagonNumber}</p>
            <p className="text-[11px] text-ink-muted">
              {wagon.wagonType} · {wagon.owningRailway} · {t('in', 'प्रवेश')} {fmt(wagon.entryDate)}
            </p>
            <button
              onClick={printReport}
              className="min-h-[36px] px-3 rounded-control border border-line-strong text-xs font-bold text-ink-body hover:text-white"
            >
              🖨 {t('Print report', 'रिपोर्ट प्रिंट करें')}
            </button>
          </div>
        </div>

        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          <Stat label={t('components checked', 'जाँचे गए पुर्जे')} value={allItems.length} />
          <Stat
            label={t('findings raised', 'पाई गई समस्याएँ')}
            value={findings.length}
            tone={findings.length ? 'border-warn-line bg-warn-soft' : undefined}
          />
          <Stat label={t('springs measured', 'मापे गए स्प्रिंग')} value={springs.length} />
          <Stat
            label={t('springs condemned', 'निंदित स्प्रिंग')}
            value={condemnedSprings.length}
            tone={condemnedSprings.length ? 'border-bad-line bg-bad-soft' : undefined}
          />
          <Stat
            label={t('not yet inspected', 'अभी जाँच नहीं')}
            value={notInspected.length}
            tone={notInspected.length ? 'border-warn-line bg-warn-soft' : undefined}
          />
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="bg-card border border-line rounded-card p-6 space-y-4">
        <h3 className="text-sm font-black text-white">
          {t('1. Findings, and what was done about each', '1. पाई गई समस्याएँ और उन पर की गई कार्रवाई')}
        </h3>

        {findings.length === 0 ? (
          <p className="text-xs text-ink-muted">
            {t(
              'No component on this wagon was recorded as failed, condemned, repaired or replaced.',
              'इस वैगन के किसी पुर्जे को असफल, निंदित, मरम्मत या प्रतिस्थापित दर्ज नहीं किया गया।'
            )}
          </p>
        ) : (
          <div className="space-y-3">
            {findings.map((item) => {
              const shots = photosFor(item);
              const cleared = item.reinspectedStatus === 'PASS';
              const arrival = arrivalByItem.get(item.id);
              return (
                <div key={item.id} className="rounded-control border border-line bg-raised p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-black text-white">{item.partName}</p>
                      <p className="text-[11px] font-mono uppercase tracking-wide text-ink-muted">
                        {CATEGORY_LABELS[item.category] || item.category}
                        {item.bogiePosition && item.bogiePosition !== 'NONE' ? ` · ${item.bogiePosition}` : ''}
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-black px-2 py-1 rounded ${
                        cleared ? 'bg-good-soft text-good-ink' : 'bg-warn-soft text-warn-ink'
                      }`}
                    >
                      {cleared ? t('CLEARED ON RE-INSPECTION', 'पुनः जाँच में उत्तीर्ण') : t('OPEN', 'लंबित')}
                    </span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3 mt-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wide text-ink-muted">
                        {t('Found as', 'किस हालत में मिला')}
                      </p>
                      {arrival ? (
                        <>
                          <p className="text-xs font-bold text-white mt-1">{arrival.status}</p>
                          {(arrival.notes || item.conditionNotes) && (
                            <p className="text-[11px] text-ink-body mt-1 leading-snug">
                              “{arrival.notes || item.conditionNotes}”
                            </p>
                          )}
                          <p className="text-[10px] text-ink-muted mt-1">
                            {item.inspectedByName || '—'} · {fmt(arrival.at)}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs font-bold text-ink-muted mt-1">
                            {t('not recorded', 'दर्ज नहीं')}
                          </p>
                          <p className="text-[10px] text-ink-muted mt-1 leading-snug">
                            {t(
                              'No inspection event exists for this part, so what it arrived as is unknown. Its current status is ' + item.status + '.',
                              'इस पुर्जे के लिए कोई जाँच घटना दर्ज नहीं है। वर्तमान स्थिति ' + item.status + ' है।'
                            )}
                          </p>
                        </>
                      )}
                    </div>

                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wide text-ink-muted">
                        {t('Work done', 'की गई कार्रवाई')}
                      </p>
                      <p className="text-xs font-bold text-white mt-1">
                        {item.repairAction || t('not recorded', 'दर्ज नहीं')}
                      </p>
                      {item.repairNotes && (
                        <p className="text-[11px] text-ink-body mt-1 leading-snug">“{item.repairNotes}”</p>
                      )}
                    </div>

                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wide text-ink-muted">
                        {t('Left as', 'निकलते समय')}
                      </p>
                      <p className="text-xs font-bold text-white mt-1">
                        {item.reinspectedStatus || t('re-inspection not recorded', 'पुनः जाँच दर्ज नहीं')}
                      </p>
                      {(shots.after || shots.before || shots.any) && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {[
                            [shots.before, t('before', 'पहले')],
                            [shots.after, t('after', 'बाद')],
                            [!shots.before && !shots.after ? shots.any : null, t('evidence', 'साक्ष्य')]
                          ].map(([shot, label], i) =>
                            shot ? (
                              <figure key={i} className="m-0">
                                <img
                                  src={(shot as any).imageBase64 || (shot as any).imageData}
                                  alt={`${item.partName} — ${label}`}
                                  className="rounded border border-line max-h-24 object-cover"
                                />
                                <figcaption className="text-[9px] uppercase tracking-wide text-ink-muted mt-0.5">
                                  {label as string}
                                </figcaption>
                              </figure>
                            ) : null
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="bg-card border border-line rounded-card p-6 space-y-3">
        <h3 className="text-sm font-black text-white">
          {t('2. Spring readings', '2. स्प्रिंग रीडिंग')}
        </h3>
        {springs.length === 0 ? (
          <p className="text-xs text-ink-muted">
            {t(
              'No spring free-height reading has been recorded against this wagon. This section makes no statement about its springs.',
              'इस वैगन के लिए कोई स्प्रिंग फ्री-हाइट रीडिंग दर्ज नहीं है। यह अनुभाग इसके स्प्रिंग के बारे में कोई दावा नहीं करता।'
            )}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-ink-muted text-[10px] uppercase tracking-wide">
                  <th className="text-left py-1">{t('Position', 'स्थिति')}</th>
                  <th className="text-left py-1">{t('Bogie', 'बोगी')}</th>
                  <th className="text-right py-1">{t('Height', 'ऊँचाई')}</th>
                  <th className="text-left py-1 pl-3">{t('Band', 'बैंड')}</th>
                  <th className="text-left py-1">{t('Verdict', 'निर्णय')}</th>
                  <th className="text-left py-1">{t('Recorded by', 'दर्ज करने वाला')}</th>
                </tr>
              </thead>
              <tbody>
                {springs.map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="py-1 font-bold text-white">{s.springPosition}</td>
                    <td className="py-1 text-ink-body">{s.bogiePosition || '—'}</td>
                    <td className="py-1 text-right font-mono text-white">
                      {s.measuredFreeHeight?.toFixed?.(1) ?? s.measuredFreeHeight}
                      {s.heightIsApproximate ? '≈' : ''} mm
                    </td>
                    <td className="py-1 pl-3 text-ink-body">{s.classifiedBand || '—'}</td>
                    <td className={`py-1 font-bold ${s.status === 'CONDEMNED' ? 'text-bad-ink' : 'text-good-ink'}`}>
                      {s.status}
                    </td>
                    <td className="py-1 text-ink-muted">{s.inspectorName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="bg-card border border-line rounded-card p-6 space-y-3">
        <h3 className="text-sm font-black text-white">
          {t('3. Components cleared without a finding', '3. बिना समस्या के उत्तीर्ण पुर्जे')}
        </h3>
        <p className="text-[11px] text-ink-muted">
          {t(
            `${clean.length} of ${allItems.length} checked components were passed with nothing recorded against them.`,
            `${allItems.length} में से ${clean.length} पुर्जे बिना किसी टिप्पणी के उत्तीर्ण हुए।`
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {clean.map((i) => (
            <span key={i.id} className="text-[10px] font-mono px-2 py-0.5 rounded bg-raised border border-line text-ink-body">
              {i.partName}
            </span>
          ))}
        </div>
        {notInspected.length > 0 && (
          <div className="rounded-control border border-warn-line bg-warn-soft p-3 mt-2">
            <p className="text-[11px] font-bold text-warn-ink">
              {t(
                `${notInspected.length} component(s) have not been inspected. They are listed as pending, not as passed.`,
                `${notInspected.length} पुर्जों की जाँच नहीं हुई। वे लंबित हैं, उत्तीर्ण नहीं।`
              )}
            </p>
            <p className="text-[10px] text-ink-body mt-1">
              {notInspected.map((i) => i.partName).join(', ')}
            </p>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="bg-card border border-line rounded-card p-6 space-y-3">
        <h3 className="text-sm font-black text-white">{t('4. Release', '4. रिलीज़')}</h3>
        {released ? (
          <p className="text-xs text-good-ink font-bold">
            {t('Released. The signed certificate records the findings accepted at sign-off.',
               'रिलीज़ किया गया। हस्ताक्षरित प्रमाणपत्र साइन-ऑफ़ पर स्वीकृत निष्कर्ष दर्ज करता है।')}
          </p>
        ) : (
          <>
            <p className="text-xs text-ink-body">
              {gateStatus?.canRelease
                ? t('The exit gate is clear. This wagon has not been signed off yet.',
                    'निकास गेट स्पष्ट है। इस वैगन पर अभी हस्ताक्षर नहीं हुए।')
                : t('The exit gate is holding this wagon.', 'निकास गेट इस वैगन को रोक रहा है।')}
            </p>
            {(gateStatus?.blockers || []).length > 0 && (
              <ul className="space-y-1">
                {gateStatus.blockers.map((b: string, i: number) => (
                  <li key={i} className="text-[11px] text-bad-ink leading-snug">• {b}</li>
                ))}
              </ul>
            )}
            {(gateStatus?.advisories || []).length > 0 && (
              <ul className="space-y-1 pt-1">
                {gateStatus.advisories.map((a: string, i: number) => (
                  <li key={i} className="text-[11px] text-warn-ink leading-snug">⚠ {a}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default WagonConditionReport;
