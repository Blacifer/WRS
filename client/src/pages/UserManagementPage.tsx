/**
 * Admin: Real Account Management
 * Indian Railways WRS Raipur
 *
 * Lets an Admin/DRM create real inspector/supervisor/admin logins, see who
 * currently has access, and deactivate/reactivate accounts — without needing
 * raw API calls. Never hard-deletes a user (they're referenced by FK from
 * inspection/audit rows), only flips is_active via the existing
 * deactivate/reactivate endpoints.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api.ts';
import type { AdminUserRecord } from '../../../shared/types.ts';
import type { LanguageCode } from '../i18n/index.ts';
import { AppAccessQr } from '../components/AppAccessQr.tsx';
import { TotpEnrolment } from '../components/TotpEnrolment.tsx';
import { GaugeRegister } from '../components/GaugeRegister.tsx';
import { ActionConfirm } from '../components/ActionConfirm.tsx';
import { RefreshCwIcon, UserIcon, CheckCircleIcon, PlusCircleIcon } from '../components/Icons.tsx';
import { Button, Card, CardBody, CardHeader, Chip, Note } from '../components/ui/index.tsx';
import { ROLE_CAPABILITIES } from '../../../shared/auth/permissions.ts';
import type { Capability, Role } from '../../../shared/auth/permissions.ts';

function generateStrongPassword(length = 14): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => chars[n % chars.length]).join('');
}

function suggestUsername(fullName: string): string {
  return fullName
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('.');
}

/*
 * ADMIN and DRM are two different people doing two different jobs — the
 * administrator runs the system and signs nothing; the DRM reads the division
 * and touches no shop floor. One label reading "Admin / DRM Officer" over both
 * was left over from when they were the same row in the table. Reported as
 * "admin1 and drm1 shows the same thing visually".
 */
const ROLE_LABELS: Record<string, string> = {
  INSPECTOR: 'Inspector',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Administrator',
  DRM: 'DRM — Divisional Officer'
};

/*
 * What each capability means, in the words somebody would use out loud.
 *
 * The capability NAMES are the authority and live in shared/auth/permissions.ts;
 * this only supplies a reading of each. Anything added there without a label
 * here still appears in the matrix, under its own name — better a raw key on
 * screen than a capability silently missing from the table an administrator
 * uses to reason about access.
 */
const CAPABILITY_LABELS: Partial<Record<Capability, { en: string; hi: string }>> = {
  'spring.record':       { en: 'Record a spring',              hi: 'स्प्रिंग दर्ज करना' },
  'spring.correct':      { en: 'Withdraw a mistapped spring',  hi: 'ग़लत दर्ज स्प्रिंग वापस लेना' },
  'wagon.inspect':       { en: 'Answer a wagon checklist',     hi: 'वैगन जाँच सूची भरना' },
  'wagon.photograph':    { en: 'Attach photographic evidence', hi: 'फ़ोटो प्रमाण जोड़ना' },
  'wagon.view':          { en: 'Look at wagons and history',   hi: 'वैगन व इतिहास देखना' },
  'wagon.release':       { en: 'Certify a wagon fit to leave', hi: 'वैगन को जाने योग्य प्रमाणित करना' },
  'wagon.override':      { en: 'Move a wagon against the rules', hi: 'नियम के विरुद्ध चरण बदलना' },
  'checklist.configure': { en: 'Change what the gate enforces', hi: 'गेट के नियम बदलना' },
  'stores.manage':       { en: 'Issue and restock parts',      hi: 'पुर्जे जारी व पुनःपूर्ति' },
  'learning.approve':    { en: 'Accept a parameter change',    hi: 'पैरामीटर परिवर्तन स्वीकारना' },
  'audit.read':          { en: 'Verify the audit chain',       hi: 'ऑडिट श्रृंखला जाँचना' },
  'analytics.read':      { en: 'Read the divisional dashboards', hi: 'मंडल डैशबोर्ड देखना' },
  'learning.view':       { en: 'Read what the system learned', hi: 'सिस्टम की सीख देखना' },
  'certificate.export':  { en: 'Export certificates',          hi: 'प्रमाणपत्र निर्यात' },
  'users.manage':        { en: 'Manage people',                hi: 'लोगों का प्रबंधन' },
  'system.configure':    { en: 'Configure the system',         hi: 'सिस्टम कॉन्फ़िगर करना' }
};

const MATRIX_ROLES: Role[] = ['INSPECTOR', 'SUPERVISOR', 'DRM', 'ADMIN'];
const MATRIX_ROLE_SHORT: Record<Role, string> = {
  INSPECTOR: 'Insp', SUPERVISOR: 'Sup', DRM: 'DRM', ADMIN: 'Admin'
};

/**
 * Who holds what, read straight off the permission table.
 *
 * Built from ROLE_CAPABILITIES rather than written out here, so it cannot
 * drift from what the guards actually enforce — a printed access matrix that
 * disagrees with the code is worse than none, because people trust it.
 */
const CapabilityMatrix: React.FC<{ isHi: boolean }> = ({ isHi }) => {
  const every = Array.from(
    new Set(MATRIX_ROLES.flatMap((r) => [...ROLE_CAPABILITIES[r]]))
  ) as Capability[];

  return (
    <Card>
      <CardHeader
        title={isHi ? 'कौन क्या कर सकता है' : 'What each role holds'}
        meta={isHi ? 'सीधे अनुमति तालिका से' : 'Read from the permission table itself'}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[34rem]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.07em] text-ink-faint border-b border-line">
              <th className="px-5 py-3 font-bold">{isHi ? 'क्षमता' : 'Capability'}</th>
              {MATRIX_ROLES.map((r) => (
                <th key={r} className="px-3 py-3 font-bold text-center w-[86px]">{MATRIX_ROLE_SHORT[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {every.map((cap) => (
              <tr key={cap} className="border-b border-line/60 hover:bg-white/[0.02]">
                <td className="px-5 py-2.5">
                  <div className="text-[13px] font-semibold text-ink-body">
                    {CAPABILITY_LABELS[cap] ? (isHi ? CAPABILITY_LABELS[cap]!.hi : CAPABILITY_LABELS[cap]!.en) : cap}
                  </div>
                  <div className="text-[11px] font-medium text-ink-faint font-mono mt-0.5">{cap}</div>
                </td>
                {MATRIX_ROLES.map((r) => {
                  const held = ROLE_CAPABILITIES[r].includes(cap);
                  return (
                    <td key={r} className="px-3 py-2.5 text-center">
                      <span
                        aria-label={held ? 'held' : 'not held'}
                        className={[
                          'inline-flex items-center justify-center w-6 h-6 rounded-chip border',
                          held ? 'bg-good-soft border-good-line text-good-ink' : 'border-line text-transparent'
                        ].join(' ')}
                      >
                        {held ? <CheckCircleIcon size={14} /> : null}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CardBody>
        <Note>
          {isHi
            ? 'वरिष्ठता से पहुँच तय नहीं होती। प्रशासक वह खाता बना सकता है जो वैगन प्रमाणित करता है, पर स्वयं प्रमाणित नहीं कर सकता; डीआरएम सब देखता है और कुछ हस्ताक्षरित नहीं करता।'
            : 'Access is not seniority. An administrator can create the account that certifies a wagon and cannot certify one themselves; the DRM sees everything and signs nothing.'}
        </Note>
      </CardBody>
    </Card>
  );
};

interface UserManagementPageProps {
  lang: LanguageCode;
}

export const UserManagementPage: React.FC<UserManagementPageProps> = ({ lang }) => {
  const isHi = lang === 'hi';
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [fullName, setFullName] = useState<string>('');
  const [employeeId, setEmployeeId] = useState<string>('');
  const [role, setRole] = useState<'INSPECTOR' | 'SUPERVISOR' | 'ADMIN'>('INSPECTOR');
  const [username, setUsername] = useState<string>('');
  const [usernameTouched, setUsernameTouched] = useState<boolean>(false);
  const [password, setPassword] = useState<string>(() => generateStrongPassword());
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<{ username: string; password: string; fullName: string } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  /**
   * An account change waiting on confirmation.
   *
   * Server-side enforcement of USER_MGMT was added without the interface ever
   * obtaining a token, which broke account creation entirely — the tests
   * passed because they minted tokens directly. This is the interface half.
   */
  const [pendingAction, setPendingAction] = useState<
    { kind: 'CREATE' } | { kind: 'TOGGLE'; user: AdminUserRecord } | null
  >(null);

  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.listUsers();
      setUsers(res.data || []);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load user accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const resetForm = () => {
    setFullName('');
    setEmployeeId('');
    setRole('INSPECTOR');
    setUsername('');
    setUsernameTouched(false);
    setPassword(generateStrongPassword());
    setSubmitError(null);
  };

  const handleFullNameChange = (val: string) => {
    setFullName(val);
    if (!usernameTouched) {
      setUsername(suggestUsername(val));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!fullName.trim() || !employeeId.trim() || !username.trim()) {
      setSubmitError((isHi ? 'पूरा नाम, कर्मचारी आईडी और उपयोगकर्ता नाम — तीनों आवश्यक हैं।' : 'Full name, employee ID, and username are all required.'));
      return;
    }
    if (password.length < 8) {
      setSubmitError((isHi ? 'पासवर्ड कम से कम 8 अक्षरों का होना चाहिए।' : 'Password must be at least 8 characters.'));
      return;
    }

    // Confirmation first; the account is created once a token comes back.
    setPendingAction({ kind: 'CREATE' });
  };

  const createWithToken = async (otpToken: string) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.createUser({
        username: username.trim(),
        password,
        role,
        fullName: fullName.trim(),
        employeeId: employeeId.trim(),
        otpToken
      });
      setJustCreated({ username: username.trim(), password, fullName: fullName.trim() });
      resetForm();
      setIsFormOpen(false);
      await loadUsers();
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to create account.');
    } finally {
      setSubmitting(false);
      setPendingAction(null);
    }
  };

  /**
   * Clears a user's authenticator so they can enrol a new device.
   *
   * A lost or replaced phone is the ordinary case, not an edge case. Without
   * this the only remedy would be editing the database by hand, and the
   * clearance is written to the audit chain because removing someone's second
   * factor is exactly what an attacker would want.
   */
  const handleResetTotp = async (u: AdminUserRecord) => {
    setBusyUserId(u.id);
    setLoadError(null);
    try {
      await api.resetUserTotp(u.id);
      await loadUsers();
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to clear the authenticator.');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleToggleActive = async (u: AdminUserRecord) => {
    setPendingAction({ kind: 'TOGGLE', user: u });
  };

  const toggleWithToken = async (u: AdminUserRecord, otpToken: string) => {
    setBusyUserId(u.id);
    try {
      if (u.is_active) {
        await api.deactivateUser(u.id, otpToken);
      } else {
        await api.reactivateUser(u.id, otpToken);
      }
      await loadUsers();
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to update account status.');
    } finally {
      setPendingAction(null);
      setBusyUserId(null);
    }
  };

  const copyCredentials = () => {
    if (!justCreated) return;
    const text = `Username: ${justCreated.username}\nPassword: ${justCreated.password}`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div className="space-y-6">
      {pendingAction && (
        <ActionConfirm
          action="USER_MGMT"
          lang={lang}
          title={
            pendingAction.kind === 'CREATE'
              ? (isHi ? 'नया खाता बनाने की पुष्टि' : 'Confirm creating an account')
              : pendingAction.user.is_active
                ? (isHi ? 'खाता निष्क्रिय करने की पुष्टि' : 'Confirm deactivating this account')
                : (isHi ? 'खाता पुनः सक्रिय करने की पुष्टि' : 'Confirm reactivating this account')
          }
          description={
            pendingAction.kind === 'CREATE'
              ? (isHi
                  ? 'नया खाता बनाना अधिकार देने के बराबर है, इसलिए इसकी पुष्टि आवश्यक है।'
                  : 'Creating an account grants access, so it needs the same confirmation a release does.')
              : (isHi
                  ? `${pendingAction.user.full_name} — यह निर्णय दर्ज किया जाएगा।`
                  : `${pendingAction.user.full_name} — this decision is recorded against your name.`)
          }
          onCancel={() => setPendingAction(null)}
          onConfirmed={async (token) => {
            if (pendingAction.kind === 'CREATE') await createWithToken(token);
            else await toggleWithToken(pendingAction.user, token);
          }}
        />
      )}

      {/* Shop-floor access and second-factor setup.
          Both belong on the admin screen: one is a poster to print, the other
          is a credential the admin also has to be able to reset for a
          supervisor who has lost their phone. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AppAccessQr lang={lang} />
        <div className="rounded-card border border-line bg-card p-5">
          <TotpEnrolment lang={lang} onClose={() => { /* inline panel, nothing to close to */ }} />
        </div>
      </div>

      {/* The instruments. Here rather than on the shop floor because recording
          a calibration asserts that somebody checked the gauge, which is an
          administrator's act — while naming the gauge in your hand, which is
          an inspector's, sits with the sorting itself. */}
      <GaugeRegister lang={lang} />

      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="w-12 h-12 rounded-control bg-accent-soft border border-accent-line flex items-center justify-center text-accent-ink shrink-0">
            <UserIcon size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold tracking-[-0.028em] text-ink">
              {isHi ? 'लोग, और वे क्या खोल सकते हैं' : 'People, and what they can reach'}
            </h1>
            <p className="text-[13px] font-medium text-ink-muted mt-1">
              {isHi
                ? 'निरीक्षक, पर्यवेक्षक, डीआरएम और प्रशासक के वास्तविक लॉगिन खाते।'
                : 'Real login accounts for inspectors, supervisors, the DRM and administrators.'}
            </p>
          </div>
        </div>
        <Button
          variant={isFormOpen ? 'secondary' : 'primary'}
          onClick={() => {
            setIsFormOpen((v) => !v);
            setSubmitError(null);
          }}
        >
          <PlusCircleIcon size={17} />
          {isFormOpen ? (isHi ? 'रद्द करें' : 'Cancel') : (isHi ? 'व्यक्ति जोड़ें' : 'Add person')}
        </Button>
      </div>

      <CapabilityMatrix isHi={isHi} />

      {/* Just-created credentials panel — shown once */}
      {justCreated && (
        <div className="p-5 bg-emerald-950/40 border border-emerald-500/40 rounded-card shadow-xl space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-black text-emerald-300">Account created for {justCreated.fullName}</h3>
              <p className="text-xs text-emerald-400/80 mt-0.5">
                Copy these credentials now and hand them to this person directly — the password will not be shown again.
              </p>
            </div>
            <button onClick={() => setJustCreated(null)} className="text-emerald-400/70 hover:text-emerald-300 text-sm">✕</button>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center bg-black/30 border border-emerald-800/60 rounded-control p-3">
            <div className="font-mono text-sm text-white space-y-1">
              <div><span className="text-ink-muted">Username:</span> {justCreated.username}</div>
              <div><span className="text-ink-muted">Password:</span> {justCreated.password}</div>
            </div>
            <button
              onClick={copyCredentials}
              className="min-h-[40px] px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold ml-auto"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Add User Form */}
      {isFormOpen && (
        <form onSubmit={handleSubmit} className="p-5 bg-card border border-line rounded-card shadow-xl space-y-4">
          <h3 className="text-sm font-black text-white">{isHi ? 'नया खाता' : 'New Account'}</h3>

          {submitError && (
            <div className="p-3 bg-rose-950/50 border border-rose-700/50 rounded-lg text-xs text-rose-300 font-medium">
              {submitError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-ink-muted mb-1">{isHi ? 'पूरा नाम' : 'Full Name'}</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => handleFullNameChange(e.target.value)}
                placeholder="Ramesh Kumar"
                className="w-full min-h-[44px] px-3 py-2 bg-raised border border-line rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-ink-muted mb-1">{isHi ? 'कर्मचारी आईडी' : 'Employee ID'}</label>
              <input
                type="text"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="WRS-INSP-2031"
                className="w-full min-h-[44px] px-3 py-2 bg-raised border border-line rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-ink-muted mb-1">{isHi ? 'भूमिका' : 'Role'}</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full min-h-[44px] px-3 py-2 bg-raised border border-line rounded-lg text-sm text-white focus:outline-none focus:border-amber-500"
              >
                <option value="INSPECTOR">{isHi ? 'निरीक्षक' : 'Inspector'}</option>
                <option value="SUPERVISOR">{isHi ? 'पर्यवेक्षक' : 'Supervisor'}</option>
                <option value="ADMIN">{isHi ? 'प्रशासक' : 'Administrator'}</option>
                {/* DRM was missing entirely, so a divisional officer's account
                    could not be created from this screen at all. */}
                <option value="DRM">{isHi ? 'मंडल रेल प्रबंधक' : 'DRM — Divisional Officer'}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-ink-muted mb-1">{isHi ? 'उपयोगकर्ता नाम' : 'Username'}</label>
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setUsernameTouched(true);
                }}
                placeholder="ramesh.kumar"
                className="w-full min-h-[44px] px-3 py-2 bg-raised border border-line rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-ink-muted mb-1">Password (auto-generated — edit if you'd rather set your own)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex-1 min-h-[44px] px-3 py-2 bg-raised border border-line rounded-lg text-sm text-white font-mono focus:outline-none focus:border-amber-500"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setPassword(generateStrongPassword())}
                  className="min-h-[44px] px-3 py-2 bg-raised hover:bg-selected border border-line rounded-lg text-xs font-bold text-ink-body whitespace-nowrap"
                >
                  <RefreshCwIcon size={14} className="inline align-[-2px] mr-1.5" />Regenerate
                </button>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-control text-sm font-bold shadow-md transition-colors"
          >
            {submitting ? (isHi ? 'बनाया जा रहा…' : 'Creating…') : (isHi ? 'खाता बनाएँ' : 'Create Account')}
          </button>
        </form>
      )}

      {/* Users Table */}
      <div className="bg-card border border-line rounded-card shadow-xl overflow-hidden">
        {/*
          Why there is no delete.
          A supervisor looked for one and reported "no place to remove". There
          is none by design, and the reason was buried in a subtitle above the
          add-user button where nobody reading the table would find it. Said
          here instead, next to the buttons that exist.
        */}
        <div className="px-4 pt-4">
          <p className="text-[11px] text-ink-muted bg-page border border-line rounded-lg px-3 py-2 leading-snug">
            <strong className="text-ink-body">There is no delete, deliberately.</strong>{' '}
            Deactivating stops someone signing in immediately and keeps their name on
            everything they inspected. Removing the account would leave inspections and
            audit entries pointing at somebody who no longer exists, and a record that
            cannot say who made it is not a record. Deactivation is reversible; a
            deletion would not be.
          </p>
        </div>

        <div className="p-4 border-b border-line flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">{isHi ? 'सभी खाते' : 'All accounts'} ({users.length})</h3>
        </div>

        {loading ? (
          <div className="p-8 text-center text-ink-faint text-sm">Loading accounts…</div>
        ) : loadError ? (
          <div className="p-8 text-center text-rose-400 text-sm">{loadError}</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-ink-faint text-sm">No accounts yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">
                  <th className="px-4 py-3 font-bold">{isHi ? 'नाम' : 'Name'}</th>
                  <th className="px-4 py-3 font-bold">{isHi ? 'उपयोगकर्ता नाम' : 'Username'}</th>
                  <th className="px-4 py-3 font-bold">{isHi ? 'भूमिका' : 'Role'}</th>
                  <th className="px-4 py-3 font-bold">{isHi ? 'कर्मचारी आईडी' : 'Employee ID'}</th>
                  <th className="px-4 py-3 font-bold">{isHi ? 'स्थिति' : 'Status'}</th>
                  <th className="px-4 py-3 font-bold text-right">{isHi ? 'क्रिया' : 'Action'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-white font-medium">{u.full_name}</td>
                    <td className="px-4 py-3 text-ink-muted font-mono text-xs">{u.username}</td>
                    <td className="px-4 py-3 text-ink-body">{ROLE_LABELS[u.role] || u.role}</td>
                    <td className="px-4 py-3 text-ink-muted font-mono text-xs">{u.employee_id}</td>
                    <td className="px-4 py-3">
                      {u.is_active ? (
                        <Chip tone="good">{isHi ? 'सक्रिय' : 'Active'}</Chip>
                      ) : (
                        <Chip>{isHi ? 'निष्क्रिय' : 'Deactivated'}</Chip>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {/* A lost phone is routine; without this the only remedy
                          would be editing the database by hand. */}
                      <button
                        onClick={() => handleResetTotp(u)}
                        disabled={busyUserId === u.id}
                        title={isHi ? 'प्रमाणक हटाएँ ताकि नया फ़ोन सेट हो सके' : 'Clear the authenticator so a new phone can be enrolled'}
                        className="min-h-[36px] px-3 py-1.5 mr-1.5 rounded-control text-xs font-bold border border-line-strong bg-raised text-ink-body hover:bg-selected hover:text-ink transition-colors disabled:opacity-50"
                      >
                        {isHi ? 'प्रमाणक रीसेट' : 'Reset authenticator'}
                      </button>
                      <button
                        onClick={() => handleToggleActive(u)}
                        disabled={busyUserId === u.id}
                        className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors disabled:opacity-50 ${
                          u.is_active
                            ? 'bg-bad-soft border-bad-line text-bad-ink hover:bg-bad/20'
                            : 'bg-good-soft border-good-line text-good-ink hover:bg-good/20'
                        }`}
                      >
                        {busyUserId === u.id ? '…' : u.is_active ? (isHi ? 'निष्क्रिय करें' : 'Deactivate') : (isHi ? 'पुनः सक्रिय करें' : 'Reactivate')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
