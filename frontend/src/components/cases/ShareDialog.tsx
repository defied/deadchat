// Share a case with other members: view only, or allowed to edit.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Trash2, UserPlus } from 'lucide-react';
import * as api from '../../api/cases';
import type { CaseDetail } from '../../api/cases';
import { Alert, Modal, errorMessage } from '../ui';

const ROLES = [
  { value: 'viewer', label: 'Can view' },
  { value: 'editor', label: 'Can edit' },
] as const;

export function ShareDialog({ detail, onChange, onClose }: { detail: CaseDetail; onChange: (d: CaseDetail) => void; onClose: () => void }) {
  const members = useQuery({ queryKey: ['case-members'], queryFn: () => api.listMembers(), staleTime: 60_000 });
  const [pick, setPick] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shared = useMemo(() => new Set(detail.shares.map((s) => s.userId)), [detail.shares]);
  const available = (members.data ?? []).filter((m) => !shared.has(m.id));

  const run = async (fn: () => Promise<CaseDetail | { left: true }>) => {
    setBusy(true);
    setError(null);
    try {
      const d = await fn();
      if ('case' in d) onChange(d);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Share “${detail.case.title}”`} onClose={onClose} busy={busy} width={520} footer={<button className="btn" onClick={onClose}>Done</button>}>
      <p className="field-hint cs-share-hint">
        Members you add see this case in their Medical cases list, including every file and analysis. <strong>Can edit</strong> also lets
        them change the profile, evidence and analyses. Only you can delete the case or change who it’s shared with. Keep it de-identified.
      </p>
      <div className="cs-share-add">
        <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy || !available.length} aria-label="Member">
          <option value="">{members.isLoading ? 'Loading members…' : available.length ? 'Choose a member…' : 'No other members can use Medical cases'}</option>
          {available.map((m) => (
            <option key={m.id} value={m.id}>{m.username}</option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value as 'viewer' | 'editor')} disabled={busy} aria-label="Permission">
          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <button
          className="btn btn-primary"
          disabled={busy || !pick}
          onClick={() =>
            void run(async () => {
              const d = await api.shareCase(detail.case.id, Number(pick), role);
              setPick('');
              return d;
            })
          }
        >
          <UserPlus size={14} /> Share
        </button>
      </div>
      {error && <Alert>{error}</Alert>}
      <ul className="cs-share-list">
        <li>
          <span className="avatar">{detail.owner?.[0]?.toUpperCase() ?? '?'}</span>
          <strong>{detail.owner}</strong>
          <span className="sp-grow" />
          <span className="field-hint">Owner</span>
        </li>
        {detail.shares.map((s) => (
          <li key={s.userId}>
            <span className="avatar">{s.username[0]?.toUpperCase()}</span>
            <span>
              {s.username}
              {!s.canOpen && (
                <span className="cs-warn" title="An admin needs to give them the Medical cases section">
                  <AlertTriangle size={11} /> can’t open Medical cases
                </span>
              )}
            </span>
            <span className="sp-grow" />
            <select value={s.role} disabled={busy} onChange={(e) => void run(() => api.shareCase(detail.case.id, s.userId, e.target.value as 'viewer' | 'editor'))} aria-label={`${s.username}’s permission`}>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <button className="icon-btn" title={`Stop sharing with ${s.username}`} disabled={busy} onClick={() => void run(() => api.unshareCase(detail.case.id, s.userId))}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {!detail.shares.length && <li className="field-hint">Not shared with anyone yet.</li>}
      </ul>
    </Modal>
  );
}
