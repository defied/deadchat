// The words a photo search uses, shown as chips the writer can remove or add
// to. Nothing is searched that isn't listed here.

import { useState } from 'react';
import { Plus, X } from 'lucide-react';

export function SearchWords({ words, onChange, disabled, why }: { words: string[]; onChange: (w: string[]) => void; disabled?: boolean; why?: Record<string, string> }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const w = draft.trim().toLowerCase().replace(/\s+/g, ' ');
    if (w.length > 1 && !words.includes(w)) onChange([...words, w].slice(0, 6));
    setDraft('');
  };
  return (
    <div className="sp-words">
      {words.map((w) => (
        <span key={w} className="sp-chip sp-word" title={why?.[w] || undefined}>
          {w}
          <button className="icon-btn" title={`Don’t search for “${w}”`} onClick={() => onChange(words.filter((x) => x !== w))} disabled={disabled} aria-label={`Remove ${w}`}>
            <X size={11} />
          </button>
        </span>
      ))}
      {words.length < 6 && (
        <span className="sp-word-add">
          <Plus size={12} />
          <input
            value={draft}
            placeholder={words.length ? 'add words' : 'type what to search for'}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            onBlur={add}
            aria-label="Add search words"
          />
        </span>
      )}
    </div>
  );
}
