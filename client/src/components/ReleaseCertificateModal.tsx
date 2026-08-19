/**
 * Printable RDSO Release Certificate Viewer Modal
 * Indian Railways WRS Raipur (Phase 2 - R3)
 */

import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { useI18n } from '../i18n/index.ts';

interface ReleaseCertificateModalProps {
  wagonNumber: string;
  onClose: () => void;
}

export const ReleaseCertificateModal: React.FC<ReleaseCertificateModalProps> = ({
  wagonNumber,
  onClose
}) => {
  const { t } = useI18n();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-850">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span className="text-emerald-400">📜</span>
              {t('actions.viewCertificate')} — {wagonNumber}
            </h3>
            <p className="text-xs text-slate-400">Form RDSO/WRS/QC-REL (Bogie & Brake Certified)</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              disabled={loading || !!error}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-md"
            >
              🖨️ {t('actions.printCertificate')}
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 text-base"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Certificate Frame Body */}
        <div className="flex-1 bg-slate-950 p-4 overflow-auto flex items-center justify-center min-h-[500px]">
          {loading ? (
            <div className="text-slate-400 flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <span>Generating official release certificate...</span>
            </div>
          ) : error ? (
            <div className="text-center p-8 bg-rose-950/30 border border-rose-800/60 rounded-xl text-rose-300 space-y-2">
              <p className="font-bold">Certificate Not Available</p>
              <p className="text-xs text-rose-400">{error}</p>
            </div>
          ) : (
            <iframe
              id="cert-iframe"
              title={`RDSO Certificate ${wagonNumber}`}
              srcDoc={certHtml || ''}
              className="w-full h-[650px] bg-white rounded shadow-2xl border border-slate-300"
            />
          )}
        </div>
      </div>
    </div>
  );
};
