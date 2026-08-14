import { useState, useEffect, useCallback } from 'react';
import { Loader, AlertCircle } from 'lucide-react';
import { createAsset, listAssets, type CreativeAsset } from '../api/assets';
import { AssetCard } from './AssetCard';

// Phase 1 of the movie-studio pipeline: only 'character_portrait' has a
// registered handler on the backend today. More asset types (voice, scene,
// 3D environment, shot render) plug into the same UI as their handlers land.
const ASSET_TYPE = 'character_portrait';

const inputStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  color: 'var(--color-text)',
  padding: '7px 10px',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

export function AssetPipelinePanel() {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<CreativeAsset[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setAssets(await listAssets());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = async () => {
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createAsset(ASSET_TYPE, { prompt: prompt.trim() }, name.trim() || undefined);
      setPrompt('');
      setName('');
      await refresh();
    } catch (e: unknown) {
      const ae = e as { response?: { data?: { error?: string } }; message?: string };
      setError(ae?.response?.data?.error || ae?.message || 'Failed to create asset');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '20px 24px', gap: 16 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>Character Studio</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 4 }}>
          Every character starts as a fast, cheap draft. Review it, request changes, then approve to
          render the full-quality final.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Character name (optional)"
          style={inputStyle}
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the character's appearance…"
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) handleCreate(); }}
        />
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-error, #ef4444)', fontSize: 13 }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}
        <button
          onClick={handleCreate}
          disabled={submitting || !prompt.trim()}
          style={{
            padding: '10px 20px', background: 'var(--color-accent)', border: 'none',
            borderRadius: 'var(--radius)', color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: submitting || !prompt.trim() ? 'not-allowed' : 'pointer',
            opacity: submitting || !prompt.trim() ? 0.6 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'flex-start',
          }}
        >
          {submitting && <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />}
          {submitting ? 'Queuing draft…' : 'Generate draft'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflowY: 'auto' }}>
        {loading && <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />}
        {!loading && assets.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-dim)', fontSize: 14 }}>
            No characters yet. Describe one above to get started.
          </div>
        )}
        {assets.map((a) => <AssetCard key={a.id} assetId={a.id} />)}
      </div>
    </div>
  );
}
