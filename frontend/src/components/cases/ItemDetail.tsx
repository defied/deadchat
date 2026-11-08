// Drill-down for one piece of evidence: the full viewer beside its details,
// notes and AI notes, with ← / → to move through the case.

import { useEffect } from 'react';
import { Bot, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { CATEGORIES, type CaseItem } from '../../api/cases';
import { DownloadButton, Viewer, kindLabel } from './Viewer';

function facts(item: CaseItem): Array<[string, string]> {
  const d = item.dicom;
  const rows: Array<[string, string | number | undefined | null]> = [
    ['Type', kindLabel(item)],
    ['Category', CATEGORIES.find((c) => c.value === item.category)?.label],
    ['Date', item.takenAt],
    ['Modality', d?.modality],
    ['Study', d?.studyDescription],
    ['Series / view', d?.seriesDescription],
    ['Protocol', d?.protocol],
    ['Body part', d?.bodyPart],
    ['Projection', d?.viewPosition],
    ['Laterality', d?.laterality],
    ['Frame rate', item.frames > 1 && !item.stack && item.fps ? `${item.fps} fps` : null],
    ['Heart rate', d?.heartRate ? `${d.heartRate} bpm` : null],
    ['Matrix', d?.columns && d?.rows ? `${d.columns} × ${d.rows}` : item.width && item.height ? `${item.width} × ${item.height}` : null],
    ['Pixel spacing', d?.pixelSpacing ? `${d.pixelSpacing.replace('\\', ' × ')} mm` : null],
    ['Slice thickness', d?.sliceThickness ? `${d.sliceThickness} mm` : null],
    ['Patient age / sex', [d?.patientAge?.replace(/^0+/, ''), d?.patientSex].filter(Boolean).join(' · ') || null],
    ['Equipment', [d?.manufacturer, d?.model].filter(Boolean).join(' ') || null],
    ['File', item.originalName],
  ];
  return rows.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '').map(([k, v]) => [k, String(v)]);
}

export function ItemDetail({
  caseId,
  items,
  itemId,
  onClose,
  onGo,
}: {
  caseId: number;
  items: CaseItem[];
  itemId: number;
  onClose: () => void;
  onGo: (id: number) => void;
}) {
  const i = items.findIndex((x) => x.id === itemId);
  const item = items[i];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select, .cs-player')) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && items[i + 1]) onGo(items[i + 1].id);
      if (e.key === 'ArrowLeft' && items[i - 1]) onGo(items[i - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, items, onClose, onGo]);
  if (!item) return null;

  return (
    <div className="cs-detail-backdrop" onClick={onClose}>
      <div className="cs-detail" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={item.title}>
        <div className="cs-detail-head">
          <button className="icon-btn" disabled={i <= 0} onClick={() => onGo(items[i - 1].id)} title="Previous (←)"><ChevronLeft size={18} /></button>
          <strong>{item.title}</strong>
          <span className="field-hint">{i + 1} of {items.length}</span>
          <button className="icon-btn" disabled={i >= items.length - 1} onClick={() => onGo(items[i + 1].id)} title="Next (→)"><ChevronRight size={18} /></button>
          <span className="sp-grow" />
          <button className="icon-btn" onClick={onClose} title="Close (Esc)"><X size={18} /></button>
        </div>
        <div className="cs-detail-body">
          <div className="cs-detail-view">
            <Viewer key={item.id} caseId={caseId} item={item} tall />
          </div>
          <aside className="cs-detail-side">
            {item.notes && (
              <section>
                <h4>Notes</h4>
                <p>{item.notes}</p>
              </section>
            )}
            {item.aiNotes && (
              <section className="cs-ai">
                <h4><Bot size={12} /> AI notes <span className="field-hint">draft</span></h4>
                <p>{item.aiNotes}</p>
              </section>
            )}
            <section>
              <h4>Details</h4>
              <dl className="cs-facts">
                {facts(item).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
            {item.originals > 0 && <DownloadButton caseId={caseId} item={item} />}
          </aside>
        </div>
      </div>
    </div>
  );
}
