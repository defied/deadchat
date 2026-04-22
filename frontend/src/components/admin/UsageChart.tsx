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

function formatCost(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: amount < 1 ? 4 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(4)}`;
  }
}

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

  const currency = data.currency || 'USD';

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          <StatCard
            label="Total Tokens"
            value={data.totalTokens.toLocaleString()}
            sub={`${data.totalTokensIn.toLocaleString()} in / ${data.totalTokensOut.toLocaleString()} out`}
            color="var(--color-accent)"
          />
          <StatCard
            label="Total Requests"
            value={data.totalRequests.toLocaleString()}
            sub={`${data.days}-day window`}
            color="var(--color-success)"
          />
          <StatCard
            label="Estimated Cost"
            value={formatCost(data.estimatedCost, currency)}
            sub="Based on model pricing table"
            color="#f59e0b"
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
                formatter={(value: number, name: string) => {
                  if (name === 'estimatedCost') return [formatCost(value, currency), 'cost'];
                  return [value.toLocaleString(), name];
                }}
              />
              <Bar dataKey="tokensIn" stackId="tokens" fill="#6366f1" radius={[0, 0, 0, 0]} opacity={0.85} />
              <Bar dataKey="tokensOut" stackId="tokens" fill="#22c55e" radius={[4, 4, 0, 0]} opacity={0.85} />
              <Bar dataKey="requests" fill="#818cf8" radius={[4, 4, 0, 0]} opacity={0.85} />
              <Legend wrapperStyle={{ fontFamily: 'Inter', fontSize: 12 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ marginBottom: 32 }}>
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <Metric label="Tokens" value={pu.tokens.toLocaleString()} />
                <Metric label="Requests" value={pu.requests.toLocaleString()} />
                <Metric label="Est. cost" value={formatCost(pu.estimatedCost, currency)} />
              </div>
            </div>
          ))}
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
          Per-model breakdown
        </h3>

        {data.perModel.length === 0 ? (
          <div style={{ color: 'var(--color-text-dim)', fontSize: 13 }}>No model usage recorded yet.</div>
        ) : (
          <div style={{ overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--color-surface)', color: 'var(--color-text-dim)' }}>
                  <th style={thStyle}>Model</th>
                  <th style={thStyle}>Requests</th>
                  <th style={thStyle}>Tokens in</th>
                  <th style={thStyle}>Tokens out</th>
                  <th style={thStyle}>Total tokens</th>
                  <th style={thStyle}>Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {data.perModel.map((m, i) => (
                  <tr key={m.model} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ ...tdStyle, color: COLORS[i % COLORS.length], fontWeight: 500 }}>{m.model}</td>
                    <td style={tdStyle}>{m.requests.toLocaleString()}</td>
                    <td style={tdStyle}>{m.tokensIn.toLocaleString()}</td>
                    <td style={tdStyle}>{m.tokensOut.toLocaleString()}</td>
                    <td style={tdStyle}>{m.tokens.toLocaleString()}</td>
                    <td style={tdStyle}>{formatCost(m.estimatedCost, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontWeight: 500,
  fontSize: 12,
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  color: 'var(--color-text)',
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{value}</div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 200,
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
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 6 }}>{sub}</div>
      )}
    </div>
  );
}
