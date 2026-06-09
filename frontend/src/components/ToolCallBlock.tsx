import { ChevronDown, ChevronRight, Wrench, CheckCircle, Loader } from 'lucide-react';
import { useState } from 'react';

export interface ToolCallEntry {
  id: string;
  step: number;
  name: string;
  input: unknown;
  result?: unknown;
}

interface ToolCallBlockProps {
  tc: ToolCallEntry;
}

export function ToolCallBlock({ tc }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const done = tc.result !== undefined;

  return (
    <div
      style={{
        margin: '6px 0',
        background: 'var(--color-surface)',
        border: `1px solid ${done ? 'rgba(99,102,241,0.25)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        fontSize: 13,
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-secondary)',
          textAlign: 'left',
        }}
      >
        {done ? (
          <CheckCircle size={14} color="var(--color-accent-light)" />
        ) : (
          <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
        )}
        <Wrench size={13} color="var(--color-text-dim)" />
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent-light)', flexGrow: 1 }}>
          {tc.name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>step {tc.step}</span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '10px 12px' }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Input</div>
            <pre
              style={{
                margin: 0,
                padding: '8px 10px',
                background: '#1e1e2e',
                borderRadius: 4,
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-text-secondary)',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {JSON.stringify(tc.input, null, 2)}
            </pre>
          </div>

          {tc.result !== undefined && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Result</div>
              <pre
                style={{
                  margin: 0,
                  padding: '8px 10px',
                  background: '#1e1e2e',
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-accent-light)',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {JSON.stringify(tc.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
