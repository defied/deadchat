// Background tasks: photo searches and mentor turns keep running when their
// window is minimised, while the writer carries on. A small tray shows them
// (including when they're queued behind a render) and opens them when done.
// Finished mentor turns are applied to their shot here.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp, GraduationCap, Loader2, Search, X, AlertTriangle } from 'lucide-react';
import * as api from '../../api/screenplays';
import type { ScreenplayDoc } from '../../api/screenplays';

export interface BgFind {
  kind: 'find';
  id: number;
  shotId: string;
}

interface Ctx {
  /** Keep watching a search after its window closes. */
  watchFind: (findId: number, shotId: string) => void;
  /** Start a mentor turn; resolves when it's queued. */
  startMentor: (shotId: string, message?: string) => Promise<void>;
  /** The mentor turn in progress for a shot, if any. */
  mentorFor: (shotId: string) => api.MentorJob | undefined;
}

const BackgroundContext = createContext<Ctx | null>(null);
export const useBackground = () => useContext(BackgroundContext);

const OPEN_EVENTS = { find: 'sp-open-finder', mentor: 'sp-setup-shot' } as const;

export function BackgroundProvider({
  screenplayId,
  doc,
  update,
  flush,
  onOpenScript,
  children,
}: {
  screenplayId: number;
  doc: ScreenplayDoc;
  update: (fn: (d: ScreenplayDoc) => ScreenplayDoc, group?: string) => void;
  flush: () => Promise<void>;
  onOpenScript: () => void;
  children: ReactNode;
}) {
  const storeKey = `sp-bg-finds-${screenplayId}`;
  const [finds, setFinds] = useState<BgFind[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? '[]') as BgFind[];
    } catch {
      return [];
    }
  });
  const [findState, setFindState] = useState<Map<number, api.ActiveFind>>(new Map());
  const [mentorJobs, setMentorJobs] = useState<api.MentorJob[]>([]);
  const [doneMentor, setDoneMentor] = useState<Array<{ shotId: string; id: number }>>([]);
  const [collapsed, setCollapsed] = useState(false);
  const applying = useRef(new Set<number>());

  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(finds));
    } catch {
      /* private mode: in memory only */
    }
  }, [finds, storeKey]);

  const poll = useCallback(async () => {
    try {
      const [jobs, active] = await Promise.all([api.openMentorJobs(screenplayId), finds.length ? api.activeFinds(screenplayId) : Promise.resolve([])]);
      setMentorJobs(jobs.filter((j) => j.status !== 'done'));
      setFindState(new Map(active.map((f) => [f.id, f])));
      // Apply finished mentor turns to their shots.
      for (const j of jobs) {
        if (j.status !== 'done' || !j.result || applying.current.has(j.id)) continue;
        applying.current.add(j.id);
        update((d) => ({ ...d, shots: d.shots.map((s) => (s.id === j.shot_id ? { ...s, mentor: j.result! } : s)) }), `shot:${j.shot_id}:mentor`);
        await flush();
        await api.mentorJobApplied(screenplayId, j.id);
        setDoneMentor((d) => [...d.filter((x) => x.shotId !== j.shot_id), { shotId: j.shot_id, id: j.id }]);
      }
    } catch {
      /* try again next tick */
    }
  }, [screenplayId, finds.length, update, flush]);

  const busy = mentorJobs.length > 0 || finds.some((f) => !['done', 'failed'].includes(findState.get(f.id)?.status ?? 'queued'));
  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), busy ? 2000 : 8000);
    return () => clearInterval(t);
  }, [poll, busy]);

  const ctx = useMemo<Ctx>(
    () => ({
      watchFind: (id, shotId) => setFinds((f) => [...f.filter((x) => x.shotId !== shotId), { kind: 'find', id, shotId }]),
      startMentor: async (shotId, message) => {
        await flush();
        const job = await api.startMentorTurn(screenplayId, shotId, message);
        setMentorJobs((j) => [...j.filter((x) => x.id !== job.id), job]);
        setDoneMentor((d) => d.filter((x) => x.shotId !== shotId));
      },
      mentorFor: (shotId) => mentorJobs.find((j) => j.shot_id === shotId),
    }),
    [flush, screenplayId, mentorJobs],
  );

  const shotNo = (shotId: string) => doc.shots.findIndex((s) => s.id === shotId) + 1 || '?';
  const open = (kind: keyof typeof OPEN_EVENTS, shotId: string) => {
    onOpenScript();
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_EVENTS[kind], { detail: shotId })), 150);
  };
  const items = [
    ...mentorJobs.map((j) => ({
      key: `m${j.id}`,
      icon: <GraduationCap size={13} />,
      label: `Shot ${shotNo(j.shot_id)}: mentor`,
      status: j.progress || (j.status === 'queued' ? 'Queued' : 'Thinking…'),
      state: j.status === 'failed' ? 'failed' : 'running',
      onOpen: () => open('mentor', j.shot_id),
      onDismiss: undefined as undefined | (() => void),
    })),
    ...doneMentor.map((m) => ({
      key: `md${m.id}`,
      icon: <GraduationCap size={13} />,
      label: `Shot ${shotNo(m.shotId)}: the mentor replied`,
      status: '',
      state: 'done',
      onOpen: () => {
        setDoneMentor((d) => d.filter((x) => x.id !== m.id));
        open('mentor', m.shotId);
      },
      onDismiss: () => setDoneMentor((d) => d.filter((x) => x.id !== m.id)),
    })),
    ...finds.map((f) => {
      const st = findState.get(f.id);
      const done = st?.status === 'done';
      const failed = st?.status === 'failed';
      return {
        key: `f${f.id}`,
        icon: <Search size={13} />,
        label: `Shot ${shotNo(f.shotId)}: ${done ? `${st!.count} photo${st!.count === 1 ? '' : 's'} found` : failed ? 'search failed' : 'finding photos'}`,
        status: failed ? (st?.error ?? '') : done ? '' : (st?.progress ?? 'Starting…'),
        state: done ? 'done' : failed ? 'failed' : 'running',
        onOpen: () => {
          setFinds((x) => x.filter((y) => y.id !== f.id));
          open('find', f.shotId);
        },
        onDismiss: () => setFinds((x) => x.filter((y) => y.id !== f.id)),
      };
    }),
  ];

  return (
    <BackgroundContext.Provider value={ctx}>
      {children}
      {items.length > 0 && (
        <div className={`sp-bg-tray ${collapsed ? 'collapsed' : ''}`} role="status" aria-live="polite">
          <button className="sp-bg-head" onClick={() => setCollapsed(!collapsed)}>
            {items.some((i) => i.state === 'running') ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
            <span>
              {items.filter((i) => i.state === 'running').length ? `${items.filter((i) => i.state === 'running').length} running in the background` : 'Background tasks done'}
            </span>
            {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {!collapsed &&
            items.map((i) => (
              <div key={i.key} className={`sp-bg-item ${i.state}`}>
                <span className="sp-bg-icon">{i.state === 'running' ? <Loader2 size={13} className="spin" /> : i.state === 'failed' ? <AlertTriangle size={13} /> : i.icon}</span>
                <span className="sp-bg-text">
                  <strong>{i.label}</strong>
                  {i.status && <small title={i.status}>{i.status}</small>}
                </span>
                {i.state !== 'running' && (
                  <button className="btn btn-sm" onClick={i.onOpen}>
                    Open
                  </button>
                )}
                {i.onDismiss && i.state !== 'running' && (
                  <button className="icon-btn" title="Dismiss" onClick={i.onDismiss}>
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
        </div>
      )}
    </BackgroundContext.Provider>
  );
}
