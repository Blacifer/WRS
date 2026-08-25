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
import { ActionConfirm } from '../components/ActionConfirm.tsx';

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

const ROLE_LABELS: Record<string, string> = {
  INSPECTOR: 'Inspector',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Admin / DRM Officer'
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
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
          <TotpEnrolment lang={lang} onClose={() => { /* inline panel, nothing to close to */ }} />
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-5 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/30 border border-amber-500/30 rounded-2xl shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-amber-300 text-2xl">
            👤
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">{isHi ? 'उपयोगकर्ता खाते' : 'User Accounts'}</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Create and manage real login accounts for inspectors, supervisors, and admins. Accounts are never deleted, only deactivated — every inspection/audit record stays attributable.
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            setIsFormOpen((v) => !v);
            setSubmitError(null);
          }}
          className="min-h-[44px] px-4 py-2 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white rounded-xl text-sm font-bold shadow-md transition-colors whitespace-nowrap"
        >
          {isFormOpen ? '✕ Cancel' : '+ Add User'}
        </button>
      </div>

      {/* Just-created credentials panel — shown once */}
      {justCreated && (
        <div className="p-5 bg-emerald-950/40 border border-emerald-500/40 rounded-2xl shadow-xl space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-black text-emerald-300">Account created for {justCreated.fullName}</h3>
              <p className="text-xs text-emerald-400/80 mt-0.5">
                Copy these credentials now and hand them to this person directly — the password will not be shown again.
              </p>
            </div>
            <button onClick={() => setJustCreated(null)} className="text-emerald-400/70 hover:text-emerald-300 text-sm">✕</button>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center bg-black/30 border border-emerald-800/60 rounded-xl p-3">
            <div className="font-mono text-sm text-white space-y-1">
              <div><span className="text-slate-400">Username:</span> {justCreated.username}</div>
              <div><span className="text-slate-400">Password:</span> {justCreated.password}</div>
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
        <form onSubmit={handleSubmit} className="p-5 bg-slate-900 border border-slate-700 rounded-2xl shadow-xl space-y-4">
          <h3 className="text-sm font-black text-white">{isHi ? 'नया खाता' : 'New Account'}</h3>

          {submitError && (
            <div className="p-3 bg-rose-950/50 border border-rose-700/50 rounded-lg text-xs text-rose-300 font-medium">
              {submitError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1">{isHi ? 'पूरा नाम' : 'Full Name'}</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => handleFullNameChange(e.target.value)}
                placeholder="Ramesh Kumar"
                className="w-full min-h-[44px] px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1">{isHi ? 'कर्मचारी आईडी' : 'Employee ID'}</label>
              <input
                type="text"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="WRS-INSP-2031"
                className="w-full min-h-[44px] px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1">{isHi ? 'भूमिका' : 'Role'}</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full min-h-[44px] px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500"
              >
                <option value="INSPECTOR">{isHi ? 'निरीक्षक' : 'Inspector'}</option>
                <option value="SUPERVISOR">{isHi ? 'पर्यवेक्षक' : 'Supervisor'}</option>
                <option value="ADMIN">Admin / DRM Officer</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1">{isHi ? 'उपयोगकर्ता नाम' : 'Username'}</label>
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setUsernameTouched(true);
                }}
                placeholder="ramesh.kumar"
                className="w-full min-h-[44px] px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-400 mb-1">Password (auto-generated — edit if you'd rather set your own)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex-1 min-h-[44px] px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white font-mono focus:outline-none focus:border-amber-500"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setPassword(generateStrongPassword())}
                  className="min-h-[44px] px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-bold text-slate-300 whitespace-nowrap"
                >
                  🎲 Regenerate
                </button>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold shadow-md transition-colors"
          >
            {submitting ? (isHi ? 'बनाया जा रहा…' : 'Creating…') : (isHi ? 'खाता बनाएँ' : 'Create Account')}
          </button>
        </form>
      )}

      {/* Users Table */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-black text-white">All Accounts ({users.length})</h3>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading accounts…</div>
        ) : loadError ? (
          <div className="p-8 text-center text-rose-400 text-sm">{loadError}</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">No accounts yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                  <th className="px-4 py-3 font-bold">{isHi ? 'नाम' : 'Name'}</th>
                  <th className="px-4 py-3 font-bold">{isHi ? 'उपयोगकर्ता नाम' : 'Username'}</th>
                  <th className="px-4 py-3 font-bold">{isHi ? 'भूमिका' : 'Role'}</th>
                  <th className="px-4 py-3 font-bold">{isHi ? 'कर्मचारी आईडी' : 'Employee ID'}</th>
                  <th className="px-4 py-3 font-bold">{isHi ? 'स्थिति' : 'Status'}</th>
                  <th className="px-4 py-3 font-bold text-right">{isHi ? 'क्रिया' : 'Action'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-white font-medium">{u.full_name}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{u.username}</td>
                    <td className="px-4 py-3 text-slate-300">{ROLE_LABELS[u.role] || u.role}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{u.employee_id}</td>
                    <td className="px-4 py-3">
                      {u.is_active ? (
                        <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-emerald-950/70 text-emerald-400 border border-emerald-800">{isHi ? 'सक्रिय' : 'ACTIVE'}</span>
                      ) : (
                        <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-slate-800 text-slate-500 border border-slate-700">{isHi ? 'निष्क्रिय' : 'DEACTIVATED'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {/* A lost phone is routine; without this the only remedy
                          would be editing the database by hand. */}
                      <button
                        onClick={() => handleResetTotp(u)}
                        disabled={busyUserId === u.id}
                        title={isHi ? 'प्रमाणक हटाएँ ताकि नया फ़ोन सेट हो सके' : 'Clear the authenticator so a new phone can be enrolled'}
                        className="min-h-[36px] px-3 py-1.5 mr-1.5 rounded-lg text-xs font-bold border border-amber-800/60 bg-amber-950/40 text-amber-400 hover:bg-amber-900/50 transition-colors disabled:opacity-50"
                      >
                        {isHi ? 'प्रमाणक रीसेट' : 'Reset authenticator'}
                      </button>
                      <button
                        onClick={() => handleToggleActive(u)}
                        disabled={busyUserId === u.id}
                        className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors disabled:opacity-50 ${
                          u.is_active
                            ? 'bg-rose-950/40 border-rose-800/60 text-rose-400 hover:bg-rose-900/50'
                            : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400 hover:bg-emerald-900/50'
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
