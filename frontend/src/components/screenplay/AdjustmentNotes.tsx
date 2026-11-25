// Adjustment notes for a shot: they steer the photo search, and the AI
// applies them when it draws or recreates the frame.

import { useState } from 'react';
import { AlertTriangle, Loader2, Plus, SlidersHorizontal, X } from 'lucide-react';
import type { Adjustment, Shot, ShotPlanView } from '../../api/screenplays';
import { newId } from './format';

/**
 * Fine-tuning notes for a shot's frame ("night, not day", "no cars", "lower
 * camera"). They steer the photo search, and the AI applies the ones that are
 * on when it draws or recreates the frame.
 */
export function AdjustmentNotes({ shot, plan, onChange, hint }: { shot: Shot; plan?: ShotPlanView; onChange: (a: Adjustment[]) => void; hint?: string }) {
  const notes = shot.adjustments ?? [];
  const [draft, setDraft] = useState('');
  const set = (id: string, patch: Partial<Adjustment>) => onChange(notes.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...notes, { id: newId('adj'), text }]);
    setDraft('');
  };
  const on = notes.filter((n) => !n.off && n.text.trim()).length;
  return (
    <div className="sp-adj wide">
      <span className="sp-adj-head">
        <SlidersHorizontal size={11} /> Adjustment notes
        {on > 0 && <span className="sp-adj-count">{on} applied</span>}
        {plan?.adjusting && <Loader2 size={11} className="spin" aria-label="Applying notes" />}
      </span>
      {notes.map((n) => (
        <div key={n.id} className={`sp-adj-row ${n.off ? 'off' : ''}`}>
          <input type="checkbox" checked={!n.off} onChange={(e) => set(n.id, { off: e.target.checked ? undefined : true })} title={n.off ? 'Apply this note' : 'Stop applying this note (keeps it)'} />
          <textarea rows={1} value={n.text} onChange={(e) => set(n.id, { text: e.target.value })} aria-label="Adjustment note" />
          <button className="icon-btn" title="Remove note" onClick={() => onChange(notes.filter((x) => x.id !== n.id))}>
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="sp-adj-row add">
        <Plus size={12} />
        <input
          value={draft}
          placeholder="e.g. night not day, wider, no cars, warmer light"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          aria-label="New adjustment note"
        />
      </div>
      {hint && <span className="field-hint">{hint}</span>}
      {plan?.adjustNote && (
        <div className="sp-shot-warn">
          <AlertTriangle size={12} /> {plan.adjustNote}
        </div>
      )}
    </div>
  );
}

