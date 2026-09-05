/**
 * Audit Chain Verification
 * Indian Railways WRS Raipur
 *
 * WHY THIS SCREEN EXISTS
 * ----------------------
 * The system's central claim is that nothing can be quietly changed after the
 * fact. Append-only database triggers enforce that through the application;
 * the SHA-256 chain is what catches a change that went around the application
 * entirely — somebody editing the database file directly.
 *
 * The endpoint that checks this has existed for some time. Nothing in the
 * interface reached it, so the only way to ask the question was a terminal
 * and a hand-minted token. That made the claim true but unverifiable by the
 * people who actually rely on it, which is a strange place for the one
 * feature whose entire purpose is being checkable rather than asserted.
 *
 * WHAT A PASS DOES NOT MEAN
 * -------------------------
 * Stated on the screen, not just here, and given its own panel rather than a
 * footnote. A verified chain proves no record was altered after it was
 * written. It cannot prove a record was true when it was written — a wrong
 * measurement, honestly entered, hashes exactly as well as a right one.
 * Someone reading a green tick as "the inspections were correct" has read
 * more into it than it says.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api.ts';
import { ShieldIcon, RefreshCwIcon, CheckCircleIcon, AlertTriangleIcon } from '../components/Icons.tsx';
import { Button, Card, CardBody, CardHeader, Note } from '../components/ui/index.tsx';

interface Props {
  lang: 'en' | 'hi';
}

type Verification = Awaited<ReturnType<typeof api.verifyAuditChain>>['data'];

/**
 * What each kind of break actually means for whoever has to investigate.
 * These are distinguished by the server because they point at different
 * causes, and collapsing them into "tampered" would lose that.
 */
const BREAK_MEANING: Record<string, { en: string; hi: string }> = {
  CONTENT_ALTERED: {
    en: 'The row no longer matches its own hash. Its contents were changed after it was written.',
    hi: 'पंक्ति अपने ही हैश से मेल नहीं खाती। लिखे जाने के बाद इसकी सामग्री बदली गई है।'
  },
  BROKEN_LINK: {
    en: 'This row does not follow on from the one before it. A record was most likely deleted or inserted between them.',
    hi: 'यह पंक्ति पिछली पंक्ति से नहीं जुड़ती। संभवतः बीच से कोई रिकॉर्ड हटाया या जोड़ा गया है।'
  },
  GENESIS_MISMATCH: {
    en: 'The chain does not begin where it should. The earliest records may have been removed.',
    hi: 'श्रृंखला सही शुरुआत से नहीं शुरू होती। शुरुआती रिकॉर्ड हटाए जा सकते हैं।'
  },
  UNCHAINED: {
    en: 'The row carries no hash at all, so nothing about it can be attested either way.',
    hi: 'इस पंक्ति में कोई हैश नहीं है, इसलिए इसके बारे में कुछ भी प्रमाणित नहीं किया जा सकता।'
  }
};

/** What the chain actually attests to, in the reader's terms. */
const COVERED: Array<{ en: string; hi: string }> = [
  {
    en: 'Every spring verdict, including the ones recorded offline and sent later.',
    hi: 'हर स्प्रिंग निर्णय, उन सहित जो ऑफ़लाइन दर्ज होकर बाद में भेजे गए।'
  },
  {
    en: 'Every stage transition, with who moved it and when.',
    hi: 'हर चरण परिवर्तन — किसने और कब बदला, इसके साथ।'
  },
  {
    en: 'Every release certificate, with its own keyed HMAC over its contents.',
    hi: 'हर रिलीज़ प्रमाणपत्र, अपनी सामग्री पर कुंजीबद्ध HMAC के साथ।'
  },
  {
    en: 'Every change of role — a changed role breaks the chain, not just changed data.',
    hi: 'भूमिका का हर परिवर्तन — बदली भूमिका भी श्रृंखला तोड़ती है, केवल बदला डेटा नहीं।'
  }
];

export function AuditVerificationPage({ lang }: Props) {
  const isHi = lang === 'hi';

  const [result, setResult] = useState<Verification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.verifyAuditChain();
      setResult(res.data);
    } catch (e: any) {
      // A failed check is not a passed check. Say so plainly rather than
      // leaving the last good result on screen looking current.
      setResult(null);
      setError(
        e?.message ||
          (isHi
            ? 'जाँच पूरी नहीं हो सकी। यह "सब ठीक है" नहीं है — दोबारा कोशिश करें।'
            : 'The check could not be completed. That is not the same as passing — try again.')
      );
    } finally {
      setBusy(false);
    }
  }, [isHi]);

  useEffect(() => {
    verify();
  }, [verify]);

  const broken = result ? !result.verified : false;

  return (
    <div className="max-w-6xl mx-auto space-y-4 animate-fadeIn">

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.028em] text-ink">
            {isHi ? 'ऑडिट श्रृंखला' : 'Audit chain'}
          </h1>
          <p className="mt-1.5 text-[13px] font-medium text-ink-muted max-w-xl">
            {isHi
              ? 'हर रिकॉर्ड का हैश पहली प्रविष्टि से दोबारा गिना जाता है, यह देखने के लिए कि लिखे जाने के बाद कुछ बदला तो नहीं।'
              : 'SHA-256 across every event, re-derived from the first entry each time you ask.'}
          </p>
        </div>
        <Button onClick={verify} disabled={busy}>
          <RefreshCwIcon size={16} className={busy ? 'animate-spin' : ''} />
          {busy ? (isHi ? 'जाँच जारी…' : 'Re-deriving…') : (isHi ? 'दोबारा जाँचें' : 'Verify chain again')}
        </Button>
      </div>

      {error && (
        <Note tone="warn">
          <AlertTriangleIcon size={17} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </Note>
      )}

      {/* The verdict, read from across a room. */}
      {result && (
        <div
          className={[
            'flex flex-wrap items-center gap-5 px-7 py-6 rounded-card border',
            broken ? 'bg-bad-soft border-bad-line' : 'bg-good-soft border-good-line'
          ].join(' ')}
        >
          <span
            className={[
              'w-14 h-14 rounded-card flex items-center justify-center shrink-0 text-page',
              broken ? 'bg-bad' : 'bg-good'
            ].join(' ')}
          >
            <ShieldIcon size={30} />
          </span>

          <div className="flex-1 min-w-[16rem]">
            <p className={`text-[28px] leading-tight font-extrabold tracking-[-0.03em] ${broken ? 'text-bad-ink' : 'text-good-ink'}`}>
              {broken
                ? (isHi ? 'श्रृंखला टूटी हुई है' : 'The chain is broken')
                : (isHi ? 'श्रृंखला अटूट है' : 'Chain intact')}
            </p>
            <p className="mt-1 text-sm font-medium text-ink-body">
              {isHi
                ? `${result.entriesChecked} प्रविष्टियाँ जाँची गईं${broken ? ` — ${result.breaksFound} में गड़बड़ी` : ''}`
                : result.summary}
            </p>
          </div>

          <div className="flex gap-8 shrink-0">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                {isHi ? 'प्रविष्टियाँ' : 'Entries'}
              </div>
              <div className={`text-[22px] font-extrabold tabular mt-1 ${broken ? 'text-bad-ink' : 'text-good-ink'}`}>
                {result.entriesChecked}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                {isHi ? 'जाँच का समय' : 'Checked at'}
              </div>
              <div className="text-[13px] font-bold text-ink-body mt-2 tabular">
                {new Date(result.checkedAt).toLocaleString(isHi ? 'hi-IN' : 'en-IN')}
              </div>
            </div>
          </div>
        </div>
      )}

      {busy && !result && !error && (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-muted">
              {isHi ? 'श्रृंखला पढ़ी जा रही है…' : 'Walking the chain…'}
            </p>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">

        {/* Where it stops adding up, when it does. */}
        <div className="space-y-4">
          {result && broken && result.firstBrokenAt && (
            <Card tone="bad">
              <CardHeader title={
                <span className="text-bad-ink">
                  {isHi ? 'पहली गड़बड़ी यहाँ' : 'The chain first stops adding up here'}
                </span>
              } />
              <CardBody className="space-y-4">
                <dl className="grid grid-cols-[auto,1fr] gap-x-5 gap-y-2 text-sm">
                  <dt className="text-ink-faint">{isHi ? 'रिकॉर्ड' : 'Record'}</dt>
                  <dd className="text-ink font-mono text-xs break-all">{result.firstBrokenAt.id}</dd>

                  <dt className="text-ink-faint">{isHi ? 'घटना' : 'Event'}</dt>
                  <dd className="text-ink">{result.firstBrokenAt.eventType}</dd>

                  <dt className="text-ink-faint">{isHi ? 'लिखा गया' : 'Written'}</dt>
                  <dd className="text-ink">
                    {new Date(result.firstBrokenAt.createdAt).toLocaleString(isHi ? 'hi-IN' : 'en-IN')}
                  </dd>

                  <dt className="text-ink-faint">{isHi ? 'प्रकार' : 'Kind'}</dt>
                  <dd className="text-ink font-mono text-xs">{result.firstBrokenAt.reason}</dd>
                </dl>

                <p className="text-sm font-semibold text-bad-ink bg-bad-soft rounded-control px-4 py-3 leading-relaxed">
                  {BREAK_MEANING[result.firstBrokenAt.reason]
                    ? (isHi
                        ? BREAK_MEANING[result.firstBrokenAt.reason].hi
                        : BREAK_MEANING[result.firstBrokenAt.reason].en)
                    : result.firstBrokenAt.detail}
                </p>

                <Note>
                  {isHi
                    ? 'यह अपने आप ठीक नहीं होगा। इस समय के बाद के रिकॉर्ड पर भरोसा करने से पहले बैकअप से मिलान करें और वरिष्ठ अधिकारी को सूचित करें।'
                    : 'This does not repair itself. Before relying on records from this point onward, compare against a backup and report it — a break means the database file was modified outside the application, which the application cannot undo or explain.'}
                </Note>
              </CardBody>
            </Card>
          )}

          {result && !broken && (
            <Card>
              <CardHeader title={isHi ? 'क्या-क्या शामिल है' : 'What is covered'} />
              <CardBody className="space-y-3">
                {COVERED.map((c, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircleIcon size={17} className="text-good-ink shrink-0 mt-0.5" />
                    <span className="text-[13px] font-medium text-ink-muted leading-relaxed">
                      {isHi ? c.hi : c.en}
                    </span>
                  </div>
                ))}
                <Note className="pt-3 border-t border-line">
                  {isHi
                    ? 'डेटाबेस ट्रिगर लॉग को केवल-जोड़ने योग्य रखते हैं। वही जाँच '
                    : 'Database triggers make the log append-only. The same check runs at '}
                  <span className="font-mono text-ink-muted">GET /api/audit/verify</span>
                  {isHi
                    ? ' पर भी चलती है, उनके लिए जो स्क्रीन पर भरोसा नहीं करना चाहते।'
                    : ' for anyone who would rather not trust a screen.'}
                </Note>
              </CardBody>
            </Card>
          )}
        </div>

        {/*
          The limit of what a pass proves.
          This was a grey footnote under a green tick. It is the single most
          misreadable thing on the screen, so it gets a panel of its own.
        */}
        <Card tone="warn">
          <div className="px-5 py-4 bg-warn-soft border-b border-warn-line">
            <span className="text-sm font-bold text-warn-ink">
              {isHi ? 'पास होने का अर्थ क्या नहीं है' : 'What a pass does not prove'}
            </span>
          </div>
          <CardBody>
            <p className="text-[13px] font-medium text-ink-muted leading-relaxed">
              {isHi
                ? 'इसका अर्थ है कि लिखे जाने के बाद कोई रिकॉर्ड बदला नहीं गया। इसका अर्थ यह नहीं है कि हर माप सही था — गलत माप भी उतनी ही सफाई से दर्ज होता है। अटूट श्रृंखला कहती है कि रजिस्टर सुरक्षित है; यह नहीं कहती कि गेज सही पढ़ा गया था।'
                : 'That no record was altered after it was written is not the same as every measurement having been correct. A wrong reading, honestly entered, hashes exactly as well as a right one. A verified chain says the register is intact. It says nothing about whether the caliper was read properly.'}
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
