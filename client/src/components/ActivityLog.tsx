/**
 * The activity ledger, in plain language.
 *
 * Reported twice: "history and logs just talks about the springs." It did.
 * The audit log has always carried every wagon registration, stage move,
 * checklist entry, gate sign-off, login and override — none of it reachable
 * from inside the app.
 *
 * Two things matter about how this reads. Event types are rendered as
 * sentences, because WAGON_STAGE_TRANSITION means nothing to a DRM reading a
 * screen. And an address that was never recorded says so, rather than showing
 * a dash that could be mistaken for a blank.
 */

import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { RefreshCwIcon, ShieldIcon } from './Icons.tsx';

interface ActivityEntry {
  id: string;
  eventType: string;
  inspectionId: string | null;
  actorId: string;
  actorName: string;
  actorEmployeeId: string | null;
  actorRole: string;
  ipAddress: string | null;
  occurredAt: string;
  detail: Record<string, any>;
}

/** What each recorded event actually means to somebody reading the screen. */
const EVENT_LABEL: Record<string, string> = {
  INSPECTION_CREATED: 'Spring measured',
  SUPERVISOR_OVERRIDE_RECORDED: 'Supervisor override',
  INSPECTION_SYNCED: 'Offline work synced',
  BATCH_EXPORTED: 'Records exported',
  SECURITY_ALERT: 'Security alert',
  AUTH_LOGIN: 'Signed in',
  OTP_GENERATED: 'One-time code issued',
  OTP_VERIFIED: 'One-time code accepted',
  WAGON_REGISTERED: 'Wagon registered',
  WAGON_STAGE_TRANSITION: 'Wagon moved stage',
  CHECKLIST_ITEM_INSPECTED: 'Checklist item inspected',
  CHECKLIST_ITEM_UPDATED: 'Checklist item changed',
  GATE_SIGNOFF_COMPLETED: 'Wagon released at gate',
  CERTIFICATE_GENERATED: 'Release certificate issued',
  PHOTO_UPLOADED: 'Photograph taken',
  INVENTORY_RESERVED: 'Stores item reserved',
  INVENTORY_ISSUED: 'Stores item issued',
  INVENTORY_RESTOCKED: 'Stores restocked',
  COMPONENT_ASSIGNED: 'Component fitted',
  COMPONENT_UNASSIGNED: 'Component removed',
  VOICE_COMMAND_LOGGED: 'Voice command',
  CV_MEASUREMENT_LOGGED: 'Caliper reading',
  ACOUSTIC_DEFECT_LOGGED: 'Acoustic check',
  OMRS_TRIAGE_RUN: 'Triage run'
};

/* Events that change what leaves the workshop are the ones worth spotting. */
const WEIGHTY = new Set([
  'GATE_SIGNOFF_COMPLETED',
  'SUPERVISOR_OVERRIDE_RECORDED',
  'SECURITY_ALERT',
  'CERTIFICATE_GENERATED',
  'BATCH_EXPORTED'
]);

const ROLE_TINT: Record<string, string> = {
  INSPECTOR: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  SUPERVISOR: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  ADMIN: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  DRM: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  SYSTEM: 'bg-slate-500/15 text-slate-300 border-slate-500/30'
};

/** The one or two fields of a payload that are worth reading at a glance. */
function summarise(entry: ActivityEntry): string {
  const d = entry.detail || {};
  const parts: string[] = [];
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = d[k];
      if (v !== undefined && v !== null && v !== '' && typeof v !== 'object') return String(v);
    }
    return null;
  };

  // A sign-in has no wagon and no part; what matters is whether it worked.
  if (entry.eventType === 'AUTH_LOGIN') {
    const who = pick('username', 'attemptedUsername') || entry.actorId;
    const outcome = pick('outcome');
    const why = pick('reason');
    if (outcome === 'REFUSED') {
      return `refused — ${who}${why ? ` (${why.toLowerCase().replace(/_/g, ' ')})` : ''}`;
    }
    return String(who);
  }

  const wagon = pick('wagonNumber', 'wagon_number', 'wagonId');
  if (wagon) parts.push(wagon);
  const part = pick('partName', 'itemName', 'componentType', 'springPosition');
  if (part) parts.push(part);
  const from = pick('fromStage', 'previousStage');
  const to = pick('toStage', 'newStage', 'stage');
  if (from && to) parts.push(`${from} → ${to}`);
  else if (to) parts.push(String(to));
  const status = pick('status', 'band', 'verdict', 'result');
  if (status) parts.push(status);
  const height = pick('measuredHeight', 'freeHeight');
  if (height) parts.push(`${height} mm`);
  const reason = pick('reason', 'justification', 'note');
  if (reason) parts.push(reason.length > 70 ? `${reason.slice(0, 70)}…` : reason);

  return parts.join(' · ');
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
  } catch {
    return iso;
  }
}

export const ActivityLog: React.FC = () => {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [eventType, setEventType] = useState('');
  const [role, setRole] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);

  const load = async (nextLimit = limit) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getActivityLog({
        limit: nextLimit,
        search: search.trim() || undefined,
        eventType: eventType || undefined,
        role: role || undefined
      });
      setEntries(res.data.entries);
      setTotal(res.data.total);
    } catch (err: any) {
      setEntries([]);
      setError(err?.message || 'The activity log could not be read.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eventType, role]);

  return (
    <div className="space-y-4" data-testid="activity-log">
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
        <form
          onSubmit={e => { e.preventDefault(); load(); }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search a wagon number, a part, or a person"
            className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
            data-testid="activity-search"
          />
          <select
            value={eventType}
            onChange={e => setEventType(e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
            data-testid="activity-event-filter"
          >
            <option value="">Every kind of event</option>
            {Object.entries(EVENT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
            data-testid="activity-role-filter"
          >
            <option value="">Everyone</option>
            <option value="INSPECTOR">Inspectors</option>
            <option value="SUPERVISOR">Supervisors</option>
            <option value="ADMIN">Administrators</option>
            <option value="DRM">DRM</option>
            <option value="SYSTEM">The system itself</option>
          </select>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-2 text-sm font-bold text-white flex items-center gap-2"
          >
            <RefreshCwIcon size={14} /> Search
          </button>
        </form>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
        <span data-testid="activity-count">
          {loading ? 'Reading the ledger…' : `Showing ${entries.length} of ${total} recorded actions`}
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldIcon size={12} className="text-emerald-400" />
          Append-only — entries cannot be edited or deleted, by anyone
        </span>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-8 text-center text-slate-400 text-sm">
          Nothing matches that search.
        </div>
      )}

      <div className="space-y-2">
        {entries.map(entry => {
          const label = EVENT_LABEL[entry.eventType] || entry.eventType;
          const detail = summarise(entry);
          const isOpen = expanded === entry.id;
          return (
            <div
              key={entry.id}
              className={`bg-slate-800/60 border rounded-lg overflow-hidden ${
                WEIGHTY.has(entry.eventType) ? 'border-amber-600/50' : 'border-slate-700'
              }`}
              data-testid="activity-entry"
            >
              <button
                onClick={() => setExpanded(isOpen ? null : entry.id)}
                className="w-full text-left px-4 py-3 hover:bg-slate-700/30 transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                  <span className="text-sm font-bold text-white min-w-[11rem]">{label}</span>
                  <span className="text-sm text-slate-300 flex-1 truncate">{detail || '—'}</span>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${
                      ROLE_TINT[entry.actorRole] || ROLE_TINT.SYSTEM
                    }`}
                  >
                    {entry.actorRole}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-slate-400">
                  <span className="font-semibold text-slate-300">{entry.actorName}</span>
                  {entry.actorEmployeeId && <span>#{entry.actorEmployeeId}</span>}
                  <span className="tabular-nums">{formatWhen(entry.occurredAt)}</span>
                  <span className="tabular-nums">
                    {entry.ipAddress
                      ? `from ${entry.ipAddress}`
                      : 'address not recorded'}
                  </span>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-slate-700 bg-slate-900/60 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2 font-bold">
                    Everything recorded for this action
                  </div>
                  <pre className="text-[11px] text-slate-300 overflow-x-auto whitespace-pre-wrap break-words">
{JSON.stringify(entry.detail, null, 2)}
                  </pre>
                  <div className="mt-2 text-[10px] text-slate-500 font-mono break-all">
                    entry {entry.id}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!loading && entries.length < total && (
        <button
          onClick={() => { const next = limit + 100; setLimit(next); load(next); }}
          className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg py-2.5 text-sm font-semibold text-slate-300"
        >
          Show older entries ({total - entries.length} more)
        </button>
      )}
    </div>
  );
};
