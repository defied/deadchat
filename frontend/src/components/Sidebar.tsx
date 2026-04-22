import { Plus, Trash2, MessageSquare, Image, Shield, Key } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { ChatSession } from '../api/chat';

interface SidebarProps {
  sessions?: ChatSession[];
  activeSessionId?: string | null;
  onSelectSession?: (id: string) => void;
  onNewSession?: () => void;
  onDeleteSession?: (id: string) => void;
}

export function Sidebar({
  sessions = [],
  activeSessionId = null,
  onSelectSession,
  onNewSession,
  onDeleteSession,
}: SidebarProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 12 }}>
      {onNewSession && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={onNewSession}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '9px 16px',
              border: '1px solid var(--color-border-light)',
              color: 'var(--color-text)',
              background: 'var(--color-surface-light)',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <Plus size={16} />
            New chat
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => onSelectSession?.(session.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '9px 12px',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              background:
                activeSessionId === session.id
                  ? 'var(--color-accent-dim)'
                  : 'transparent',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => {
              if (activeSessionId !== session.id) {
                e.currentTarget.style.background = 'var(--color-surface-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeSessionId !== session.id) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <span
              style={{
                fontSize: 13,
                color:
                  activeSessionId === session.id
                    ? 'var(--color-accent-light)'
                    : 'var(--color-text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
            >
              {session.title}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSession?.(session.id);
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: 4,
                color: 'var(--color-text-dim)',
                cursor: 'pointer',
                opacity: 0,
                transition: 'opacity 0.1s',
                display: 'flex',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1';
                e.currentTarget.style.color = 'var(--color-danger)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0';
                e.currentTarget.style.color = 'var(--color-text-dim)';
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--color-border)',
          paddingTop: 12,
          marginTop: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <NavItem
          icon={<MessageSquare size={16} />}
          label="Chat"
          active={location.pathname === '/'}
          onClick={() => navigate('/')}
        />
        <NavItem
          icon={<Image size={16} />}
          label="Generate"
          active={location.pathname === '/generate'}
          onClick={() => navigate('/generate')}
        />
        <NavItem
          icon={<Key size={16} />}
          label="API Tokens"
          active={location.pathname === '/tokens'}
          onClick={() => navigate('/tokens')}
        />
        {user?.role === 'admin' && (
          <NavItem
            icon={<Shield size={16} />}
            label="Admin"
            active={location.pathname === '/admin'}
            onClick={() => navigate('/admin')}
          />
        )}
      </div>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        background: active ? 'var(--color-accent-dim)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius)',
        color: active ? 'var(--color-accent-light)' : 'var(--color-text-dim)',
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        transition: 'all 0.1s',
      }}
    >
      {icon}
      {label}
    </button>
  );
}