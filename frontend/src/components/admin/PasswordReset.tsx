import { useState } from 'react';
import { X } from 'lucide-react';
import type { User } from '../../api/auth';

interface PasswordResetProps {
  user: User;
  onSave: (userId: string, newPassword: string) => void;
  onCancel: () => void;
}

export function PasswordReset({ user, onSave, onCancel }: PasswordResetProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Password is required');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setError('');
    onSave(user.id, password);
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--color-text-secondary)',
    marginBottom: 6,
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
            Reset password
          </h3>
          <button
            onClick={onCancel}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-dim)',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 20 }}>
          <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--color-text-dim)' }}>
            Resetting password for <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>{user.username}</span>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>New Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          {error && (
            <div
              style={{
                color: 'var(--color-danger)',
                fontSize: 12,
                marginBottom: 14,
                padding: '8px 12px',
                background: 'rgba(239, 68, 68, 0.08)',
                borderRadius: 'var(--radius)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: '8px 20px',
                border: '1px solid var(--color-border)',
                background: 'transparent',
                color: 'var(--color-text-secondary)',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                padding: '8px 20px',
                border: 'none',
                background: 'var(--color-warning)',
                color: '#000',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}