// Change your own password: a page in the app, and a full-screen step on the
// first sign-in after an admin set a temporary password.

import { useState } from 'react';
import { KeyRound, Loader2, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import wsManager from '../api/ws';

const MIN = 8;

export function ChangePasswordForm({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { user, changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<{ field?: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < MIN) return setError({ field: 'newPassword', text: `Use at least ${MIN} characters` });
    if (next !== confirm) return setError({ field: 'confirm', text: 'The new passwords don’t match' });
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
      onDone?.();
    } catch (err) {
      const d = (err as { response?: { data?: { error?: string; field?: string } } })?.response?.data;
      setError({ field: d?.field, text: d?.error ?? (err as Error).message ?? 'Couldn’t change the password' });
    } finally {
      setBusy(false);
    }
  };

  const bad = (f: string) => (error?.field === f ? 'invalid' : undefined);

  return (
    <form className="pw-form" onSubmit={submit}>
      {/* Lets password managers save the new password against the right account. */}
      <input type="text" name="username" autoComplete="username" value={user?.username ?? ''} readOnly hidden />
      <label>
        <span>{forced ? 'Temporary password' : 'Current password'}</span>
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus className={bad('currentPassword')} />
      </label>
      <label>
        <span>New password</span>
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={MIN} className={bad('newPassword')} />
        <small className="field-hint">At least {MIN} characters, and not your username. A short phrase works well.</small>
      </label>
      <label>
        <span>Confirm new password</span>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className={bad('confirm')} />
      </label>
      {error && <p className="pw-error">{error.text}</p>}
      {done && !forced && <p className="pw-ok">Password changed. Other devices have been signed out.</p>}
      <button className="btn btn-primary" type="submit" disabled={busy || !current || !next || !confirm}>
        {busy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} {forced ? 'Set password and continue' : 'Change password'}
      </button>
    </form>
  );
}

/** Shown instead of the app until a user with a temporary password picks their own. */
export function ForcedPasswordChange() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="pw-screen">
      <div className="pw-card">
        <h1>Choose your password</h1>
        <p>
          Welcome{user ? `, ${user.username}` : ''}. Your account was set up with a temporary password. Pick your own to
          continue.
        </p>
        <ChangePasswordForm forced />
        <button
          className="btn btn-ghost btn-sm pw-signout"
          onClick={async () => {
            wsManager.disconnect();
            await logout();
            navigate('/login');
          }}
        >
          <LogOut size={13} /> Sign out
        </button>
      </div>
    </div>
  );
}

export function ChangePasswordPage() {
  return (
    <div className="page">
      <div className="pw-page">
        <h1>Change password</h1>
        <p className="field-hint">Changing it signs you out everywhere else.</p>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
