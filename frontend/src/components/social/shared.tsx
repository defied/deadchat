// Building blocks shared by the Social Media wizard steps.

import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { fetchMediaBlobUrl } from '../../api/media';
import type { Detail, Meta } from '../../api/influencers';
import { Alert, errorMessage } from '../ui';

/** Authenticated image or video that fills its container. */
export function AuthedMedia({ mediaId, video, alt = '' }: { mediaId: number; video?: boolean; alt?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    fetchMediaBlobUrl(mediaId)
      .then((u) => {
        url = u;
        if (!cancelled) setSrc(u);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [mediaId]);
  if (failed) return <span className="field-hint">Unavailable</span>;
  if (!src) return <Loader2 size={18} className="spin" />;
  return video ? <video src={src} muted loop playsInline autoPlay controls /> : <img src={src} alt={alt} />;
}

/** Edit a list of short strings (topics, themes, feeds, domains). */
export function ListEditor({
  values,
  onChange,
  placeholder,
  max = 20,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v || values.includes(v) || values.length >= max) return;
    onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="list-editor">
      {values.length > 0 && (
        <div className="chips">
          {values.map((v) => (
            <span key={v} className="chip">
              {v}
              <button className="icon-btn" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="list-editor-row">
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button className="btn btn-sm" onClick={add} disabled={!draft.trim()}>
          <Plus size={13} /> Add
        </button>
      </div>
    </div>
  );
}

export function CheckList({ title, items, kind }: { title?: string; items: string[]; kind: 'error' | 'warn' | 'info' }) {
  if (!items.length) return null;
  return (
    <Alert kind={kind}>
      {title && <strong>{title}</strong>}
      <ul className="issue-list">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </Alert>
  );
}

export interface StepProps {
  detail: Detail;
  meta: Meta;
  /** Save a patch, then optionally move to the next step. */
  save: (patch: Parameters<typeof import('../../api/influencers').updateInfluencer>[1], next?: boolean) => Promise<void>;
  /** Replace the cached detail after an action endpoint. */
  apply: (d: Detail) => void;
  next: () => void;
  back: () => void;
  isAdmin: boolean;
}

/** Run an async action with busy + error state. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, setError, run };
}

export function StepNav({
  onBack,
  onNext,
  nextLabel = 'Save & continue',
  busy,
  nextDisabled,
  extra,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  busy?: boolean;
  nextDisabled?: boolean;
  extra?: ReactNode;
}) {
  return (
    <div className="wizard-nav">
      <div>
        {onBack && (
          <button className="btn" onClick={onBack} disabled={busy}>
            Back
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {extra}
        {onNext && (
          <button className="btn btn-primary" onClick={onNext} disabled={busy || nextDisabled}>
            {busy ? <Loader2 size={14} className="spin" /> : null}
            {nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export const STEP_LABELS: Record<string, string> = {
  rules: 'Ground rules',
  persona: 'Persona',
  look: 'Look',
  portfolio: 'Portfolio',
  research: 'Topics & sources',
  plan: 'Posting plan',
  accounts: 'Accounts',
  launch: 'Review & launch',
};

export function statusBadge(status: string) {
  const cls =
    status === 'active' || status === 'published' || status === 'connected' || status === 'approved'
      ? 'badge badge-success'
      : status === 'blocked' || status === 'failed' || status === 'error' || status === 'rejected'
        ? 'badge badge-danger'
        : status === 'review' || status === 'paused' || status === 'pending'
          ? 'badge badge-warn'
          : 'badge';
  return <span className={cls}>{status}</span>;
}
