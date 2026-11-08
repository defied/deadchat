// One screenplay: Script (with the shot rail), Characters, Set plan and
// References tabs, sharing one autosaved document.

import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Clapperboard,
  Download,
  FileUp,
  Image as ImageIcon,
  Keyboard,
  LayoutGrid,
  Loader2,
  Pause,
  Play,
  Redo2,
  Settings,
  Trash2,
  Undo2,
  Users,
  Zap,
} from 'lucide-react';
import * as api from '../api/screenplays';
import { getCatalog } from '../api/generate';
import type { ElementType, ScreenplayDoc } from '../api/screenplays';
import { Alert, Field, Loading, Modal, RouteTabs, errorMessage } from '../components/ui';
import { ScriptEditor, type EditorApi } from '../components/screenplay/ScriptEditor';
import { CharactersTab } from '../components/screenplay/CharactersTab';
import { SetPlan } from '../components/screenplay/SetPlan';
import { ReferencesTab } from '../components/screenplay/ReferencesTab';
import { useScreenplay } from '../components/screenplay/useScreenplay';
import { ELEMENTS, download, pageStarts, parseFdx, parseFountain, printHtml, toFdx, toFountain } from '../components/screenplay/format';

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

export function ScreenplayPage() {
  const id = Number(useParams().id);
  const tab = useParams().tab ?? 'script';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const s = useScreenplay(id);
  const editor = useRef<EditorApi | null>(null);
  const [curType, setCurType] = useState<ElementType | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  const doc = s.doc;
  const onCurrentType = useCallback((t: ElementType | null) => setCurType(t), []);
  const openPlan = useCallback(
    (sceneId: string, shotId: string) => navigate(`/screenplays/${id}/plan?scene=${sceneId}&shot=${shotId}`),
    [id, navigate],
  );

  const rendering = useMemo(() => {
    const d = s.detail;
    if (!d) return 0;
    return Object.values(d.media.latest).filter((m) => m.status === 'pending').length;
  }, [s.detail]);

  const pages = useMemo(() => {
    if (!doc) return 1;
    const p = pageStarts(doc.elements);
    return p[p.length - 1] ?? 1;
  }, [doc]);
  const runtime = useMemo(() => (doc ? doc.shots.reduce((a, x) => a + (x.seconds ?? 0), 0) : 0), [doc]);

  if (s.query.isLoading || !doc) return s.query.error ? <div className="page"><Alert>{errorMessage(s.query.error)}</Alert></div> : <Loading />;

  const exportAs = (kind: 'fountain' | 'fdx' | 'pdf') => {
    setMenu(false);
    const name = (s.title || 'screenplay').replace(/[^\w\- ]+/g, '').trim() || 'screenplay';
    if (kind === 'fountain') download(`${name}.fountain`, toFountain(doc, s.title), 'text/plain');
    else if (kind === 'fdx') download(`${name}.fdx`, toFdx(doc, s.title), 'application/xml');
    else {
      const w = window.open('', '_blank');
      if (!w) {
        setError('Allow pop-ups for DeadChat to print or save a PDF.');
        return;
      }
      w.document.write(printHtml(doc, s.title));
      w.document.close();
    }
  };

  const importInto = async (f: File) => {
    setMenu(false);
    try {
      const text = await f.text();
      const parsed = /\.fdx$/i.test(f.name) ? parseFdx(text) : parseFountain(text);
      if (!window.confirm(`Replace this script with ${f.name}? Shots pinned to lines that no longer exist are removed. You can undo this.`)) return;
      s.update((d) => {
        const ids = new Set(parsed.elements.map((e) => e.id));
        return { ...d, elements: parsed.elements, shots: d.shots.filter((x) => ids.has(x.anchorId)), titlePage: { ...d.titlePage, ...parsed.titlePage } };
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const saveLabel =
    s.saveState === 'saving' ? 'Saving…' : s.saveState === 'unsaved' ? 'Unsaved' : s.saveState === 'error' ? 'Not saved' : s.saveState === 'conflict' ? 'Conflict' : 'Saved';

  return (
    <div className="page sp-page-shell">
      <div className="sp-header">
        <Link to="/screenplays" className="icon-btn" title="All screenplays">
          <ChevronLeft size={18} />
        </Link>
        <input className="sp-title" value={s.title} onChange={(e) => s.setTitle(e.target.value)} aria-label="Title" />
        <span className={`sp-save ${s.saveState}`}>
          {s.saveState === 'saving' ? <Loader2 size={12} className="spin" /> : s.saveState === 'saved' ? <Check size={12} /> : s.saveState === 'unsaved' ? null : <AlertTriangle size={12} />} {saveLabel}
        </span>
        <span className="sp-grow" />
        <span className="field-hint sp-stats">
          {pages} page{pages === 1 ? '' : 's'} · {doc.shots.length} shot{doc.shots.length === 1 ? '' : 's'}
          {runtime > 0 && ` · ${Math.floor(runtime / 60)}:${String(Math.round(runtime % 60)).padStart(2, '0')} boarded`}
        </span>
        <div className="sp-menu-wrap">
          <button className="btn btn-sm" onClick={() => setMenu(!menu)}>
            <Download size={14} /> File
          </button>
          {menu && (
            <div className="sp-menu" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => exportAs('pdf')}>Print / save as PDF</button>
              <button onClick={() => exportAs('fdx')}>Export Final Draft (.fdx)</button>
              <button onClick={() => exportAs('fountain')}>Export Fountain (.fountain)</button>
              <hr />
              <button onClick={() => importRef.current?.click()}>
                <FileUp size={13} /> Import over this script…
              </button>
              <hr />
              <button
                className="danger"
                onClick={async () => {
                  if (!window.confirm(`Delete “${s.title}” and everything generated for it?`)) return;
                  await api.deleteScreenplay(id);
                  navigate('/screenplays');
                }}
              >
                <Trash2 size={13} /> Delete screenplay
              </button>
            </div>
          )}
        </div>
        <button className="btn btn-sm" onClick={() => setSettingsOpen(true)} title="Look, image model, title page">
          <Settings size={14} />
        </button>
        <input ref={importRef} type="file" accept=".fountain,.spmd,.txt,.fdx" hidden onChange={(e) => e.target.files?.[0] && importInto(e.target.files[0])} />
      </div>

      {s.saveState === 'conflict' && (
        <Alert>
          This screenplay was changed in another tab or window.{' '}
          <button className="btn btn-sm" onClick={() => void s.resolveConflict('theirs')}>Load the saved version</button>{' '}
          <button className="btn btn-sm" onClick={() => void s.resolveConflict('mine')}>Keep this version</button>
        </Alert>
      )}
      {s.saveState === 'error' && s.saveError && <Alert>Couldn’t save: {s.saveError}. Retrying as you type.</Alert>}
      {error && <Alert>{error}</Alert>}

      <RouteTabs
        tabs={[
          { to: `/screenplays/${id}/script`, label: 'Script', icon: <Clapperboard size={14} /> },
          { to: `/screenplays/${id}/characters`, label: 'Characters', icon: <Users size={14} /> },
          { to: `/screenplays/${id}/plan`, label: 'Set plan', icon: <LayoutGrid size={14} /> },
          { to: `/screenplays/${id}/references`, label: 'References', icon: <ImageIcon size={14} /> },
        ]}
      />

      {tab === 'script' && (
        <>
          <div className="sp-toolbar">
            <select
              value={curType ?? ''}
              onChange={(e) => editor.current?.setType(e.target.value as ElementType)}
              aria-label="Element"
              onMouseDown={(e) => e.preventDefault() /* keep focus in the script */}
            >
              {ELEMENTS.map((x) => (
                <option key={x.type} value={x.type}>
                  {x.label} ({mod}+{x.key})
                </option>
              ))}
            </select>
            <button className="btn btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.current?.addShot()} title="Pin a storyboard shot to the current line">
              <Clapperboard size={14} /> Add shot
            </button>
            <button className="icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={s.undo} disabled={!s.canUndo} title={`Undo (${mod}+Z)`}>
              <Undo2 size={15} />
            </button>
            <button className="icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={s.redo} disabled={!s.canRedo} title={`Redo (${mod}+Shift+Z)`}>
              <Redo2 size={15} />
            </button>
            <button className="icon-btn" onClick={() => setHelpOpen(true)} title="Keyboard">
              <Keyboard size={15} />
            </button>
            <span className="sp-grow" />
            {rendering > 0 && (
              <span className="sp-mini-status">
                <Loader2 size={12} className="spin" /> {rendering} rendering
              </span>
            )}
            <button
              className="btn btn-sm"
              onClick={() => s.update((d) => ({ ...d, settings: { ...d.settings, paused: d.settings.paused ? undefined : true } }))}
              title={doc.settings.paused ? 'Resume rendering frames and music' : 'Pause rendering while you write'}
            >
              {doc.settings.paused ? <Play size={14} /> : <Pause size={14} />} {doc.settings.paused ? 'Resume renders' : 'Pause renders'}
            </button>
            <button
              className="btn btn-sm"
              disabled={!!doc.settings.paused}
              title="Render out-of-date shots now instead of waiting for you to pause"
              onClick={async () => {
                try {
                  await s.flush();
                  s.setDetail(await api.renderNow(id));
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              <Zap size={14} /> Render now
            </button>
          </div>
          <ScriptEditor
            screenplayId={id}
            doc={doc}
            detail={s.detail}
            update={s.update}
            undo={s.undo}
            redo={s.redo}
            onCurrentType={onCurrentType}
            apiRef={editor}
            onOpenPlan={openPlan}
          />
        </>
      )}
      {tab === 'characters' && <CharactersTab screenplayId={id} doc={doc} detail={s.detail} update={s.update} flush={s.flush} setDetail={s.setDetail} />}
      {tab === 'plan' && (
        <SetPlan
          doc={doc}
          detail={s.detail}
          update={s.update}
          sceneId={params.get('scene')}
          focusShot={params.get('shot')}
          onScene={(scene) => setParams({ scene }, { replace: true })}
        />
      )}
      {tab === 'references' && <ReferencesTab screenplayId={id} doc={doc} detail={s.detail} flush={s.flush} setDetail={s.setDetail} />}

      {settingsOpen && <SettingsModal doc={doc} title={s.title} update={s.update} onClose={() => setSettingsOpen(false)} />}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function SettingsModal({ doc, title, update, onClose }: { doc: ScreenplayDoc; title: string; update: (fn: (d: ScreenplayDoc) => ScreenplayDoc, group?: string) => void; onClose: () => void }) {
  const cat = useQuery({ queryKey: ['media-catalog'], queryFn: getCatalog, staleTime: 60_000 });
  const images = (cat.data?.models ?? []).filter((m) => m.kind === 'image');
  const set = (p: Partial<ScreenplayDoc['settings']>, field: string) => update((d) => ({ ...d, settings: { ...d.settings, ...p } }), `settings:${field}`);
  const tp = doc.titlePage ?? {};
  const setTp = (p: Partial<NonNullable<ScreenplayDoc['titlePage']>>, field: string) => update((d) => ({ ...d, titlePage: { ...d.titlePage, ...p } }), `tp:${field}`);
  return (
    <Modal title="Screenplay settings" onClose={onClose} width={640} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <h3 className="sp-h3">Storyboard</h3>
      <div className="sp-grid2">
        <Field label="Image model" hint="Local models are free and private; hosted ones use comfy.org credits.">
          <select value={doc.settings.imageModel ?? ''} onChange={(e) => set({ imageModel: e.target.value || undefined }, 'model')}>
            <option value="">Default ({cat.data?.defaults.image ?? '…'})</option>
            {images.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.label} · {m.backend === 'local' ? 'local' : m.backend === 'cloudflare' ? 'Cloudflare' : 'hosted'}{m.available ? '' : ' (unavailable)'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Frame">
          <select value={doc.settings.ratio ?? '21:9'} onChange={(e) => set({ ratio: e.target.value as ScreenplayDoc['settings']['ratio'] }, 'ratio')}>
            <option value="21:9">2.39 : 1 scope (21:9)</option>
            <option value="16:9">16:9 HD / TV</option>
            <option value="4:3">4:3 Academy</option>
            <option value="1:1">1:1</option>
            <option value="9:16">9:16 vertical</option>
          </select>
        </Field>
      </div>
      <Field label="Visual style" hint="Added to every frame. E.g. “35mm film, muted teal and orange grade, anamorphic” or “graphite storyboard sketch”.">
        <input value={doc.settings.style ?? ''} onChange={(e) => set({ style: e.target.value }, 'style')} placeholder="Photorealistic, natural film lighting, shallow depth of field, film grain" />
      </Field>
      <p className="field-hint">Music cues use ACE-Step on your GPU box.</p>
      <h3 className="sp-h3">Title page</h3>
      <div className="sp-grid2">
        <Field label="Title"><input value={tp.title ?? title} onChange={(e) => setTp({ title: e.target.value }, 'title')} /></Field>
        <Field label="Credit"><input value={tp.credit ?? ''} onChange={(e) => setTp({ credit: e.target.value }, 'credit')} placeholder="Written by" /></Field>
        <Field label="Author(s)"><input value={tp.author ?? ''} onChange={(e) => setTp({ author: e.target.value }, 'author')} /></Field>
        <Field label="Source"><input value={tp.source ?? ''} onChange={(e) => setTp({ source: e.target.value }, 'source')} placeholder="Based on…" /></Field>
        <Field label="Draft date"><input value={tp.draftDate ?? ''} onChange={(e) => setTp({ draftDate: e.target.value }, 'draft')} /></Field>
        <Field label="Contact"><textarea rows={2} value={tp.contact ?? ''} onChange={(e) => setTp({ contact: e.target.value }, 'contact')} /></Field>
      </div>
    </Modal>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ['Enter', 'New element (Scene → Action, Character → Dialogue, Dialogue → Action, Transition → Scene)'],
    ['Enter on an empty line', 'Back to Action'],
    ['Tab', 'Action → Character → Transition → Scene; Dialogue ↔ Parenthetical'],
    ['Shift+Tab', 'The other way'],
    [`${mod}+1 … ${mod}+8, ${mod}+0`, ELEMENTS.map((e) => `${e.key} ${e.label}`).join(', ')],
    ['Shift+Enter', 'Line break inside an element'],
    ['↑ / ↓ / → / Enter in a suggestion list', 'Choose and accept (scene headings, character names, transitions)'],
    [`${mod}+Z / ${mod}+Shift+Z`, 'Undo / redo'],
    ['Backspace at the start', 'Join with the line above'],
  ];
  return (
    <Modal title="Keyboard" onClose={onClose} width={640}>
      <table className="data-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td><kbd>{k}</kbd></td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
