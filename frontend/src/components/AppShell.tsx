import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  ChevronsLeft,
  ChevronsRight,
  Clapperboard,
  Image,
  Key,
  LogOut,
  Menu,
  MessageSquare,
  Shield,
  Skull,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import wsManager from '../api/ws';
import client from '../api/client';

interface NavDef {
  to: string;
  label: string;
  icon: ReactNode;
  hint: string;
}

const GROUPS: Array<{ label: string; items: NavDef[]; admin?: boolean }> = [
  {
    label: 'Workspace',
    items: [
      { to: '/chat', label: 'Chat', icon: <MessageSquare size={17} />, hint: 'Talk to local models and agents' },
      { to: '/agents', label: 'Agents', icon: <Bot size={17} />, hint: 'Personas and tool-using assistants' },
    ],
  },
  {
    label: 'Create',
    items: [
      { to: '/generate', label: 'Generate', icon: <Image size={17} />, hint: 'Images and video with ComfyUI' },
      { to: '/studio', label: 'Studio', icon: <Clapperboard size={17} />, hint: 'Characters: portraits and voices' },
    ],
  },
  {
    label: 'Developer',
    items: [{ to: '/tokens', label: 'API access', icon: <Key size={17} />, hint: 'Tokens for Ollama/OpenAI/Anthropic clients' }],
  },
  {
    label: 'Admin',
    admin: true,
    items: [{ to: '/admin', label: 'Admin', icon: <Shield size={17} />, hint: 'Users, models, usage, monitoring' }],
  },
];

interface BackendHealth {
  ollama: { reachable: boolean };
  comfyui: { reachable: boolean };
}

function BackendStatus() {
  const { data } = useQuery({
    queryKey: ['backend-health'],
    queryFn: async () => (await client.get<BackendHealth>('/api/health/backends')).data,
    refetchInterval: 30_000,
  });
  if (!data) return null;
  const dot = (ok: boolean) => <span className={`status-dot ${ok ? 'ok' : 'bad'}`} />;
  return (
    <div className="status-row nav-label" style={{ padding: '0 10px' }} title="Backend reachability">
      <span>
        {dot(data.ollama.reachable)}Ollama
      </span>
      <span>
        {dot(data.comfyui.reachable)}ComfyUI
      </span>
    </div>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('dc.navCollapsed') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);

  // One WebSocket for the whole signed-in app (not per page).
  useEffect(() => {
    wsManager.connect();
    return () => wsManager.disconnect();
  }, []);

  useEffect(() => {
    localStorage.setItem('dc.navCollapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    wsManager.disconnect();
    await logout();
    navigate('/login');
  };

  const current = GROUPS.flatMap((g) => g.items).find((i) => location.pathname.startsWith(i.to));

  return (
    <div className="app-shell">
      <div className="mobile-topbar">
        <button className="icon-btn" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
          <Menu size={20} />
        </button>
        <span>{current?.label ?? 'DeadChat'}</span>
      </div>

      <nav className={`nav${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`} aria-label="Main">
        <div className="nav-brand">
          <span className="nav-logo">
            <Skull size={17} />
          </span>
          <span className="nav-label">DeadChat</span>
        </div>

        <div className="nav-body">
          {GROUPS.filter((g) => !g.admin || user?.role === 'admin').map((g) => (
            <div key={g.label}>
              {g.label !== 'Admin' && <div className="nav-group-label">{g.label}</div>}
              {g.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  title={collapsed ? `${item.label} — ${item.hint}` : item.hint}
                >
                  {item.icon}
                  <span className="nav-label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </div>

        <div className="nav-footer">
          <BackendStatus />
          <div className="nav-user">
            <span className="avatar">{user?.username?.[0]?.toUpperCase() ?? '?'}</span>
            <div className="nav-user-meta">
              <div className="nav-user-name">{user?.username}</div>
              {user?.role === 'admin' && <span className="badge badge-accent">admin</span>}
            </div>
            <button className="icon-btn nav-label" onClick={handleLogout} title="Sign out" aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </div>
          <button
            className="nav-item nav-collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{ border: 'none', background: 'transparent' }}
          >
            {collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
            <span className="nav-label">Collapse</span>
          </button>
          {collapsed && (
            <button className="nav-item" onClick={handleLogout} title="Sign out" style={{ border: 'none', background: 'transparent' }}>
              <LogOut size={16} />
            </button>
          )}
        </div>
      </nav>
      <div className={`scrim${mobileOpen ? ' show' : ''}`} onClick={() => setMobileOpen(false)} />

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
