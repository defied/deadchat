// Small shared UI primitives. Styling lives in theme/ui.css.

import { useEffect, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { AlertTriangle, Info, Loader2, X } from 'lucide-react';

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">
          {icon}
          {title}
        </h1>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Section({ title, hint, actions, children }: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="section-title">{title}</div>
          {hint ? <div className="section-hint">{hint}</div> : <div style={{ height: 10 }} />}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Alert({
  kind = 'error',
  children,
  onClose,
}: {
  kind?: 'error' | 'info' | 'warn';
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {kind === 'info' ? <Info size={15} style={{ marginTop: 2 }} /> : <AlertTriangle size={15} style={{ marginTop: 2 }} />}
        <div>{children}</div>
      </div>
      {onClose && (
        <button className="icon-btn" onClick={onClose} aria-label="Dismiss" style={{ padding: 2, color: 'inherit' }}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div>{children}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="center-fill">
      <Loader2 size={16} className="spin" /> {label}
    </div>
  );
}

export interface TabDef {
  to: string;
  label: string;
  icon?: ReactNode;
}

/** Tabs backed by real routes, so every tab is linkable and survives reload. */
export function RouteTabs({ tabs }: { tabs: TabDef[] }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
          {t.icon}
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
  busy,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  busy?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return (
    <div className="modal-scrim" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        style={width ? { width } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

/** Extracts a human-readable message from an axios/fetch error. */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err && typeof err === 'object') {
    const e = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
    return e.response?.data?.error || e.response?.data?.message || e.message || fallback;
  }
  return fallback;
}
