// A character's speaking voice for the animatic: record or upload a short
// sample, or borrow the voice of one of your Studio characters. The speech
// service clones the voice from the sample.

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Mic, Square, Upload } from 'lucide-react';
import * as api from '../../api/screenplays';
import type { Character, Detail } from '../../api/screenplays';
import { Alert, errorMessage } from '../ui';
import { MusicButton } from './media';

const MAX_SECONDS = 30;

export function VoiceSource({
  screenplayId,
  character: c,
  detail,
  set,
  flush,
  setDetail,
}: {
  screenplayId: number;
  character: Character;
  detail?: Detail;
  set: (patch: Partial<Character>, field: string) => void;
  flush: () => Promise<void>;
  setDetail: (d: Detail) => void;
}) {
  const studio = useQuery({ queryKey: ['studio-voices'], queryFn: api.listStudioVoices, staleTime: 60_000 });
  const samples = (detail?.media.other ?? []).filter((m) => m.role === 'sound' && m.target === `voice:${c.id}` && m.media_id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<{ rec: MediaRecorder; started: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const ref = c.voiceRef;
  const current = ref?.kind === 'upload' ? samples.find((m) => m.id === ref.mediaRowId) : undefined;
  const currentStudio = ref?.kind === 'studio' ? studio.data?.find((x) => x.id === ref.characterId) : undefined;

  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => {
      const s = (Date.now() - recording.started) / 1000;
      setElapsed(s);
      if (s >= MAX_SECONDS) recording.rec.stop();
    }, 200);
    return () => window.clearInterval(t);
  }, [recording]);

  const save = async (blob: Blob, name: string) => {
    setBusy('Saving the sample…');
    setError(null);
    try {
      await flush();
      const r = await api.uploadVoiceSample(screenplayId, c.id, blob, name);
      setDetail(r);
      set({ voiceRef: { kind: 'upload', mediaRowId: r.added } }, 'voiceRef');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const record = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(null);
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (blob.size) void save(blob, `${c.name || 'voice'}.${(rec.mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm'}`);
      };
      rec.start();
      setElapsed(0);
      setRecording({ rec, started: Date.now() });
    } catch {
      setError('Couldn’t use the microphone. Allow microphone access for this site, or upload a recording instead.');
    }
  };

  return (
    <div className="sp-voice">
      <div className="sp-voice-now">
        {current?.media_id ? (
          <>
            <MusicButton mediaId={current.media_id} label="Play the voice sample" />
            <span>Voice sample: {current.label}</span>
          </>
        ) : currentStudio ? (
          <>
            <MusicButton mediaId={currentStudio.sampleMediaId} label="Play the voice" />
            <span>Voice of {currentStudio.name} (Studio)</span>
          </>
        ) : (
          <span className="field-hint">No voice yet: the animatic shows {c.name || 'this character'}’s lines as subtitles only.</span>
        )}
      </div>
      <div className="sp-voice-actions">
        {recording ? (
          <button className="btn btn-sm btn-primary" onClick={() => recording.rec.stop()}>
            <Square size={13} /> Stop ({Math.floor(elapsed)}s)
          </button>
        ) : (
          <button className="btn btn-sm" onClick={record} disabled={!!busy} title={`Read anything for 10–${MAX_SECONDS} seconds in the character's voice`}>
            <Mic size={13} /> Record a sample
          </button>
        )}
        <button className="btn btn-sm" onClick={() => input.current?.click()} disabled={!!busy || !!recording}>
          <Upload size={13} /> Upload a sample
        </button>
        <input
          ref={input}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void save(f, f.name);
            e.target.value = '';
          }}
        />
        {(studio.data?.length ?? 0) > 0 && (
          <select
            value={ref?.kind === 'studio' ? String(ref.characterId) : ''}
            onChange={(e) => e.target.value && set({ voiceRef: { kind: 'studio', characterId: Number(e.target.value) } }, 'voiceRef')}
            aria-label="Use a Studio character's voice"
          >
            <option value="">Use a Studio character’s voice…</option>
            {studio.data!.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {samples.length > 1 && (
          <select
            value={ref?.kind === 'upload' ? String(ref.mediaRowId) : ''}
            onChange={(e) => e.target.value && set({ voiceRef: { kind: 'upload', mediaRowId: Number(e.target.value) } }, 'voiceRef')}
            aria-label="Earlier samples"
          >
            <option value="">Earlier samples…</option>
            {samples.map((m) => <option key={m.id} value={m.id}>{m.label} ({new Date(`${m.created_at.replace(' ', 'T')}Z`).toLocaleDateString()})</option>)}
          </select>
        )}
        {busy && <span className="field-hint"><Loader2 size={12} className="spin" /> {busy}</span>}
      </div>
      <p className="field-hint">
        6–30 seconds of one person speaking clearly, without music, works best. Only use a voice you have permission to use. The speech model
        (XTTS-v2) is licensed for non-commercial use.
      </p>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
