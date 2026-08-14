import { useState, useEffect, useCallback } from 'react';
import { Loader, AlertCircle } from 'lucide-react';
import { createCharacter, listCharacters, type CharacterDetail } from '../api/characters';
import { CharacterCard } from './CharacterCard';

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
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [characters, setCharacters] = useState<CharacterDetail[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setCharacters(await listCharacters());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createCharacter(name.trim(), description.trim() || undefined);
      setName('');
      setDescription('');
      await refresh();
    } catch (e: unknown) {
      const ae = e as { response?: { data?: { error?: string } }; message?: string };
      setError(ae?.response?.data?.error || ae?.message || 'Failed to create character');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '20px 24px', gap: 16 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>Character Studio</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 4 }}>
          Create a character, then generate a portrait and clone a voice for it. Everything starts as a
          fast, cheap draft — review it, request changes, then approve to render the full-quality final.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Character name"
          style={inputStyle}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          style={inputStyle}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
        />
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-error, #ef4444)', fontSize: 13 }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}
        <button
          onClick={handleCreate}
          disabled={submitting || !name.trim()}
          style={{
            padding: '10px 20px', background: 'var(--color-accent)', border: 'none',
            borderRadius: 'var(--radius)', color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: submitting || !name.trim() ? 'not-allowed' : 'pointer',
            opacity: submitting || !name.trim() ? 0.6 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'flex-start',
          }}
        >
          {submitting && <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />}
          {submitting ? 'Creating…' : 'New character'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, overflowY: 'auto' }}>
        {loading && <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />}
        {!loading && characters.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-dim)', fontSize: 14 }}>
            No characters yet. Create one above to get started.
          </div>
        )}
        {characters.map((c) => <CharacterCard key={c.id} character={c} onChange={refresh} />)}
      </div>
    </div>
  );
}
