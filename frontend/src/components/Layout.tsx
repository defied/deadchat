import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { LogOut, PanelLeftClose, PanelLeft } from 'lucide-react';

interface LayoutProps {
  sidebar?: React.ReactNode;
  children: React.ReactNode;
}

export function Layout({ sidebar, children }: LayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {sidebar && (
        <div
          style={{
            width: sidebarOpen ? 272 : 0,
            minWidth: sidebarOpen ? 272 : 0,
            transition: 'all 0.2s ease',
            overflow: 'hidden',
            borderRight: sidebarOpen ? '1px solid var(--color-border)' : 'none',
            background: 'var(--color-surface)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {sidebar}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div
          style={{
            height: 52,
            minHeight: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {sidebar && (
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 4,
                  color: 'var(--color-text-dim)',
                  cursor: 'pointer',
                  display: 'flex',
                }}
              >
                {sidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeft size={20} />}
              </button>
            )}
            <span
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--color-text)',
                letterSpacing: '-0.01em',
              }}
            >
              DeadChat
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {user && (
              <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
                {user.username}
                {user.role === 'admin' && (
                  <span
                    style={{
                      marginLeft: 8,
                      padding: '2px 6px',
                      background: 'var(--color-accent-dim)',
                      color: 'var(--color-accent-light)',
                      fontSize: 11,
                      fontWeight: 500,
                      borderRadius: 4,
                    }}
                  >
                    Admin
                  </span>
                )}
              </span>
            )}
            <button
              onClick={handleLogout}
              style={{
                background: 'none',
                border: '1px solid var(--color-border)',
                padding: '6px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                color: 'var(--color-text-secondary)',
              }}
            >
              <LogOut size={14} />
              Logout
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
      </div>
    </div>
  );
}