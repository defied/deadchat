import { useEffect, useState } from 'react';
import { Field, Modal, errorMessage } from './ui';

export interface AgentDraft {
  id?: number;
  name: string;
  description: string;
  system_prompt: string;
  agentic?: number | boolean;
}

export interface AgentSaveData {
  name: string;
  description: string;
  system_prompt: string;
  agentic: boolean;
}

interface AgentEditorProps {
  agent: AgentDraft | null; // null = create new
  title?: string;
  onSave: (data: AgentSaveData) => Promise<void> | void;
  onCancel: () => void;
}

export function AgentEditor({ agent, title, onSave, onCancel }: AgentEditorProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [agentic, setAgentic] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(agent?.name || '');
    setDescription(agent?.description || '');
    setSystemPrompt(agent?.system_prompt || '');
    setAgentic(!!agent?.agentic);
    setError('');
  }, [agent]);

  const submit = async () => {
    if (!name.trim()) return setError('Name is required.');
    if (!systemPrompt.trim()) return setError('System prompt is required.');
    setError('');
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description: description.trim(), system_prompt: systemPrompt, agentic });
    } catch (err) {
      setError(errorMessage(err, 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={title || (agent?.id ? `Edit agent: ${agent.name}` : 'New agent')}
      onClose={onCancel}
      busy={saving}
      footer={
        <>
          <span className="composer-hint" style={{ marginRight: 'auto' }}>
            <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to save
          </span>
          <button className="btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : agent?.id ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <div
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.key === 's')) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <Field label="Name" hint="Shown in the chat list and header.">
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={saving} placeholder="e.g. Code Reviewer" autoFocus />
        </Field>

        <Field label="Description" hint="One short line about what this agent is for.">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving}
            placeholder="e.g. Terse, specific code review"
          />
        </Field>

        <Field label="System prompt" hint="Sent as the system message at the start of every chat with this agent.">
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            disabled={saving}
            placeholder="You are a focused code reviewer. Find bugs, security issues…"
            rows={12}
            style={{ resize: 'vertical', minHeight: 220, fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.5 }}
          />
        </Field>

        <label className="toggle">
          <input type="checkbox" checked={agentic} onChange={(e) => setAgentic(e.target.checked)} disabled={saving} />
          <span>
            <b style={{ color: 'var(--color-text)' }}>Can use tools</b>
            <div className="field-hint" style={{ marginTop: 2 }}>
              Runs a plan → tool → observe loop: the agent can generate images and video, list models and check
              backends. Replies arrive per step instead of token-by-token. Works best with tool-capable models such as
              qwen3.8.
            </div>
          </span>
        </label>

        {error && (
          <div className="alert alert-error" style={{ marginTop: 14, marginBottom: 0 }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
