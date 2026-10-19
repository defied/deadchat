import { useState, useEffect, useCallback } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { PageHeader, RouteTabs, Alert, errorMessage } from '../components/ui';
import { UserTable } from '../components/admin/UserTable';
import { UserForm } from '../components/admin/UserForm';
import { PasswordReset } from '../components/admin/PasswordReset';
import { UsageChart } from '../components/admin/UsageChart';
import { ModelsPanel } from '../components/admin/ModelsPanel';
import { ModelPricingPanel } from '../components/admin/ModelPricingPanel';
import { LiveStatsPanel } from '../components/admin/LiveStatsPanel';
import { ComfyUIStatsPanel } from '../components/admin/ComfyUIStatsPanel';
import { AgentsPanel } from '../components/admin/AgentsPanel';
import { MediaPanel } from '../components/admin/MediaPanel';
import type { User } from '../api/auth';
import type { UsageSummary } from '../api/users';
import * as usersApi from '../api/users';
import { Users, BarChart3, Plus, Cpu, Activity, DollarSign, Bot, Image, Shield, Wand2 } from 'lucide-react';

const TABS = [
  { id: 'users', label: 'Users', icon: <Users size={14} /> },
  { id: 'models', label: 'Models', icon: <Cpu size={14} /> },
  { id: 'agents', label: 'Agent library', icon: <Bot size={14} /> },
  { id: 'media', label: 'Media', icon: <Wand2 size={14} /> },
  { id: 'usage', label: 'Usage', icon: <BarChart3 size={14} /> },
  { id: 'pricing', label: 'Pricing', icon: <DollarSign size={14} /> },
  { id: 'live', label: 'Ollama live', icon: <Activity size={14} /> },
  { id: 'comfyui', label: 'ComfyUI', icon: <Image size={14} /> },
] as const;
type Tab = (typeof TABS)[number]['id'];

const SUBTITLES: Record<Tab, string> = {
  users: 'Accounts, roles and passwords.',
  models: 'Install, configure and choose the default chat model.',
  agents: 'Starter agents every user can chat with or copy.',
  media: 'Image and video models, hosted-model API key, and defaults.',
  usage: 'Requests and tokens per user and model.',
  pricing: 'Per-model prices used to estimate cost in Usage.',
  live: 'What Ollama is running right now: VRAM, throughput, recent requests.',
  comfyui: 'Image/video backend: queue, VRAM and history.',
};

export function AdminPage() {
  const params = useParams();
  const tab = (params.tab ?? 'users') as Tab;
  const [error, setError] = useState('');
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
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const data = await usersApi.getUsageSummary();
      setUsageData(data);
    } catch (err) {
      setError(errorMessage(err));
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
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    try {
      await usersApi.deleteUser(id);
      loadUsers();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handlePasswordReset = async (userId: string, newPassword: string) => {
    try {
      await usersApi.resetPassword(userId, newPassword);
      setPasswordResetUser(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!TABS.some((t) => t.id === tab)) return <Navigate to="/admin/users" replace />;

  return (
    <div className="page">
      <PageHeader
        icon={<Shield size={20} />}
        title="Admin"
        subtitle={SUBTITLES[tab]}
        actions={
          tab === 'users' && (
            <button className="btn btn-primary" onClick={handleCreate}>
              <Plus size={14} /> New user
            </button>
          )
        }
      />

      <RouteTabs tabs={TABS.map((t) => ({ to: `/admin/${t.id}`, label: t.label, icon: t.icon }))} />

      {error && <Alert onClose={() => setError('')}>{error}</Alert>}

      {tab === 'users' && (
        <div className="table-wrap">
          <UserTable
            users={users}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onResetPassword={setPasswordResetUser}
          />
        </div>
      )}
      {tab === 'usage' && <UsageChart data={usageData} loading={usageLoading} />}
      {tab === 'pricing' && <ModelPricingPanel />}
      {tab === 'models' && <ModelsPanel />}
      {tab === 'live' && <LiveStatsPanel />}
      {tab === 'comfyui' && <ComfyUIStatsPanel />}
      {tab === 'agents' && <AgentsPanel />}
      {tab === 'media' && <MediaPanel />}

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
  );
}
