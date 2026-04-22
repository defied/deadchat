import type { User } from '../../api/auth';
import { Edit2, Trash2, Key } from 'lucide-react';

interface UserTableProps {
  users: User[];
  onEdit: (user: User) => void;
  onDelete: (id: string) => void;
  onResetPassword: (user: User) => void;
}

export function UserTable({ users, onEdit, onDelete, onResetPassword }: UserTableProps) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
        }}
      >
        <thead>
          <tr>
            {['Username', 'Email', 'Role', 'Created', 'Actions'].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: 'left',
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--color-border)',
                  color: 'var(--color-text-dim)',
                  fontSize: 11,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr
              key={user.id}
              style={{ transition: 'background 0.15s' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-surface-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <td
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              >
                {user.username}
              </td>
              <td
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--color-border)',
                  color: 'var(--color-text-dim)',
                }}
              >
                {user.email}
              </td>
              <td
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <span
                  style={{
                    padding: '2px 10px',
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 500,
                    border: `1px solid ${user.role === 'admin' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
                    color: user.role === 'admin' ? 'var(--color-warning)' : 'var(--color-success)',
                    background:
                      user.role === 'admin'
                        ? 'rgba(245, 158, 11, 0.08)'
                        : 'rgba(34, 197, 94, 0.08)',
                  }}
                >
                  {user.role.toUpperCase()}
                </span>
              </td>
              <td
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--color-border)',
                  color: 'var(--color-text-dim)',
                  fontSize: 12,
                }}
              >
                {new Date(user.createdAt).toLocaleDateString()}
              </td>
              <td
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => onEdit(user)}
                    style={{
                      background: 'none',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius)',
                      padding: '4px 8px',
                      color: 'var(--color-text-dim)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                    }}
                    title="Edit user"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={() => onResetPassword(user)}
                    style={{
                      background: 'none',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius)',
                      padding: '4px 8px',
                      color: 'var(--color-text-dim)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                    }}
                    title="Reset password"
                  >
                    <Key size={12} />
                  </button>
                  <button
                    onClick={() => onDelete(user.id)}
                    style={{
                      background: 'none',
                      border: '1px solid rgba(255, 68, 68, 0.3)',
                      borderRadius: 'var(--radius)',
                      padding: '4px 8px',
                      color: 'var(--color-danger)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                    }}
                    title="Delete user"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {users.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: 40,
            color: 'var(--color-text-dim)',
            fontSize: 13,
          }}
        >
          No users found
        </div>
      )}
    </div>
  );
}
