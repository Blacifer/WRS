/**
 * Whether this installation is being backed up, and how large it has become
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * The database holds every inspection, every release certificate and the whole
 * hash-chained audit log. `server/scripts/backup-db.sh` exists to protect it —
 * encrypted, verified, refusing to run without a key rather than quietly
 * producing a plaintext copy. Nothing schedules it, and nothing anywhere
 * reported whether it had ever run.
 *
 * That is the failure worth designing against, because it is silent. A backup
 * job that stops produces no error, only an absence, and an absence is noticed
 * at exactly the moment the file is needed and never before.
 *
 * This panel does not take backups and does not pretend to — scheduling
 * belongs to the host. What it removes is the silence.
 *
 * WHY SIZE IS HERE TOO
 * --------------------
 * Evidence photographs live as base64 in the same file. A workshop that starts
 * photographing everything should be able to see the consequence coming rather
 * than discover it, and the same screen that says "you are not backed up"
 * should say how much there is to back up.
 *
 * Administrator only. It renders nothing for anyone else, including the DRM:
 * this is the state of the installation, not of the workshop's work.
 */

import { useEffect, useState } from 'react';
import { api } from '../services/api.ts';

interface SystemStorageProps {
  lang: 'en' | 'hi';
}

interface Storage {
  databaseBytes: number;
  photoCount: number;
  photoBytes: number;
  inspectionCount: number;
  auditEventCount: number;
  backup: {
    directory: string;
    count: number;
    newestAt: string | null;
    newestBytes: number | null;
    ageHours: number | null;
    state: 'NEVER' | 'RECENT' | 'STALE';
  };
}

const mb = (bytes: number) => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
};

const age = (hours: number | null) => {
  if (hours === null) return '—';
  if (hours < 1) return 'under an hour ago';
  if (hours < 48) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
};

export const SystemStorage: React.FC<SystemStorageProps> = ({ lang }) => {
  const isHi = lang === 'hi';
  const [s, setS] = useState<Storage | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getSystemStorage()
      .then((res: any) => { if (!cancelled) setS(res?.data || null); })
      // A refusal is the expected answer for everyone but an administrator,
      // and is not worth a message on their screen.
      .catch(() => { if (!cancelled) setS(null); });
    return () => { cancelled = true; };
  }, []);

  if (!s) return null;

  const t = (en: string, hi: string) => (isHi ? hi : en);
  const b = s.backup;

  const tone =
    b.state === 'RECENT' ? 'border-good-line bg-good-soft'
    : b.state === 'STALE' ? 'border-warn-line bg-warn-soft'
    : 'border-bad-line bg-bad-soft';

  const headline =
    b.state === 'RECENT'
      ? t(`Last backup ${age(b.ageHours)}`, `पिछला बैकअप ${age(b.ageHours)}`)
      : b.state === 'STALE'
      ? t(`Last backup was ${age(b.ageHours)}`, `पिछला बैकअप ${age(b.ageHours)}`)
      : t('No backup has ever been taken', 'अभी तक कोई बैकअप नहीं लिया गया');

  return (
    <section className="bg-card border border-line rounded-card p-6 space-y-4">
      <div>
        <h2 className="text-xl font-black text-white flex items-center gap-2">
          <span>💾</span> {t('This installation', 'यह इंस्टॉलेशन')}
        </h2>
        <p className="text-xs text-ink-muted mt-1">
          {t(
            'The database holds every inspection, every certificate and the whole audit chain.',
            'डेटाबेस में हर जाँच, हर प्रमाणपत्र और पूरी ऑडिट शृंखला है।'
          )}
        </p>
      </div>

      <div className={`rounded-control border p-4 ${tone}`}>
        <p className="text-base font-black text-white">{headline}</p>
        {b.state === 'NEVER' ? (
          <p className="text-xs text-ink-body mt-1.5 leading-relaxed">
            {t(
              'A backup job that stops running reports nothing — it produces an absence, and an absence is noticed only when the file is needed. Run server/scripts/backup-db.sh on a schedule on this host.',
              'बैकअप न होने पर कोई त्रुटि नहीं आती। इस होस्ट पर server/scripts/backup-db.sh को नियमित रूप से चलाएँ।'
            )}
          </p>
        ) : (
          <p className="text-xs text-ink-body mt-1.5">
            {b.count} {t('encrypted backup(s) retained', 'एन्क्रिप्टेड बैकअप')}
            {b.newestBytes ? ` · ${t('newest', 'नवीनतम')} ${mb(b.newestBytes)}` : ''}
          </p>
        )}
        <p className="text-[10px] font-mono text-ink-muted mt-2 break-all">{b.directory}</p>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {[
          { label: t('database on disk', 'डिस्क पर डेटाबेस'), value: mb(s.databaseBytes) },
          { label: t('photographs', 'तस्वीरें'), value: `${s.photoCount}` },
          { label: t('photo data', 'फ़ोटो डेटा'), value: mb(s.photoBytes) },
          { label: t('audit events', 'ऑडिट घटनाएँ'), value: `${s.auditEventCount}` }
        ].map((x) => (
          <div key={x.label} className="rounded-control border border-line bg-raised p-3">
            <p className="text-lg font-black text-white tabular-nums leading-none">{x.value}</p>
            <p className="text-[11px] font-bold text-ink-muted mt-1 leading-snug">{x.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

export default SystemStorage;
