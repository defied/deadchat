import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface AgentDraft {
  id?: number;
  name: string;
  description: string;
  system_prompt: string;
}

interface AgentEditorProps {
  agent: AgentDraft | null; // null = create new
  title?: string;
  onSave: (data: { name: string; description: string; system_prompt: string }) => Promise<void> | void;
  onCancel: () => void;
}

export function AgentEditor({ agent, title, onSave, onCancel }: AgentEditorProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(agent?.name || '');
    setDescription(agent?.description || '');
    setSystemPrompt(agent?.system_prompt || '');
    setError('');
  }, [agent]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onCancel();
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, description, systemPrompt, saving]);

  const submit = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!systemPrompt.trim()) { setError('System prompt is required.'); return; }
    setError('');
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        system_prompt: systemPrompt,
      });
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const headerText = title || (agent?.id ? `Edit agent: ${agent.name}` : 'New agent');

  return (
    <div
      onClick={() => { if (!saving) onCancel(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720, maxHeight: '90vh',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid var(--color-border)',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
            {headerText}
          </div>
          <button onClick={onCancel} disabled={saving} style={iconBtn} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '14px 18px', overflowY: 'auto', flex: 1 }}>
          <Field label="Name" hint="Shown in the picker and chat header.">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              placeholder="e.g. Code Reviewer"
              style={inputStyle}
              autoFocus
            />
          </Field>

          <Field label="Description" hint="One short line summarizing what this agent is for.">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              placeholder="e.g. Terse, specific code review"
              style={inputStyle}
            />
          </Field>

          <Field label="System prompt" hint="Sent as a system message at the start of every chat using this agent.">
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              disabled={saving}
              placeholder="You are a focused code reviewer. Find bugs, security issues…"
              rows={12}
              style={{
                ...inputStyle,
                resize: 'vertical',
                minHeight: 220,
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                fontSize: 12.5,
                lineHeight: 1.5,
              }}
            />
          </Field>

          {error && (
            <div style={{
              marginTop: 12, padding: '8px 12px',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: 'var(--radius)',
              color: 'var(--color-danger)', fontSize: 12,
            }}>
              {error}
            </div>
          )}
        </div>

        <div style={{
          display: 'flex', gap: 8, justifyContent: 'flex-end',
          padding: '12px 18px', borderTop: '1px solid var(--color-border)',
        }}>
          <button onClick={onCancel} disabled={saving} style={secondaryBtn}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving} style={primaryBtn}>
            {saving ? 'Saving…' : agent?.id ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: 'block', fontSize: 11, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: 0.6,
        color: 'var(--color-text-dim)', marginBottom: 4,
      }}>{label}</label>
      {children}
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 10px', fontSize: 13,
  background: 'var(--color-input-bg, var(--color-surface-light))',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  outline: 'none',
};

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--color-text-dim)',
  cursor: 'pointer', padding: 4, display: 'flex',
};

const primaryBtn: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-accent)',
  border: 'none', color: '#fff', fontSize: 13, fontWeight: 500,
  borderRadius: 'var(--radius)', cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  padding: '8px 16px', background: 'transparent',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-secondary)', fontSize: 13,
  borderRadius: 'var(--radius)', cursor: 'pointer',
};
