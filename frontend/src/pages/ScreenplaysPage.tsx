// Screenplays: list, create, and import from Fountain or Final Draft.

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clapperboard, FileUp, Plus } from 'lucide-react';
import * as api from '../api/screenplays';
import type { ScreenplayDoc } from '../api/screenplays';
import { Alert, EmptyState, Field, Loading, Modal, PageHeader, errorMessage } from '../components/ui';
import { parseFdx, parseFountain } from '../components/screenplay/format';

function CreateModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.createScreenplay(title.trim() || 'Untitled screenplay');
      navigate(`/screenplays/${s.id}/script`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New screenplay"
      onClose={onClose}
      busy={busy}
      width={480}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={create} disabled={busy}>Create</button>
        </>
      }
    >
      <Field label="Title">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="Untitled screenplay" />
      </Field>
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}

export function ScreenplaysPage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  const q = useQuery({ queryKey: ['screenplays'], queryFn: api.listScreenplays });

  const importFile = async (f: File) => {
    setError(null);
    try {
      const text = await f.text();
      const parsed = /\.fdx$/i.test(f.name) ? parseFdx(text) : parseFountain(text);
      const title = parsed.titlePage.title?.split('\n')[0] || f.name.replace(/\.(fountain|spmd|txt|fdx)$/i, '');
      const doc: ScreenplayDoc = { elements: parsed.elements, shots: [], characters: [], plans: {}, settings: { ratio: '21:9' }, titlePage: parsed.titlePage };
      const s = await api.createScreenplay(title, doc);
      navigate(`/screenplays/${s.id}/script`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Screenplay"
        icon={<Clapperboard size={20} />}
        subtitle="Write film and TV scripts in industry format. DeadChat storyboards the shots you mark and keeps them in step as you revise; it never writes or changes the script."
        actions={
          <>
            <button className="btn" onClick={() => file.current?.click()}>
              <FileUp size={15} /> Import
            </button>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> New screenplay
            </button>
          </>
        }
      />
      <input ref={file} type="file" accept=".fountain,.spmd,.txt,.fdx" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
      {error && <Alert>{error}</Alert>}
      {q.isLoading && <Loading />}
      {q.error && <Alert>{errorMessage(q.error)}</Alert>}
      {q.data && q.data.length === 0 && (
        <EmptyState
          title="No screenplays yet"
          action={
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> New screenplay
            </button>
          }
        >
          Start a script, or import one from Fountain (.fountain) or Final Draft (.fdx).
        </EmptyState>
      )}
      {q.data && q.data.length > 0 && (
        <div className="card-grid">
          {q.data.map((s) => (
            <button key={s.id} className="card sp-card" onClick={() => navigate(`/screenplays/${s.id}/script`)}>
              <strong>{s.title}</strong>
              <span className="field-hint">
                {s.scenes} scene{s.scenes === 1 ? '' : 's'} · {s.shots} shot{s.shots === 1 ? '' : 's'} · {s.characters} character{s.characters === 1 ? '' : 's'}
              </span>
              <span className="field-hint">Edited {new Date(`${s.updatedAt.replace(' ', 'T')}Z`).toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} />}
    </div>
  );
}
