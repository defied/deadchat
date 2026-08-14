import { useState } from 'react';
import { Loader, AlertCircle, Mic, User2, Send } from 'lucide-react';
import { createCharacterPortrait, createCharacterVoice, speak, type CharacterDetail } from '../api/characters';
import { pollJob } from '../api/jobs';
import { AssetCard } from './AssetCard';
import { MediaAudio } from './MediaAudio';

// A voice asset is speakable once it has produced at least one media file -
// mirrors the backend's check in POST /api/characters/:id/speak.
function isVoiceReady(voice: CharacterDetail['voice']): boolean {
  return !!voice && (voice.draft_media_id != null || voice.final_media_id != null);
}

interface SpokenLine {
  id: number;
  text: string;
  status: 'pending' | 'succeeded' | 'failed';
  mediaId?: number;
  error?: string;
}

const inputStyle: React.CSSProperties = {
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  color: 'var(--color-text)',
  padding: '7px 10px',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-dim)',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

export function CharacterCard({ character, onChange }: { character: CharacterDetail; onChange: () => void }) {
  const [portraitPrompt, setPortraitPrompt] = useState('');
  const [portraitBusy, setPortraitBusy] = useState(false);
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [sampleText, setSampleText] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [speakText, setSpeakText] = useState('');
  const [speakBusy, setSpeakBusy] = useState(false);
  const [lines, setLines] = useState<SpokenLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleGeneratePortrait = async () => {
    if (!portraitPrompt.trim()) return;
    setPortraitBusy(true);
    setError(null);
    try {
      await createCharacterPortrait(character.id, portraitPrompt.trim());
      setPortraitPrompt('');
      onChange();
    } catch (e: unknown) {
      const ae = e as { response?: { data?: { error?: string } }; message?: string };
      setError(ae?.response?.data?.error || ae?.message || 'Failed to generate portrait');
    } finally {
      setPortraitBusy(false);
    }
  };

  const handleCloneVoice = async () => {
    if (!voiceFile) return;
    setVoiceBusy(true);
    setError(null);
    try {
      await createCharacterVoice(character.id, voiceFile, sampleText.trim() || undefined);
      setVoiceFile(null);
      setSampleText('');
      onChange();
    } catch (e: unknown) {
      const ae = e as { response?: { data?: { error?: string } }; message?: string };
      setError(ae?.response?.data?.error || ae?.message || 'Failed to clone voice');
    } finally {
      setVoiceBusy(false);
    }
  };

  const handleSpeak = async () => {
    const text = speakText.trim();
    if (!text) return;
    setSpeakBusy(true);
    setError(null);
    try {
      const { job_id } = await speak(character.id, text);
      const lineId = job_id;
      setLines((prev) => [{ id: lineId, text, status: 'pending' }, ...prev]);
      setSpeakText('');
      pollJob(job_id).then((job) => {
        setLines((prev) => prev.map((l) => {
          if (l.id !== lineId) return l;
          if (job.status === 'succeeded') {
            const result = job.result ? JSON.parse(job.result) as Record<string, unknown> : {};
            const mediaId = (result.media_ids as number[] | undefined)?.[0];
            return { ...l, status: 'succeeded', mediaId };
          }
          return { ...l, status: 'failed', error: job.error ?? 'Failed' };
        }));
      }).catch(() => {
        setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, status: 'failed', error: 'Failed to poll job' } : l)));
      });
    } catch (e: unknown) {
      const ae = e as { response?: { data?: { error?: string } }; message?: string };
      setError(ae?.response?.data?.error || ae?.message || 'Failed to speak line');
    } finally {
      setSpeakBusy(false);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 14,
      padding: 16, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{character.name}</div>
      {character.description && (
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: -8 }}>{character.description}</div>
      )}

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-error, #ef4444)' }}>
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {/* Portrait */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={sectionLabelStyle}><User2 size={12} /> Portrait</span>
        {character.portrait ? (
          <AssetCard assetId={character.portrait.id} />
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={portraitPrompt}
              onChange={(e) => setPortraitPrompt(e.target.value)}
              placeholder="Describe the character's appearance…"
              style={inputStyle}
              onKeyDown={(e) => { if (e.key === 'Enter') handleGeneratePortrait(); }}
            />
            <button
              onClick={handleGeneratePortrait}
              disabled={portraitBusy || !portraitPrompt.trim()}
              style={{ padding: '7px 14px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: portraitBusy ? 'not-allowed' : 'pointer', opacity: portraitBusy || !portraitPrompt.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}
            >
              {portraitBusy ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : 'Generate'}
            </button>
          </div>
        )}
      </div>

      {/* Voice */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={sectionLabelStyle}><Mic size={12} /> Voice</span>
        {character.voice ? (
          <AssetCard assetId={character.voice.id} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setVoiceFile(e.target.files?.[0] ?? null)}
              style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}
            />
            <input
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              placeholder="Sample line to test the clone (optional)"
              style={inputStyle}
            />
            <button
              onClick={handleCloneVoice}
              disabled={voiceBusy || !voiceFile}
              style={{ alignSelf: 'flex-start', padding: '7px 14px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: voiceBusy ? 'not-allowed' : 'pointer', opacity: voiceBusy || !voiceFile ? 0.6 : 1 }}
            >
              {voiceBusy ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : 'Clone voice'}
            </button>
          </div>
        )}
      </div>

      {/* Speak */}
      {isVoiceReady(character.voice) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
          <span style={sectionLabelStyle}><Send size={12} /> Speak</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={speakText}
              onChange={(e) => setSpeakText(e.target.value)}
              placeholder="Type a line for the character to say…"
              style={inputStyle}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSpeak(); }}
            />
            <button
              onClick={handleSpeak}
              disabled={speakBusy || !speakText.trim()}
              style={{ padding: '7px 14px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: speakBusy ? 'not-allowed' : 'pointer', opacity: speakBusy || !speakText.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}
            >
              Speak
            </button>
          </div>
          {lines.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lines.map((l) => (
                <div key={l.id} style={{ fontSize: 12 }}>
                  <div style={{ color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {l.status === 'pending' && <Loader size={11} style={{ animation: 'spin 1s linear infinite' }} />}
                    "{l.text}"
                  </div>
                  {l.status === 'succeeded' && l.mediaId != null && <MediaAudio mediaId={l.mediaId} />}
                  {l.status === 'failed' && <div style={{ color: 'var(--color-error, #ef4444)' }}>{l.error}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
