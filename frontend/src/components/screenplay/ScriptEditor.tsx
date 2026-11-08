// The script page: one textarea per screenplay element, formatted like a
// printed script, with Final Draft keys (Enter, Tab / Shift-Tab, Cmd/Ctrl+0-8)
// and SmartType-style completion. Storyboard shots sit in a rail beside the
// element they're pinned to.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Clapperboard } from 'lucide-react';
import type { Detail, ElementType, ScreenplayDoc, ScriptElement, Shot } from '../../api/screenplays';
import {
  ELEMENTS,
  ENTER_NEXT,
  EXTENSIONS,
  LABEL,
  SCENE_PREFIXES,
  TAB_NEXT,
  TAB_PREV,
  TIMES_OF_DAY,
  TRANSITIONS,
  UPPER,
  cueName,
  newId,
  pageStarts,
  sceneNumbers,
} from './format';
import { ShotRail } from './ShotRail';

interface Props {
  screenplayId: number;
  doc: ScreenplayDoc;
  detail?: Detail;
  update: (fn: (d: ScreenplayDoc) => ScreenplayDoc, group?: string) => void;
  undo: () => void;
  redo: () => void;
  onCurrentType: (t: ElementType | null) => void;
  /** Imperative hooks for the toolbar. */
  apiRef: React.MutableRefObject<EditorApi | null>;
  onOpenPlan: (sceneId: string, shotId: string) => void;
}

export interface EditorApi {
  setType: (t: ElementType) => void;
  addShot: () => void;
  focusElement: (id: string) => void;
}

// ── one element ──────────────────────────────────────────────────────────────

const Row = memo(function Row({
  el,
  index,
  page,
  newPage,
  sceneNo,
  hasShot,
  onText,
  onKey,
  onFocus,
  onAddShot,
  register,
}: {
  el: ScriptElement;
  index: number;
  page: number;
  newPage: boolean;
  sceneNo?: number;
  hasShot: boolean;
  onText: (index: number, text: string, caret: number) => void;
  onKey: (e: KeyboardEvent<HTMLTextAreaElement>, index: number) => void;
  onFocus: (index: number) => void;
  onAddShot: (index: number) => void;
  register: (id: string, node: HTMLTextAreaElement | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = '0px';
    t.style.height = `${t.scrollHeight}px`;
  }, [el.text, el.type]);
  const canShot = el.type === 'scene' || el.type === 'action' || el.type === 'shot' || el.type === 'general' || el.type === 'centered';
  return (
    <>
      {newPage && (
        <div className="sp-pagebreak" aria-hidden>
          <span>{page}.</span>
        </div>
      )}
      <div className={`sp-row sp-r-${el.type}`} data-id={el.id}>
        {sceneNo != null && <span className="sp-sceneno">{sceneNo}</span>}
        <textarea
          ref={(n) => {
            ref.current = n;
            register(el.id, n);
          }}
          className={`sp-el sp-el-${el.type}`}
          value={el.text}
          rows={1}
          spellCheck
          aria-label={LABEL[el.type]}
          placeholder={index === 0 && !el.text ? 'INT. LOCATION - DAY' : undefined}
          onChange={(e) => onText(index, e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => onKey(e, index)}
          onFocus={() => onFocus(index)}
        />
        {canShot && !hasShot && (
          <button className="sp-addshot" title="Add a storyboard shot here" onClick={() => onAddShot(index)} tabIndex={-1}>
            <Clapperboard size={13} /> Shot
          </button>
        )}
      </div>
    </>
  );
});

// ── completion ───────────────────────────────────────────────────────────────

function suggestions(doc: ScriptElement[], index: number): string[] {
  const el = doc[index];
  const text = el.text.toUpperCase();
  if (!text.trim() && el.type !== 'transition') return [];
  let pool: string[] = [];
  if (el.type === 'scene') {
    const dash = text.lastIndexOf(' - ');
    if (dash >= 0) {
      const head = el.text.slice(0, dash + 3);
      pool = TIMES_OF_DAY.map((t) => `${head.toUpperCase()}${t}`);
    } else {
      const used = doc.filter((e, i) => i !== index && e.type === 'scene' && e.text.trim()).map((e) => e.text.toUpperCase().split(' - ')[0]);
      pool = [...SCENE_PREFIXES, ...new Set(used)];
    }
  } else if (el.type === 'character') {
    const names = new Set(doc.filter((e, i) => i !== index && e.type === 'character').map((e) => cueName(e.text).toUpperCase()).filter(Boolean));
    if (/\($|\(\w*$/.test(text) || /\s\($/.test(text)) {
      const base = text.replace(/\s*\(\w*$/, '');
      pool = EXTENSIONS.map((x) => `${base} ${x}`);
    } else pool = [...names];
  } else if (el.type === 'transition') {
    pool = TRANSITIONS;
  } else return [];
  return pool.filter((p) => p.startsWith(text) && p !== text).slice(0, 7);
}

// ── editor ───────────────────────────────────────────────────────────────────

export function ScriptEditor({ screenplayId, doc, detail, update, undo, redo, onCurrentType, apiRef, onOpenPlan }: Props) {
  const nodes = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingFocus = useRef<{ id: string; pos: number | 'end' } | null>(null);
  const [current, setCurrent] = useState<number>(0);
  const [suggest, setSuggest] = useState<{ index: number; items: string[]; active: number } | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const els = doc.elements;
  const elsRef = useRef(els);
  elsRef.current = els;

  const pages = useMemo(() => pageStarts(els), [els]);
  const scenes = useMemo(() => sceneNumbers(els), [els]);
  const anchored = useMemo(() => new Set(doc.shots.map((s) => s.anchorId)), [doc.shots]);

  const register = useCallback((id: string, n: HTMLTextAreaElement | null) => {
    if (n) nodes.current.set(id, n);
    else nodes.current.delete(id);
  }, []);

  useLayoutEffect(() => {
    const f = pendingFocus.current;
    if (!f) return;
    const n = nodes.current.get(f.id);
    if (n) {
      n.focus();
      const pos = f.pos === 'end' ? n.value.length : Math.min(f.pos, n.value.length);
      n.setSelectionRange(pos, pos);
      pendingFocus.current = null;
    }
  });

  const focusEl = (id: string, pos: number | 'end') => {
    pendingFocus.current = { id, pos };
    const n = nodes.current.get(id);
    if (n) {
      n.focus();
      const p = pos === 'end' ? n.value.length : Math.min(pos, n.value.length);
      n.setSelectionRange(p, p);
      pendingFocus.current = null;
    }
  };

  useEffect(() => onCurrentType(els[current]?.type ?? null), [current, els, onCurrentType]);

  // Line wrapping changes with the page width: re-fit every element.
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    let width = page.clientWidth;
    const ro = new ResizeObserver(() => {
      if (page.clientWidth === width) return;
      width = page.clientWidth;
      nodes.current.forEach((t) => {
        t.style.height = '0px';
        t.style.height = `${t.scrollHeight}px`;
      });
    });
    ro.observe(page);
    return () => ro.disconnect();
  }, []);

  const setType = useCallback(
    (index: number, type: ElementType) => {
      const el = elsRef.current[index];
      if (!el || el.type === type) return;
      let text = UPPER.has(type) ? el.text.toUpperCase() : el.text;
      let caret: number | 'end' = 'end';
      if (type === 'parenthetical' && !text.trim()) {
        text = '()';
        caret = 1;
      } else if (el.type === 'parenthetical' && /^\(.*\)$/.test(text)) text = text.slice(1, -1);
      update((d) => ({ ...d, elements: d.elements.map((e, i) => (i === index ? { ...e, type, text } : e)) }));
      setSuggest(null);
      pendingFocus.current = { id: el.id, pos: caret };
    },
    [update],
  );

  const addShotAt = useCallback(
    (index: number) => {
      const el = elsRef.current[index];
      if (!el) return;
      update((d) => {
        if (d.shots.some((s) => s.anchorId === el.id)) return d;
        // Keep shots in script order.
        const order = new Map(d.elements.map((e, i) => [e.id, i]));
        const shots = [...d.shots, { id: newId('sh'), anchorId: el.id } as Shot].sort(
          (a, b) => (order.get(a.anchorId) ?? 0) - (order.get(b.anchorId) ?? 0),
        );
        return { ...d, shots };
      });
    },
    [update],
  );

  apiRef.current = {
    setType: (t) => setType(current, t),
    addShot: () => addShotAt(current),
    focusElement: (id) => focusEl(id, 'end'),
  };

  const onText = useCallback(
    (index: number, raw: string, caret: number) => {
      const el = elsRef.current[index];
      const text = UPPER.has(el.type) ? raw.toUpperCase() : raw;
      update((d) => ({ ...d, elements: d.elements.map((e, i) => (i === index ? { ...e, text } : e)) }), `text:${el.id}`);
      if (text !== raw) pendingFocus.current = { id: el.id, pos: caret };
      const items = suggestions(elsRef.current.map((e, i) => (i === index ? { ...e, text } : e)), index);
      setSuggest(items.length ? { index, items, active: 0 } : null);
    },
    [update],
  );

  /** Remove element `index`, moving any shot pinned to it onto `toId`. */
  const removeAndReanchor = (d: ScreenplayDoc, index: number, toId: string | null, mergedText?: { id: string; text: string }) => {
    const gone = d.elements[index];
    let shots = d.shots;
    if (shots.some((s) => s.anchorId === gone.id)) {
      shots = toId && !shots.some((s) => s.anchorId === toId)
        ? shots.map((s) => (s.anchorId === gone.id ? { ...s, anchorId: toId } : s))
        : shots.filter((s) => s.anchorId !== gone.id);
    }
    const elements = d.elements
      .filter((_, i) => i !== index)
      .map((e) => (mergedText && e.id === mergedText.id ? { ...e, text: mergedText.text } : e));
    return { ...d, shots, elements: elements.length ? elements : [{ id: newId(), type: 'action' as ElementType, text: '' }] };
  };

  const onKey = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>, index: number) => {
      const t = e.currentTarget;
      const el = elsRef.current[index];
      const mod = e.metaKey || e.ctrlKey;
      const s = suggest && suggest.index === index ? suggest : null;

      if (mod && !e.altKey && /^[0-8]$/.test(e.key)) {
        const def = ELEMENTS.find((x) => x.key === e.key);
        if (def) {
          e.preventDefault();
          setType(index, def.type);
        }
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (s && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const n = s.items.length;
        setSuggest({ ...s, active: (s.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
        return;
      }
      if (s && (e.key === 'Enter' || (e.key === 'ArrowRight' && t.selectionStart === t.value.length))) {
        e.preventDefault();
        const text = s.items[s.active];
        update((d) => ({ ...d, elements: d.elements.map((x, i) => (i === index ? { ...x, text } : x)) }), `text:${el.id}`);
        setSuggest(null);
        pendingFocus.current = { id: el.id, pos: 'end' };
        return;
      }
      if (e.key === 'Escape' && s) {
        setSuggest(null);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        setType(index, e.shiftKey ? TAB_PREV[el.type] : TAB_NEXT[el.type]);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !mod) {
        e.preventDefault();
        setSuggest(null);
        const caret = t.selectionStart;
        let before = el.text.slice(0, caret);
        let after = el.text.slice(t.selectionEnd);
        // Enter inside "(whispering|)" finishes the parenthetical.
        if (el.type === 'parenthetical' && after.trim() === ')') {
          before += ')';
          after = '';
        }
        // An empty cue, parenthetical or dialogue line drops back to Action.
        if (!el.text.trim() && el.type !== 'action' && el.type !== 'scene') {
          setType(index, 'action');
          return;
        }
        const atEnd = !after.trim();
        const type: ElementType =
          el.type === 'parenthetical' && /\)\s*$/.test(before) ? 'dialogue' : atEnd ? ENTER_NEXT[el.type] : el.type;
        const fresh: ScriptElement = { id: newId(), type, text: atEnd ? (type === 'parenthetical' ? '()' : '') : after };
        update((d) => {
          const elements = [...d.elements];
          elements[index] = { ...el, text: atEnd ? before.trimEnd() : before };
          elements.splice(index + 1, 0, fresh);
          return { ...d, elements };
        });
        pendingFocus.current = { id: fresh.id, pos: type === 'parenthetical' && atEnd ? 1 : 0 };
        return;
      }
      if (e.key === 'Backspace' && t.selectionStart === 0 && t.selectionEnd === 0 && index > 0) {
        e.preventDefault();
        const prev = elsRef.current[index - 1];
        const caret = prev.text.length;
        update((d) => removeAndReanchor(d, index, prev.id, el.text ? { id: prev.id, text: prev.text + el.text } : undefined));
        pendingFocus.current = { id: prev.id, pos: caret };
        return;
      }
      if (e.key === 'Delete' && t.selectionStart === t.value.length && t.selectionEnd === t.value.length && index < elsRef.current.length - 1) {
        e.preventDefault();
        const next = elsRef.current[index + 1];
        update((d) => removeAndReanchor(d, index + 1, el.id, { id: el.id, text: el.text + next.text }));
        pendingFocus.current = { id: el.id, pos: el.text.length };
        return;
      }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !mod) {
        // Let the textarea move within its own lines; hop elements when the caret can't move.
        const before = t.selectionStart;
        const up = e.key === 'ArrowUp';
        window.setTimeout(() => {
          if (t.selectionStart !== before) return;
          const target = elsRef.current[index + (up ? -1 : 1)];
          if (target) focusEl(target.id, up ? 'end' : 0);
        }, 0);
      }
    },
    [redo, setType, suggest, undo, update],
  );

  const onFocus = useCallback((i: number) => {
    setCurrent(i);
    setSuggest(null);
  }, []);

  // Position of the completion list under the focused element.
  const suggestNode = suggest ? nodes.current.get(els[suggest.index]?.id ?? '') : undefined;
  const page = pageRef.current;
  const suggestPos =
    suggestNode && page
      ? {
          top: suggestNode.getBoundingClientRect().bottom - page.getBoundingClientRect().top + 2,
          left: suggestNode.getBoundingClientRect().left - page.getBoundingClientRect().left,
        }
      : null;

  return (
    <div className="sp-editor">
      <div className="sp-page" ref={pageRef}>
        {els.map((el, i) => (
          <Row
            key={el.id}
            el={el}
            index={i}
            page={pages[i]}
            newPage={i > 0 && pages[i] !== pages[i - 1]}
            sceneNo={scenes.get(el.id)}
            hasShot={anchored.has(el.id)}
            onText={onText}
            onKey={onKey}
            onFocus={onFocus}
            onAddShot={addShotAt}
            register={register}
          />
        ))}
        {suggest && suggestPos && (
          <ul className="sp-suggest" style={suggestPos} role="listbox">
            {suggest.items.map((s, i) => (
              <li
                key={s}
                role="option"
                aria-selected={i === suggest.active}
                className={i === suggest.active ? 'on' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const el = els[suggest.index];
                  update((d) => ({ ...d, elements: d.elements.map((x) => (x.id === el.id ? { ...x, text: s } : x)) }));
                  setSuggest(null);
                  pendingFocus.current = { id: el.id, pos: 'end' };
                }}
              >
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>
      <ShotRail
        screenplayId={screenplayId}
        doc={doc}
        detail={detail}
        update={update}
        nodes={nodes}
        pageRef={pageRef}
        onOpenPlan={onOpenPlan}
        onFocusAnchor={(id) => focusEl(id, 'end')}
      />
    </div>
  );
}
