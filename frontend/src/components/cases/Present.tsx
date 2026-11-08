// Full-screen presentation: title, summary, background, each piece of
// evidence in order (loops play), lab trends and teaching points. ← / → or
// click the edges to move, Esc to leave, N toggles notes, G opens a slide grid.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bot, ChevronLeft, ChevronRight, Grid3x3, HelpCircle, StickyNote, X } from 'lucide-react';
import type { CaseDetail, CaseItem } from '../../api/cases';
import { Markdown } from '../chat/Markdown';
import { LabTrends } from './LabTrends';
import { BACKGROUND, facts, vitalsLine } from './Overview';
import { Thumb, Viewer } from './Viewer';

interface Slide {
  key: string;
  label: string;
  item?: CaseItem;
  render: (notes: boolean) => ReactNode;
}

export function Present({ detail, onClose, startItem }: { detail: CaseDetail; onClose: () => void; startItem?: number }) {
  const { case: c, items } = detail;
  const p = c.profile;
  const root = useRef<HTMLDivElement | null>(null);
  const [notes, setNotes] = useState(true);
  const [grid, setGrid] = useState(false);

  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    out.push({
      key: 'title',
      label: 'Title',
      render: () => (
        <div className="cs-slide-title">
          <h1>{c.title}</h1>
          {facts(p).length > 0 && <p className="cs-slide-facts">{facts(p).join(' · ')}</p>}
          {p.chiefComplaint && <p className="cs-slide-cc">{p.chiefComplaint}</p>}
          {p.question && (
            <p className="cs-slide-q">
              <HelpCircle size={20} /> {p.question}
            </p>
          )}
        </div>
      ),
    });
    if (c.summary?.trim()) {
      out.push({ key: 'summary', label: 'Summary', render: () => <div className="cs-slide-text"><h2>Summary</h2><Markdown text={c.summary!} /></div> });
    }
    const bg = BACKGROUND.filter(([k]) => String(p[k] ?? '').trim());
    if (bg.length || vitalsLine(p)) {
      out.push({
        key: 'background',
        label: 'Background',
        render: () => (
          <div className="cs-slide-text">
            <h2>Background</h2>
            <div className="cs-slide-cols">
              {bg.map(([k, label]) => (
                <section key={k}>
                  <h3>{label}</h3>
                  <p>{String(p[k])}</p>
                </section>
              ))}
              {vitalsLine(p) && (
                <section>
                  <h3>Vitals</h3>
                  <p>{vitalsLine(p)}</p>
                </section>
              )}
            </div>
          </div>
        ),
      });
    }
    for (const it of items.filter((i) => i.include)) {
      out.push({
        key: `item-${it.id}`,
        label: it.title,
        item: it,
        render: (showNotes) => (
          <div className={`cs-slide-item ${showNotes && (it.notes || it.aiNotes) ? 'with-notes' : ''}`}>
            <div className="cs-slide-media">
              <Viewer key={it.id} caseId={c.id} item={it} tall autoplay />
            </div>
            <div className="cs-slide-caption">
              <h2>{it.title}</h2>
              {it.takenAt && <span className="cs-slide-date">{it.takenAt}</span>}
              {showNotes && it.notes && <p>{it.notes}</p>}
              {showNotes && it.aiNotes && !it.notes && (
                <p className="cs-slide-ai"><Bot size={14} /> {it.aiNotes}</p>
              )}
            </div>
          </div>
        ),
      });
    }
    if (p.labs?.length) {
      out.push({ key: 'labs', label: 'Lab trends', render: () => <div className="cs-slide-text"><h2>Lab trends</h2><LabTrends labs={p.labs!} large /></div> });
    }
    if (p.teachingPoints?.trim()) {
      out.push({ key: 'teaching', label: 'Teaching points', render: () => <div className="cs-slide-text"><h2>Take-home points</h2><p className="cs-pre big">{p.teachingPoints}</p></div> });
    }
    return out;
  }, [c, p, items]);

  const [index, setIndex] = useState(() => Math.max(0, slides.findIndex((s) => s.item?.id === startItem)));
  const go = (i: number) => setIndex(Math.max(0, Math.min(slides.length - 1, i)));

  useEffect(() => {
    void root.current?.requestFullscreen?.().catch(() => undefined);
    const onFs = () => {
      if (!document.fullscreenElement) onClose();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('.cs-player') && ['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        setIndex((i) => Math.min(slides.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Escape') onClose();
      else if (e.key.toLowerCase() === 'n') setNotes((n) => !n);
      else if (e.key.toLowerCase() === 'g') setGrid((g) => !g);
      else if (e.key === 'Home') setIndex(0);
      else if (e.key === 'End') setIndex(slides.length - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slides.length, onClose]);

  const slide = slides[index];
  return (
    <div className="cs-present" ref={root}>
      {grid ? (
        <div className="cs-grid">
          {slides.map((s, i) => (
            <button key={s.key} className={`cs-grid-tile ${i === index ? 'on' : ''}`} onClick={() => { setIndex(i); setGrid(false); }}>
              {s.item ? <Thumb caseId={c.id} item={s.item} /> : <span className="cs-grid-text">{s.label}</span>}
              <span>{i + 1}. {s.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="cs-slide">{slide.render(notes)}</div>
      )}
      <div className="cs-present-bar">
        <button className="icon-btn" onClick={() => go(index - 1)} disabled={index === 0} title="Previous (←)"><ChevronLeft size={18} /></button>
        <span>{index + 1} / {slides.length}</span>
        <button className="icon-btn" onClick={() => go(index + 1)} disabled={index === slides.length - 1} title="Next (→)"><ChevronRight size={18} /></button>
        <button className={`icon-btn ${notes ? 'on' : ''}`} onClick={() => setNotes(!notes)} title="Notes (N)"><StickyNote size={16} /></button>
        <button className={`icon-btn ${grid ? 'on' : ''}`} onClick={() => setGrid(!grid)} title="All slides (G)"><Grid3x3 size={16} /></button>
        <button className="icon-btn" onClick={onClose} title="Exit (Esc)"><X size={18} /></button>
      </div>
    </div>
  );
}
