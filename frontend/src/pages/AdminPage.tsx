import { useState, useEffect, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { Sidebar } from '../components/Sidebar';
import { UserTable } from '../components/admin/UserTable';
import { UserForm } from '../components/admin/UserForm';
import { PasswordReset } from '../components/admin/PasswordReset';
import { UsageChart } from '../components/admin/UsageChart';
import { ModelsPanel } from '../components/admin/ModelsPanel';
import { LiveStatsPanel } from '../components/admin/LiveStatsPanel';
import type { User } from '../api/auth';
import type { UsageSummary } from '../api/users';
import * as usersApi from '../api/users';
import { Users, BarChart3, Plus, Cpu, Activity } from 'lucide-react';

type Tab = 'users' | 'usage' | 'models' | 'live';

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [usageData, setUsageData] = useState<UsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [passwordResetUser, setPasswordResetUser] = useState<User | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const data = await usersApi.getUsers();
      setUsers(data);
    } catch {
      // Handle silently
    }
  }, []);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const data = await usersApi.getUsageSummary();
      setUsageData(data);
    } catch {
      // Handle silently
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (tab === 'usage') {
      loadUsage();
    }
  }, [tab, loadUsage]);

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setShowForm(true);
  };

  const handleCreate = () => {
    setEditingUser(null);
    setShowForm(true);
  };

  const handleSave = async (data: {
    username: string;
    email: string;
    password?: string;
    role: 'user' | 'admin';
  }) => {
    try {
      if (editingUser) {
        await usersApi.updateUser(editingUser.id, {
          username: data.username,
          email: data.email,
          role: data.role,
        });
      } else {
        await usersApi.createUser({
          username: data.username,
          email: data.email,
          password: data.password!,
          role: data.role,
        });
      }
      setShowForm(false);
      setEditingUser(null);
      loadUsers();
    } catch {
      // Handle error
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    try {
      await usersApi.deleteUser(id);
      loadUsers();
    } catch {
      // Handle error
    }
  };

  const handlePasswordReset = async (userId: string, newPassword: string) => {
    try {
      await usersApi.resetPassword(userId, newPassword);
      setPasswordResetUser(null);
    } catch {
      // Handle error
    }
  };

  return (
    <Layout sidebar={<Sidebar />}>
      <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)' }}>
            Admin
          </h2>

          {tab === 'users' && (
            <button
              onClick={handleCreate}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                border: 'none',
                color: '#fff',
                background: 'var(--color-accent)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                borderRadius: 'var(--radius)',
              }}
            >
              <Plus size={14} />
              New user
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          <TabButton
            active={tab === 'users'}
            onClick={() => setTab('users')}
            icon={<Users size={14} />}
            label="Users"
          />
          <TabButton
            active={tab === 'usage'}
            onClick={() => setTab('usage')}
            icon={<BarChart3 size={14} />}
            label="Usage"
          />
          <TabButton
            active={tab === 'models'}
            onClick={() => setTab('models')}
            icon={<Cpu size={14} />}
            label="Models"
          />
          <TabButton
            active={tab === 'live'}
            onClick={() => setTab('live')}
            icon={<Activity size={14} />}
            label="Live"
          />
        </div>

        {tab === 'users' && (
          <div
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              background: 'var(--color-surface)',
            }}
          >
            <UserTable
              users={users}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onResetPassword={setPasswordResetUser}
            />
          </div>
        )}

        {tab === 'usage' && (
          <UsageChart data={usageData} loading={usageLoading} />
        )}

        {tab === 'models' && (
          <ModelsPanel />
        )}

        {tab === 'live' && (
          <LiveStatsPanel />
        )}

        {showForm && (
          <UserForm
            user={editingUser}
            onSave={handleSave}
            onCancel={() => {
              setShowForm(false);
              setEditingUser(null);
            }}
          />
        )}

        {passwordResetUser && (
          <PasswordReset
            user={passwordResetUser}
            onSave={handlePasswordReset}
            onCancel={() => setPasswordResetUser(null)}
          />
        )}
      </div>
    </Layout>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        border: active ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid var(--color-border)',
        background: active ? 'var(--color-accent-dim)' : 'transparent',
        color: active ? 'var(--color-accent-light)' : 'var(--color-text-dim)',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        transition: 'all 0.15s',
      }}
    >
      {icon}
      {label}
    </button>
  );
}