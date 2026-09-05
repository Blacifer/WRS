/**
 * Printable RDSO Release Certificate Viewer Modal
 * Indian Railways WRS Raipur (Phase 2 - R3)
 */

import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { useI18n } from '../i18n/index.ts';
import { DownloadIcon, FileTextIcon } from './Icons.tsx';

interface ReleaseCertificateModalProps {
  wagonNumber: string;
  onClose: () => void;
}

export const ReleaseCertificateModal: React.FC<ReleaseCertificateModalProps> = ({
  wagonNumber,
  onClose
}) => {
  const { t, lang } = useI18n();
  const isHi = lang === 'hi';
  const [certHtml, setCertHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCert();
  }, [wagonNumber]);

  const fetchCert = async () => {
    try {
      setLoading(true);
      setError(null);
      const html = await api.getReleaseCertificate(wagonNumber, 'html');
      setCertHtml(html);
    } catch (err: any) {
      setError(err.message || 'Failed to load release certificate');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    const iframe = document.getElementById('cert-iframe') as HTMLIFrameElement;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-page backdrop-blur-md p-4">
      <div className="bg-card border border-line rounded-control w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-line flex justify-between items-center bg-raised">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span className="text-good-ink"><FileTextIcon size={18} /></span>
              {t('actions.viewCertificate')} — {wagonNumber}
            </h3>
            <p className="text-xs text-ink-muted">Form RDSO/WRS/QC-REL (Bogie & Brake Certified)</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              disabled={loading || !!error}
              className="px-4 py-2 bg-accent hover:bg-accent disabled:opacity-50 text-white rounded-control text-xs font-bold transition flex items-center gap-1.5 shadow-md"
            >
              <DownloadIcon size={15} className="inline align-[-2px] mr-1.5" />{t('actions.printCertificate')}
            </button>
            <button
              onClick={onClose}
              className="text-ink-muted hover:text-white p-2 rounded-control hover:bg-raised text-base"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Certificate Frame Body */}
        <div className="flex-1 bg-page p-4 overflow-auto flex items-center justify-center min-h-[500px]">
          {loading ? (
            <div className="text-ink-muted flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-accent-line border-t-transparent rounded-full animate-spin"></div>
              <span>Generating official release certificate...</span>
            </div>
          ) : error ? (
            <div className="text-center p-8 bg-bad-soft border border-bad-line rounded-control text-bad-ink space-y-2">
              <p className="font-bold">{isHi ? 'प्रमाणपत्र उपलब्ध नहीं' : 'Certificate Not Available'}</p>
              <p className="text-xs text-bad-ink">{error}</p>
            </div>
          ) : (
            <iframe
              id="cert-iframe"
              title={`RDSO Certificate ${wagonNumber}`}
              srcDoc={certHtml || ''}
              className="w-full h-[650px] bg-white rounded border border-slate-300"
            />
          )}
        </div>
      </div>
    </div>
  );
};
