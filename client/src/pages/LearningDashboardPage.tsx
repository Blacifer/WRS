/**
 * Machine Learning Feedback Dashboard
 * Indian Railways WRS Raipur
 *
 * Shows what the system has learned from inspectors correcting it, and holds
 * the approval gate for anything it proposes to change about itself.
 *
 * Deliberately readable by a supervisor rather than a data scientist: how
 * often the machine was right, whether it knows when it is unsure, where it
 * reliably fails, and what it wants to change — with the evidence attached.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api.ts';
import type { LanguageCode } from '../i18n/index.ts';
import type { User } from '../../../shared/types.ts';
import { LearningMemory } from '../components/LearningMemory.tsx';

interface LearningDashboardPageProps {
  lang: LanguageCode;
  user: User | null;
}

const SUBSYSTEM_LABELS: Record<string, string> = {
  OCR_CALIPER: 'Caliper OCR',
  SPRING_CLASSIFICATION: 'Spring Classification',
  VOICE_COMMAND: 'Voice Commands',
  ACOUSTIC_DIAGNOSTIC: 'Acoustic Diagnostics',
  DEFECT_SUGGESTION: 'Defect Suggestions',
  MEASUREMENT_ANOMALY: 'Unusual Readings'
};

export const LearningDashboardPage: React.FC<LearningDashboardPageProps> = ({ lang, user }) => {
  const isHi = lang === 'hi';
  const isAdmin = user?.role?.toUpperCase() === 'ADMIN';

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getLearningDashboard();
      setData(res.data);
    } catch (e: any) {
      setError(e?.message || 'Could not load learning data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runAnalysis = async () => {
    setBusyKey('__analyze__');
    try {
      await api.runLearningAnalysis();
      await load();
    } catch (e: any) {
      setError(e?.message || 'Analysis failed');
    } finally {
      setBusyKey(null);
    }
  };

  const decide = async (paramKey: string, decision: 'APPROVE' | 'REJECT') => {
    setBusyKey(paramKey);
    try {
      await api.decideLearningProposal(paramKey, decision);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not apply decision');
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-ink-muted text-sm">
        {isHi ? 'लोड हो रहा है…' : 'Loading learning data…'}
      </div>
    );
  }

  const accuracy: any[] = data?.accuracy || [];
  const insights: any[] = data?.insights || [];
  const parameters: any[] = data?.parameters || [];
  const calibration: any[] = data?.ocrCalibration || [];
  const pending = parameters.filter((p) => p.approval_status === 'PENDING');
  const totalEvents = accuracy.reduce((s, a) => s + (a.totalEvents || 0), 0);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 bg-card border border-accent-line rounded-card">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            {isHi ? 'सिस्टम अधिगम (Learning)' : 'What the System Has Learned'}
          </h1>
          <p className="text-xs text-ink-muted mt-1 max-w-2xl leading-relaxed">
            {isHi
              ? 'हर बार जब कोई निरीक्षक मशीन के सुझाव को सुधारता है, वह एक प्रशिक्षण संकेत बनता है। सिस्टम उसी से बेहतर होता है।'
              : 'Every time an inspector corrects the machine, that correction becomes a training signal. RDSO limits are never tuned — only operational behaviour.'}
          </p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={busyKey === '__analyze__'}
          className="min-h-[44px] px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-control text-sm font-bold border border-accent-line transition shrink-0"
        >
          {busyKey === '__analyze__'
            ? isHi ? 'विश्लेषण…' : 'Analysing…'
            : isHi ? 'अभी विश्लेषण करें' : 'Run Analysis'}
        </button>
      </div>

      {/* The direct answer to the question in the title, placed first because
          it is what somebody senior actually asks: how much has it seen, and
          what changed as a result. */}
      <div className="rounded-card border border-line bg-card p-5">
        <LearningMemory lang={lang} />
      </div>

      {error && (
        <div className="p-4 bg-bad-soft border border-bad-line rounded-control text-sm text-bad-ink">{error}</div>
      )}

      {/* Cold-start state — honest about having no data yet */}
      {totalEvents === 0 && (
        <div className="p-6 bg-card border border-line rounded-card text-center space-y-2">
          <p className="text-sm font-bold text-white">
            {isHi ? 'अभी तक कोई डेटा नहीं' : 'No learning data yet'}
          </p>
          <p className="text-xs text-ink-muted max-w-lg mx-auto leading-relaxed">
            {isHi
              ? 'जैसे ही निरीक्षक कैलिपर रीडिंग को सुधारना शुरू करेंगे, यहाँ सटीकता और सुझाव दिखने लगेंगे।'
              : 'This fills in as inspectors use the app. Each accepted or corrected OCR reading is recorded, and patterns appear once there is enough evidence to trust them.'}
          </p>
        </div>
      )}

      {/* Accuracy per subsystem */}
      {totalEvents > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {accuracy
            .filter((a) => a.totalEvents > 0)
            .map((a) => (
              <div key={a.subsystem} className="bg-card border border-line rounded-card p-4">
                <p className="text-[11px] font-bold text-ink-muted uppercase tracking-[0.07em]">
                  {SUBSYSTEM_LABELS[a.subsystem] || a.subsystem}
                </p>
                <p className="text-3xl font-extrabold text-white mt-1 tabular-nums">
                  {(a.acceptanceRate * 100).toFixed(0)}
                  <span className="text-lg text-ink-faint">%</span>
                </p>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  {isHi ? 'स्वीकृत' : 'accepted unchanged'} · {a.totalEvents}{' '}
                  {isHi ? 'नमूने' : 'samples'}
                </p>
                {a.trend !== null && a.trend !== undefined && (
                  <p
                    className={`text-[11px] font-bold mt-1.5 ${
                      a.trend > 0 ? 'text-good-ink' : a.trend < 0 ? 'text-warn-ink' : 'text-ink-faint'
                    }`}
                  >
                    {a.trend > 0 ? '▲' : a.trend < 0 ? '▼' : '—'}{' '}
                    {Math.abs(a.trend * 100).toFixed(1)}% {isHi ? 'रुझान' : 'trend'}
                  </p>
                )}
                {!a.hasEnoughData && (
                  <p className="text-[10px] text-ink-faint mt-1.5 italic">
                    {isHi ? 'निष्कर्ष के लिए कम डेटा' : 'too few samples to draw conclusions'}
                  </p>
                )}
              </div>
            ))}
        </div>
      )}

      {/* Confidence calibration */}
      {calibration.some((b) => b.total > 0) && (
        <div className="bg-card border border-line rounded-card p-5 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-white">
              {isHi ? 'आत्मविश्वास अंशांकन' : 'Does OCR know when it is unsure?'}
            </h2>
            <p className="text-[11px] text-ink-muted mt-1">
              {isHi
                ? 'यदि निचले बैंड अधिक सुधारे जाते हैं, तो मशीन का आत्मविश्वास भरोसेमंद है।'
                : 'A well-calibrated reader is corrected far more often in its low-confidence bands. If the bars rise left-to-right, its confidence is meaningful.'}
            </p>
          </div>
          <div className="space-y-1.5">
            {calibration
              .filter((b) => b.total > 0)
              .map((b) => (
                <div key={b.bucket} className="flex items-center gap-3 text-[11px]">
                  <span className="font-mono text-ink-muted w-20 shrink-0 tabular-nums">{b.bucket}</span>
                  <div className="flex-1 h-5 bg-page rounded overflow-hidden border border-line">
                    <div
                      className={`h-full ${
                        b.acceptanceRate >= 0.9
                          ? 'bg-good'
                          : b.acceptanceRate >= 0.7
                          ? 'bg-warn'
                          : 'bg-bad'
                      }`}
                      style={{ width: `${Math.max(2, b.acceptanceRate * 100)}%` }}
                    />
                  </div>
                  <span className="text-ink-body w-28 shrink-0 tabular-nums">
                    {(b.acceptanceRate * 100).toFixed(0)}% · n={b.total}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-bold text-white">
            {isHi ? 'सिस्टम ने क्या पाया' : 'What the system found on its own'}
          </h2>
          {insights.map((i, idx) => (
            <div
              key={idx}
              className={`p-4 rounded-control border ${
                i.severity === 'ACTIONABLE'
                  ? 'bg-accent-soft border-accent-line'
                  : 'bg-card border-line'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={`text-[9px] font-extrabold px-2 py-0.5 rounded shrink-0 mt-0.5 ${
                    i.severity === 'ACTIONABLE'
                      ? 'bg-accent-soft text-accent-ink'
                      : 'bg-selected text-ink-muted'
                  }`}
                >
                  {i.severity}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">{i.title}</p>
                  <p className="text-xs text-ink-muted mt-1 leading-relaxed">{i.detail}</p>
                  <p className="text-[10px] text-ink-faint mt-1.5 font-mono">n = {i.sampleSize}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending proposals — the human approval gate */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <div>
            <h2 className="text-sm font-bold text-warn-ink">
              {isHi ? 'अनुमोदन प्रतीक्षित' : 'Awaiting your approval'}
            </h2>
            <p className="text-[11px] text-ink-muted mt-1">
              {isHi
                ? 'सिस्टम स्वयं कुछ नहीं बदलता। हर परिवर्तन के लिए मानव अनुमोदन आवश्यक है।'
                : 'The system never changes itself. Each proposal waits here until a named admin accepts it.'}
            </p>
          </div>
          {pending.map((p) => (
            <div key={p.param_key} className="bg-card border border-warn-line rounded-card p-5 space-y-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-xs text-warn-ink">{p.param_key}</span>
                <span className="text-lg font-extrabold text-white tabular-nums">
                  {p.current_value} <span className="text-ink-faint">→</span> {p.proposed_value}
                </span>
              </div>
              <p className="text-xs text-ink-body leading-relaxed">{p.description}</p>
              {p.proposal_rationale && (
                <p className="text-[11px] text-ink-muted leading-relaxed border-l-2 border-line pl-3">
                  {p.proposal_rationale}
                </p>
              )}
              {isAdmin ? (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => decide(p.param_key, 'APPROVE')}
                    disabled={busyKey === p.param_key}
                    className="min-h-[44px] px-4 py-2 bg-good hover:bg-good disabled:opacity-50 text-white rounded-control text-xs font-bold transition"
                  >
                    {isHi ? 'स्वीकृत करें' : 'Approve'}
                  </button>
                  <button
                    onClick={() => decide(p.param_key, 'REJECT')}
                    disabled={busyKey === p.param_key}
                    className="min-h-[44px] px-4 py-2 bg-raised hover:bg-selected disabled:opacity-50 text-ink-body rounded-control text-xs font-bold border border-line transition"
                  >
                    {isHi ? 'अस्वीकार' : 'Reject'}
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-ink-faint italic">
                  {isHi ? 'केवल प्रशासक अनुमोदन कर सकते हैं।' : 'Only an admin can approve this change.'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Current parameters */}
      {parameters.length > 0 && (
        <div className="bg-card border border-line rounded-card p-5 space-y-3">
          <h2 className="text-sm font-bold text-white">
            {isHi ? 'वर्तमान ट्यून किए गए मान' : 'Current tuned values'}
          </h2>
          <div className="space-y-1.5">
            {parameters.map((p) => (
              <div
                key={p.param_key}
                className="flex flex-wrap items-center justify-between gap-2 text-[11px] px-3 py-2.5 rounded-control bg-page border border-line"
              >
                <span className="font-mono text-ink-body">{p.param_key}</span>
                <span className="flex items-center gap-3">
                  <span className="text-white font-bold tabular-nums">{p.current_value}</span>
                  {p.current_value !== p.default_value && (
                    <span className="text-ink-faint tabular-nums">
                      (default {p.default_value})
                    </span>
                  )}
                  <span
                    className={`px-2 py-0.5 rounded font-bold ${
                      p.approval_status === 'APPROVED'
                        ? 'bg-good-soft text-good-ink'
                        : p.approval_status === 'PENDING'
                        ? 'bg-warn-soft text-warn-ink'
                        : 'bg-raised text-ink-muted'
                    }`}
                  >
                    {p.approval_status}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-ink-faint italic pt-1">
            {isHi
              ? 'RDSO बैंड सीमाएँ कभी ट्यून नहीं होतीं — वे विनियमन हैं।'
              : 'RDSO band tables and condemning limits are never tunable — they are regulation, not parameters.'}
          </p>
        </div>
      )}
    </div>
  );
};

export default LearningDashboardPage;
