// Film agents: every AI helper the screenplay uses, with the instructions it
// works from. Rewrite any of them for this screenplay; the output format at
// the end stays fixed so DeadChat can still read the answers.

import { useEffect, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Eye, Loader2, RotateCcw } from 'lucide-react';
import * as api from '../../api/screenplays';
import type { FilmAgent, ScreenplayDoc } from '../../api/screenplays';
import { msg } from './ShotFinder';

export function FilmAgentsTab({ doc, update }: { doc: ScreenplayDoc; update: (fn: (d: ScreenplayDoc) => ScreenplayDoc, group?: string) => void }) {
  const [agents, setAgents] = useState<FilmAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // In the order you meet them while working.
    const order = ['summarizer', 'mentor', 'researcher', 'checklist', 'checker', 'adjuster', 'casting', 'describer', 'sound'];
    const rank = (id: string) => (order.indexOf(id) + 1 || 99);
    api.listFilmAgents().then((a) => setAgents([...a].sort((x, y) => rank(x.id) - rank(y.id))), (e) => setError(msg(e)));
  }, []);

  const set = (a: FilmAgent, text: string) =>
    update((d) => {
      const own = { ...(d.agentPrompts ?? {}) };
      if (!text.trim() || text.trim() === a.instructions.trim()) delete own[a.id];
      else own[a.id] = text;
      return { ...d, agentPrompts: Object.keys(own).length ? own : undefined };
    }, `agent:${a.id}`);

  if (error) return <p className="sp-shot-warn">{error}</p>;
  if (!agents) return <p className="field-hint"><Loader2 size={14} className="spin" /> Loading the film agents…</p>;
  return (
    <div className="sp-agents">
      <p className="field-hint">
        These are the AI helpers behind this screenplay and the instructions each works from. Edit any of them for this screenplay: say what to
        focus on, the style you want, what to avoid. Changes apply from the next time the agent runs. The output format at the end of each stays
        fixed so DeadChat can read the answers.
      </p>
      {agents.map((a) => (
        <AgentCard key={a.id} agent={a} own={doc.agentPrompts?.[a.id]} onChange={(t) => set(a, t)} />
      ))}
    </div>
  );
}

function AgentCard({ agent: a, own, onChange }: { agent: FilmAgent; own?: string; onChange: (t: string) => void }) {
  const [showFormat, setShowFormat] = useState(false);
  const edited = own !== undefined;
  return (
    <section className={`sp-agent ${edited ? 'edited' : ''}`}>
      <header>
        <span className="sp-agent-icon">{a.model === 'vision' ? <Eye size={15} /> : <Bot size={15} />}</span>
        <div>
          <h3>
            {a.name} {edited && <span className="sp-agent-badge">Edited</span>}
          </h3>
          <p>{a.role}</p>
        </div>
        <span className="sp-grow" />
        <span className="field-hint">{a.model === 'vision' ? 'Screenplay model, looking at photos' : 'Screenplay model'}</span>
        {edited && (
          <button className="btn btn-sm" onClick={() => onChange('')} title="Go back to DeadChat's instructions">
            <RotateCcw size={13} /> Reset to default
          </button>
        )}
      </header>
      <textarea rows={Math.min(16, Math.max(4, Math.ceil((own ?? a.instructions).length / 110)))} value={own ?? a.instructions} onChange={(e) => onChange(e.target.value)} spellCheck />
      {a.format && (
        <button className="sp-agent-format-toggle" onClick={() => setShowFormat(!showFormat)}>
          {showFormat ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Output format (fixed)
        </button>
      )}
      {showFormat && <pre className="sp-agent-format">{a.format}</pre>}
    </section>
  );
}
