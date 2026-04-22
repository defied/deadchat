import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { UsageSummary } from '../../api/users';

interface UsageChartProps {
  data: UsageSummary | null;
  loading: boolean;
}

const COLORS = ['#6366f1', '#818cf8', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

export function UsageChart({ data, loading }: UsageChartProps) {
  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 300,
          color: 'var(--color-text-dim)',
          fontSize: 13,
        }}
      >
        Loading usage data...
      </div>
    );
  }

  if (!data) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 300,
          color: 'var(--color-text-dim)',
          fontSize: 13,
        }}
      >
        No usage data available
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          <StatCard
            label="Total Tokens"
            value={data.totalTokens.toLocaleString()}
            color="var(--color-accent)"
          />
          <StatCard
            label="Total Requests"
            value={data.totalRequests.toLocaleString()}
            color="var(--color-success)"
          />
        </div>

        <h3
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--color-text-dim)',
            marginBottom: 16,
          }}
        >
          Tokens per day
        </h3>

        <div style={{ width: '100%', height: 300 }}>
          <ResponsiveContainer>
            <BarChart data={data.dailyUsage}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#a1a1aa', fontSize: 11, fontFamily: 'Inter' }}
                stroke="var(--color-border)"
                tickFormatter={(val: string) => {
                  const d = new Date(val);
                  return `${d.getMonth() + 1}/${d.getDate()}`;
                }}
              />
              <YAxis
                tick={{ fill: '#a1a1aa', fontSize: 11, fontFamily: 'Inter' }}
                stroke="var(--color-border)"
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  fontFamily: 'Inter',
                  fontSize: 12,
                  color: '#e4e4e7',
                }}
                labelStyle={{ color: '#6366f1' }}
              />
              <Bar dataKey="tokens" fill="#6366f1" radius={[4, 4, 0, 0]} opacity={0.85} />
              <Bar dataKey="requests" fill="#22c55e" radius={[4, 4, 0, 0]} opacity={0.85} />
              <Legend
                wrapperStyle={{
                  fontFamily: 'Inter',
                  fontSize: 12,
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h3
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--color-text-dim)',
            marginBottom: 16,
          }}
        >
          Per-user breakdown
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
          {data.perUser.map((pu, i) => (
            <div
              key={pu.userId}
              style={{
                padding: '14px 18px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                background: 'var(--color-surface)',
                borderLeft: `3px solid ${COLORS[i % COLORS.length]}`,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: COLORS[i % COLORS.length],
                  marginBottom: 8,
                }}
              >
                {pu.username}
              </div>
              <div style={{ display: 'flex', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>Tokens</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>
                    {pu.tokens.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>Requests</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>
                    {pu.requests.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: '18px 22px',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-surface)',
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: 'var(--color-text-dim)',
          fontWeight: 500,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color,
        }}
      >
        {value}
      </div>
    </div>
  );
}