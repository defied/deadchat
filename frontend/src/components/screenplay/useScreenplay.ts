// The open screenplay: local document state (the source of truth while
// editing), undo/redo, debounced autosave with version checks, and the
// server's view of renders, polled while anything is in flight.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import * as api from '../../api/screenplays';
import type { Detail, ScreenplayDoc } from '../../api/screenplays';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'error';

const SAVE_DELAY = 900;
const HISTORY = 300;

export function useScreenplay(id: number) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['screenplay', id],
    queryFn: () => api.getScreenplay(id),
    refetchInterval: (query) => {
      const d = query.state.data as Detail | undefined;
      if (!d) return false;
      const busy =
        Object.values(d.media.latest).some((m) => m.status === 'pending') ||
        d.media.other.some((m) => m.status === 'pending' || (m.role === 'reference' && !m.caption && !m.error));
      return busy ? 3000 : 8000;
    },
  });

  const [doc, setDoc] = useState<ScreenplayDoc | null>(null);
  const [title, setTitleState] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const docRef = useRef<ScreenplayDoc | null>(null);
  const titleRef = useRef('');
  const version = useRef(0);
  const dirty = useRef(false);
  const saving = useRef(false);
  const timer = useRef<number | null>(null);
  const past = useRef<ScreenplayDoc[]>([]);
  const future = useRef<ScreenplayDoc[]>([]);
  const lastGroup = useRef<{ key: string; at: number } | null>(null);
  const [, bump] = useState(0);

  // Adopt the server copy on first load, and later only if another tab saved and we have nothing unsaved.
  useEffect(() => {
    const s = q.data?.screenplay;
    if (!s) return;
    if (!docRef.current || (s.version > version.current && !dirty.current && !saving.current)) {
      docRef.current = s.doc;
      titleRef.current = s.title;
      version.current = s.version;
      setDoc(s.doc);
      setTitleState(s.title);
    }
  }, [q.data]);

  const save = useCallback(async () => {
    if (saving.current || !dirty.current || !docRef.current) return;
    saving.current = true;
    dirty.current = false;
    setSaveState('saving');
    try {
      const r = await api.saveScreenplay(id, version.current, { title: titleRef.current, doc: docRef.current });
      version.current = r.version;
      setSaveError(null);
      setSaveState(dirty.current ? 'unsaved' : 'saved');
      // Renders are re-planned on the server after a save.
      window.setTimeout(() => qc.invalidateQueries({ queryKey: ['screenplay', id] }), 1200);
    } catch (e) {
      dirty.current = true;
      if (axios.isAxiosError(e) && e.response?.status === 409) {
        setSaveState('conflict');
      } else {
        setSaveState('error');
        setSaveError(axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error ?? e.message : String(e));
      }
    } finally {
      saving.current = false;
    }
    if (dirty.current && saveStateRef.current !== 'conflict') schedule();
  }, [id, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveStateRef = useRef<SaveState>('saved');
  saveStateRef.current = saveState;

  const schedule = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), SAVE_DELAY);
  }, [save]);

  /**
   * Change the document. Edits with the same `group` key within a second share
   * one undo step (typing in one element).
   */
  const update = useCallback(
    (fn: (d: ScreenplayDoc) => ScreenplayDoc, group?: string, opts?: { history?: boolean }) => {
      const cur = docRef.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      const now = Date.now();
      // Bookkeeping changes (placeholder profiles) aren't undo steps of their own.
      if (opts?.history !== false) {
        if (!group || !lastGroup.current || lastGroup.current.key !== group || now - lastGroup.current.at > 1000) {
          past.current.push(cur);
          if (past.current.length > HISTORY) past.current.shift();
        }
        lastGroup.current = group ? { key: group, at: now } : null;
        future.current = [];
      }
      docRef.current = next;
      setDoc(next);
      dirty.current = true;
      if (saveStateRef.current !== 'conflict') {
        setSaveState('unsaved');
        schedule();
      }
    },
    [schedule],
  );

  const restore = (d: ScreenplayDoc) => {
    docRef.current = d;
    setDoc(d);
    dirty.current = true;
    lastGroup.current = null;
    setSaveState('unsaved');
    schedule();
    bump((n) => n + 1);
  };
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev || !docRef.current) return;
    future.current.push(docRef.current);
    restore(prev);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !docRef.current) return;
    past.current.push(docRef.current);
    restore(next);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTitle = useCallback(
    (t: string) => {
      titleRef.current = t;
      setTitleState(t);
      dirty.current = true;
      setSaveState('unsaved');
      schedule();
    },
    [schedule],
  );

  /** Resolve a conflict: keep this tab's version (overwrite) or load the saved one. */
  const resolveConflict = useCallback(
    async (keep: 'mine' | 'theirs') => {
      const fresh = await api.getScreenplay(id);
      if (keep === 'theirs') {
        docRef.current = fresh.screenplay.doc;
        titleRef.current = fresh.screenplay.title;
        version.current = fresh.screenplay.version;
        dirty.current = false;
        past.current = [];
        future.current = [];
        setDoc(fresh.screenplay.doc);
        setTitleState(fresh.screenplay.title);
        setSaveState('saved');
      } else {
        version.current = fresh.screenplay.version;
        setSaveState('unsaved');
        dirty.current = true;
        void save();
      }
      qc.setQueryData(['screenplay', id], fresh);
    },
    [id, qc, save],
  );

  // Save before leaving the page.
  useEffect(() => {
    const flush = () => {
      if (dirty.current) void save();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      if (timer.current) window.clearTimeout(timer.current);
      flush();
    };
  }, [save]);

  /** Save now and wait until the server has everything (before server-side actions). */
  const flush = useCallback(async () => {
    for (let i = 0; i < 50; i++) {
      if (!dirty.current && !saving.current) return;
      if (saveStateRef.current === 'conflict') throw new Error('Resolve the save conflict first');
      if (!saving.current) await save();
      else await new Promise((r) => window.setTimeout(r, 100));
    }
    throw new Error('Still saving; try again in a moment');
  }, [save]);

  const setDetail = useCallback((d: Detail) => qc.setQueryData(['screenplay', id], d), [id, qc]);

  return {
    query: q,
    detail: q.data,
    setDetail,
    doc,
    title,
    setTitle,
    update,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    saveState,
    saveError,
    resolveConflict,
    saveNow: save,
    flush,
  };
}

export type ScreenplayState = ReturnType<typeof useScreenplay>;
