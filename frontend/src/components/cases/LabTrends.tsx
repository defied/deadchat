// Small trend charts, one per lab test: values over time against the
// reference range, out-of-range points marked.

import { useMemo } from 'react';
import type { LabRow } from '../../api/cases';

interface Series {
  test: string;
  unit?: string;
  low?: number;
  high?: number;
  points: Array<{ date?: string; v: number; label: string }>;
}

const num = (s?: string) => {
  const v = parseFloat(String(s ?? '').replace(/[<>,≤≥\s]/g, ''));
  return Number.isFinite(v) ? v : undefined;
};

export function labSeries(labs: LabRow[]): Series[] {
  const by = new Map<string, Series>();
  for (const l of labs) {
    const v = num(l.value);
    if (!l.test.trim() || v === undefined) continue;
    const key = l.test.trim().toLowerCase();
    let s = by.get(key);
    if (!s) {
      s = { test: l.test.trim(), unit: l.unit, points: [] };
      by.set(key, s);
    }
    s.unit ??= l.unit;
    s.low ??= num(l.low);
    s.high ??= num(l.high);
    s.points.push({ date: l.date, v, label: l.value });
  }
  for (const s of by.values()) s.points.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  return [...by.values()];
}

export function LabTrends({ labs, large }: { labs: LabRow[]; large?: boolean }) {
  const series = useMemo(() => labSeries(labs), [labs]);
  if (!series.length) return null;
  return (
    <div className={`cs-trends ${large ? 'large' : ''}`}>
      {series.map((s) => <Spark key={s.test} s={s} large={large} />)}
    </div>
  );
}

function Spark({ s, large }: { s: Series; large?: boolean }) {
  const W = large ? 320 : 220;
  const H = large ? 120 : 70;
  const pad = 8;
  const vals = s.points.map((p) => p.v);
  const lo = Math.min(...vals, s.low ?? Infinity);
  const hi = Math.max(...vals, s.high ?? -Infinity);
  const span = hi - lo || Math.abs(hi) || 1;
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const x = (i: number) => (s.points.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (s.points.length - 1));
  const out = (v: number) => (s.low !== undefined && v < s.low) || (s.high !== undefined && v > s.high);
  const last = s.points[s.points.length - 1];
  return (
    <figure className="cs-spark">
      <figcaption>
        <strong>{s.test}</strong>
        <span className={out(last.v) ? 'cs-out' : ''}>
          {last.label} {s.unit}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${s.test} trend`}>
        {s.low !== undefined && s.high !== undefined && (
          <rect x={0} width={W} y={y(s.high)} height={Math.max(1, y(s.low) - y(s.high))} className="cs-ref" />
        )}
        {s.points.length > 1 && <polyline points={s.points.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')} className="cs-line" />}
        {s.points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.v)} r={large ? 4 : 3} className={out(p.v) ? 'cs-pt out' : 'cs-pt'}>
            <title>{`${p.date ?? ''} ${p.label} ${s.unit ?? ''}`.trim()}</title>
          </circle>
        ))}
      </svg>
      <div className="cs-spark-axis">
        <span>{s.points[0].date ?? ''}</span>
        {s.points.length > 1 && <span>{last.date ?? ''}</span>}
      </div>
    </figure>
  );
}
