// The optional case profile: demographics, history, medications, vitals,
// labs (with trends) and a timeline. Saved as you type. Keep it de-identified.

import { useRef } from 'react';
import { ClipboardPaste, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import type { CaseProfile, LabRow, TimelineEvent } from '../../api/cases';
import { Field } from '../ui';
import { LabTrends } from './LabTrends';

const uid = () => Math.random().toString(36).slice(2, 10);

/** Body surface area (Mosteller), used for paediatric dosing and z-scores. */
export function bsa(p: CaseProfile): number | null {
  if (!p.weightKg || !p.heightCm) return null;
  return Math.sqrt((p.heightCm * p.weightKg) / 3600);
}

/** "date,test,value,unit,low,high" rows (headers optional), from CSV or a spreadsheet paste. */
export function parseLabs(text: string): LabRow[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const split = (l: string) => l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
  let cols = ['date', 'test', 'value', 'unit', 'low', 'high'];
  const first = split(lines[0]).map((h) => h.toLowerCase());
  if (first.some((h) => /^(test|analyte|name|value|result|date)$/.test(h))) {
    cols = first.map((h) =>
      /date|time/.test(h) ? 'date' : /test|analyte|name|component/.test(h) ? 'test' : /value|result/.test(h) ? 'value' : /unit/.test(h) ? 'unit' : /low|min|lower/.test(h) ? 'low' : /high|max|upper/.test(h) ? 'high' : h,
    );
    lines.shift();
  }
  return lines
    .map((l) => {
      const v = split(l);
      const get = (k: string) => {
        const i = cols.indexOf(k);
        return i >= 0 ? v[i] || undefined : undefined;
      };
      return { id: uid(), date: get('date'), test: get('test') ?? '', value: get('value') ?? '', unit: get('unit'), low: get('low'), high: get('high') };
    })
    .filter((r) => r.test && r.value);
}

interface Props {
  profile: CaseProfile;
  onChange: (p: CaseProfile) => void;
}

export function Profile({ profile: p, onChange }: Props) {
  const set = (patch: Partial<CaseProfile>) => onChange({ ...p, ...patch });
  const text = (k: keyof CaseProfile, label: string, rows = 3, hint?: string, placeholder?: string) => (
    <Field label={label} hint={hint}>
      <textarea rows={rows} value={(p[k] as string) ?? ''} placeholder={placeholder} onChange={(e) => set({ [k]: e.target.value } as Partial<CaseProfile>)} />
    </Field>
  );
  const labs = p.labs ?? [];
  const events = p.events ?? [];
  const setLab = (id: string, patch: Partial<LabRow>) => set({ labs: labs.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const setEvent = (id: string, patch: Partial<TimelineEvent>) => set({ events: events.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const paste = useRef<HTMLTextAreaElement | null>(null);
  const area = bsa(p);

  return (
    <div className="cs-profile">
      <div className="cs-phi">
        <ShieldAlert size={14} />
        Everything here is optional. Keep it de-identified for presenting: no names, record numbers, exact birth dates or
        addresses. Use age, not date of birth.
      </div>

      <h3 className="sp-h3">Patient</h3>
      <div className="sp-grid3">
        <Field label="Age"><input value={p.age ?? ''} onChange={(e) => set({ age: e.target.value })} placeholder="e.g. 6 years, 3 months, 34 wk GA" /></Field>
        <Field label="Sex"><input value={p.sex ?? ''} onChange={(e) => set({ sex: e.target.value })} placeholder="e.g. Female" /></Field>
        <Field label="Weight (kg)">
          <input type="number" min={0} step={0.1} value={p.weightKg ?? ''} onChange={(e) => set({ weightKg: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </Field>
        <Field label="Height (cm)" hint={area ? `BSA ${area.toFixed(2)} m² (Mosteller)` : undefined}>
          <input type="number" min={0} step={0.5} value={p.heightCm ?? ''} onChange={(e) => set({ heightCm: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </Field>
        <Field label="Specialty"><input value={p.specialty ?? ''} onChange={(e) => set({ specialty: e.target.value })} placeholder="e.g. Pediatric cardiology" /></Field>
      </div>

      <h3 className="sp-h3">Presentation</h3>
      <Field label="Chief complaint"><input value={p.chiefComplaint ?? ''} onChange={(e) => set({ chiefComplaint: e.target.value })} /></Field>
      {text('hpi', 'History of present illness', 4)}
      {text('question', 'Clinical question for the audience', 2, 'What you want the room to decide or learn.')}
      <div className="sp-grid2">
        {text('diagnoses', 'Diagnoses / problem list', 4, 'One per line.')}
        {text('procedures', 'Procedures & surgeries', 4, 'One per line, with dates if known.')}
        {text('pmh', 'Past medical history', 3)}
        {text('medications', 'Medications', 3, 'With doses for weight-based dosing.')}
        {text('allergies', 'Allergies', 2)}
        {text('familyHistory', 'Family history', 2)}
        {text('socialHistory', 'Social / developmental history', 2)}
        {text('exam', 'Examination', 3)}
      </div>

      <h3 className="sp-h3">Vitals</h3>
      <div className="cs-vitals">
        {(['hr', 'bp', 'rr', 'spo2', 'temp'] as const).map((k) => (
          <Field key={k} label={{ hr: 'Heart rate', bp: 'Blood pressure', rr: 'Resp. rate', spo2: 'SpO₂', temp: 'Temp' }[k]}>
            <input value={p.vitals?.[k] ?? ''} onChange={(e) => set({ vitals: { ...p.vitals, [k]: e.target.value } })} placeholder={{ hr: 'bpm', bp: 'mmHg', rr: '/min', spo2: '%', temp: '°C' }[k]} />
          </Field>
        ))}
      </div>

      <h3 className="sp-h3">Labs</h3>
      <div className="cs-labs">
        <table className="data-table">
          <thead>
            <tr><th>Date</th><th>Test</th><th>Value</th><th>Unit</th><th>Ref low</th><th>Ref high</th><th /></tr>
          </thead>
          <tbody>
            {labs.map((l) => (
              <tr key={l.id}>
                <td><input type="date" value={l.date ?? ''} onChange={(e) => setLab(l.id, { date: e.target.value })} /></td>
                <td><input value={l.test} onChange={(e) => setLab(l.id, { test: e.target.value })} placeholder="BNP" /></td>
                <td><input value={l.value} onChange={(e) => setLab(l.id, { value: e.target.value })} /></td>
                <td><input value={l.unit ?? ''} onChange={(e) => setLab(l.id, { unit: e.target.value })} /></td>
                <td><input value={l.low ?? ''} onChange={(e) => setLab(l.id, { low: e.target.value })} /></td>
                <td><input value={l.high ?? ''} onChange={(e) => setLab(l.id, { high: e.target.value })} /></td>
                <td><button className="icon-btn" title="Remove" onClick={() => set({ labs: labs.filter((x) => x.id !== l.id) })}><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="cs-labs-actions">
          <button className="btn btn-sm" onClick={() => set({ labs: [...labs, { id: uid(), test: '', value: '', date: new Date().toISOString().slice(0, 10) }] })}>
            <Plus size={13} /> Add result
          </button>
          <details className="cs-paste">
            <summary className="btn btn-sm"><ClipboardPaste size={13} /> Paste from a spreadsheet or CSV</summary>
            <textarea ref={paste} rows={4} placeholder={'date,test,value,unit,low,high\n2026-11-01,BNP,1200,pg/mL,0,100'} />
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                const rows = parseLabs(paste.current?.value ?? '');
                if (rows.length) set({ labs: [...labs, ...rows] });
                if (paste.current) paste.current.value = '';
              }}
            >
              Add rows
            </button>
          </details>
        </div>
        <LabTrends labs={labs} />
      </div>

      <h3 className="sp-h3">Timeline</h3>
      <div className="cs-events">
        {events.map((e) => (
          <div key={e.id} className="cs-event">
            <input type="date" value={e.date ?? ''} onChange={(x) => setEvent(e.id, { date: x.target.value })} />
            <input value={e.title} onChange={(x) => setEvent(e.id, { title: x.target.value })} placeholder="e.g. Glenn procedure, admitted, started milrinone" />
            <input value={e.detail ?? ''} onChange={(x) => setEvent(e.id, { detail: x.target.value })} placeholder="Detail" />
            <button className="icon-btn" title="Remove" onClick={() => set({ events: events.filter((x) => x.id !== e.id) })}><Trash2 size={13} /></button>
          </div>
        ))}
        <button className="btn btn-sm" onClick={() => set({ events: [...events, { id: uid(), title: '' }] })}>
          <Plus size={13} /> Add event
        </button>
      </div>

      <h3 className="sp-h3">Teaching</h3>
      {text('teachingPoints', 'Teaching points / take-home messages', 4, 'Shown on the closing slide.')}
    </div>
  );
}
