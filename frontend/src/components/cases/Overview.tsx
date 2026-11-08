// The case at a glance: who, why, the summary, a timeline, every piece of
// evidence grouped by kind, lab trends and the clinical background. Any card
// opens the drill-down.

import { useMemo, useState } from 'react';
import { Bot, CalendarDays, Edit3, HelpCircle, Loader2, Sparkles } from 'lucide-react';
import { CATEGORIES, type CaseDetail, type CaseItem, type CaseProfile } from '../../api/cases';
import { Markdown } from '../chat/Markdown';
import { Alert, EmptyState } from '../ui';
import { LabTrends } from './LabTrends';
import { bsa } from './Profile';
import { Thumb, kindLabel } from './Viewer';

export function facts(p: CaseProfile): string[] {
  const area = bsa(p);
  return [
    p.age,
    p.sex,
    p.weightKg ? `${p.weightKg} kg` : '',
    p.heightCm ? `${p.heightCm} cm` : '',
    area ? `BSA ${area.toFixed(2)} m²` : '',
    p.specialty,
  ].filter(Boolean) as string[];
}

export const BACKGROUND: Array<[keyof CaseProfile, string]> = [
  ['hpi', 'History of present illness'],
  ['diagnoses', 'Diagnoses'],
  ['procedures', 'Procedures'],
  ['pmh', 'Past history'],
  ['medications', 'Medications'],
  ['allergies', 'Allergies'],
  ['familyHistory', 'Family history'],
  ['socialHistory', 'Social / developmental'],
  ['exam', 'Examination'],
];

export function vitalsLine(p: CaseProfile): string {
  const v = p.vitals ?? {};
  return [v.hr && `HR ${v.hr}`, v.bp && `BP ${v.bp}`, v.rr && `RR ${v.rr}`, v.spo2 && `SpO₂ ${v.spo2}%`.replace('%%', '%'), v.temp && `T ${v.temp}`].filter(Boolean).join(' · ');
}

interface TimelineEntry {
  date: string;
  title: string;
  detail?: string;
  item?: CaseItem;
}

export function timeline(d: CaseDetail): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...(d.case.profile.events ?? []).filter((e) => e.title.trim()).map((e) => ({ date: e.date ?? '', title: e.title, detail: e.detail })),
    ...d.items.filter((i) => i.include && i.takenAt).map((i) => ({ date: i.takenAt!, title: i.title, item: i })),
  ];
  return entries.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
}

export function Overview({
  detail,
  onOpen,
  onDraft,
  drafting,
  draftError,
  onSaveSummary,
}: {
  detail: CaseDetail;
  onOpen: (id: number) => void;
  onDraft: () => void;
  drafting: boolean;
  draftError: string | null;
  onSaveSummary: (s: string) => void;
}) {
  const { case: c, items } = detail;
  const p = c.profile;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.summary ?? '');
  const shown = items.filter((i) => i.include);
  const groups = useMemo(
    () => CATEGORIES.map((cat) => ({ ...cat, items: shown.filter((i) => i.category === cat.value) })).filter((g) => g.items.length),
    [shown],
  );
  const tl = timeline(detail);
  const background = BACKGROUND.filter(([k]) => String(p[k] ?? '').trim());
  const vitals = vitalsLine(p);

  if (!shown.length && !Object.values(p).some((v) => (Array.isArray(v) ? v.length : v && (typeof v !== 'object' || Object.values(v).some(Boolean))))) {
    return (
      <EmptyState title="Nothing to show yet">
        Add evidence on the Evidence tab and, optionally, a profile. This page then pulls it together for presenting.
      </EmptyState>
    );
  }

  return (
    <div className="cs-overview">
      <section className="cs-hero">
        <div className="cs-chips">{facts(p).map((f) => <span key={f} className="cs-chip static">{f}</span>)}</div>
        {p.chiefComplaint && <p className="cs-cc">{p.chiefComplaint}</p>}
        {vitals && <p className="field-hint">{vitals}</p>}
        {p.question && (
          <div className="cs-question">
            <HelpCircle size={15} />
            <span>{p.question}</span>
          </div>
        )}
      </section>

      <section className="cs-panel">
        <div className="cs-panel-head">
          <h3>Summary</h3>
          {c.summary && <span className={`cs-badge ${c.summarySource === 'ai' ? 'ai' : ''}`}>{c.summarySource === 'ai' ? 'AI draft: check before presenting' : 'Written by you'}</span>}
          <span className="sp-grow" />
          <button className="btn btn-sm" onClick={onDraft} disabled={drafting} title="Draft a summary from the profile and evidence with the local model">
            {drafting ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />} {c.summary ? 'Redraft with AI' : 'Draft with AI'}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              setDraft(c.summary ?? '');
              setEditing(!editing);
            }}
          >
            <Edit3 size={13} /> {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>
        {draftError && <Alert>{draftError}</Alert>}
        {editing ? (
          <div className="cs-summary-edit">
            <textarea rows={12} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Markdown is fine." />
            <button className="btn btn-primary btn-sm" onClick={() => { onSaveSummary(draft); setEditing(false); }}>Save summary</button>
          </div>
        ) : c.summary ? (
          <div className="cs-summary"><Markdown text={c.summary} /></div>
        ) : (
          <p className="field-hint">No summary yet. Write one, or let the local model draft one from everything in the case.</p>
        )}
      </section>

      {tl.length > 0 && (
        <section className="cs-panel">
          <div className="cs-panel-head"><h3><CalendarDays size={15} /> Timeline</h3></div>
          <ol className="cs-timeline">
            {tl.map((e, i) => (
              <li key={i} className={e.item ? 'evidence' : ''}>
                <span className="cs-tl-date">{e.date || 'Undated'}</span>
                {e.item ? (
                  <button className="cs-link" onClick={() => onOpen(e.item!.id)}>{e.title}</button>
                ) : (
                  <span>
                    <strong>{e.title}</strong>
                    {e.detail && <span className="field-hint"> · {e.detail}</span>}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.value} className="cs-panel">
          <div className="cs-panel-head"><h3>{g.label}</h3><span className="field-hint">{g.items.length}</span></div>
          <div className="cs-cards">
            {g.items.map((it) => (
              <button key={it.id} className="cs-card" onClick={() => onOpen(it.id)}>
                <Thumb caseId={c.id} item={it} />
                <span className="cs-card-title">{it.title}</span>
                <span className="cs-card-meta">{[kindLabel(it), it.takenAt].filter(Boolean).join(' · ')}</span>
                {(it.notes || it.aiNotes) && (
                  <span className="cs-card-notes">
                    {it.notes || (
                      <>
                        <Bot size={11} /> {it.aiNotes}
                      </>
                    )}
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}

      {(p.labs?.length ?? 0) > 0 && (
        <section className="cs-panel">
          <div className="cs-panel-head"><h3>Lab trends</h3></div>
          <LabTrends labs={p.labs!} />
        </section>
      )}

      {background.length > 0 && (
        <section className="cs-panel">
          <div className="cs-panel-head"><h3>Background</h3></div>
          <div className="cs-background">
            {background.map(([k, label]) => (
              <details key={k} open={k === 'hpi' || k === 'diagnoses'}>
                <summary>{label}</summary>
                <p>{String(p[k])}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {p.teachingPoints?.trim() && (
        <section className="cs-panel">
          <div className="cs-panel-head"><h3>Teaching points</h3></div>
          <p className="cs-pre">{p.teachingPoints}</p>
        </section>
      )}
    </div>
  );
}
