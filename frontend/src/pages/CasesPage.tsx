// Medical cases: list and create.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Stethoscope } from 'lucide-react';
import * as api from '../api/cases';
import { Alert, EmptyState, Field, Loading, Modal, PageHeader, errorMessage } from '../components/ui';
import { useBlob } from '../components/cases/blobs';

function CaseThumb({ caseId, itemId }: { caseId: number; itemId: number | null }) {
  const { url } = useBlob(itemId ? api.itemUrl(caseId, itemId, 'thumb?v=1') : null);
  return <div className="cs-list-thumb">{url ? <img src={url} alt="" /> : <Stethoscope size={22} />}</div>;
}

export function CasesPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['cases'], queryFn: api.listCases });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api.createCase(title.trim() || 'Untitled case');
      navigate(`/cases/${d.case.id}/evidence`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Medical cases"
        icon={<Stethoscope size={20} />}
        subtitle="Bring a case’s imaging, cine loops, ECGs, labs, reports and history together, then present it with drill-down to every study. Files stay on your server."
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> New case
          </button>
        }
      />
      {q.isLoading && <Loading />}
      {q.error && <Alert>{errorMessage(q.error)}</Alert>}
      {q.data?.length === 0 && (
        <EmptyState
          title="No cases yet"
          action={
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> New case
            </button>
          }
        >
          Create a case, then drop in a DICOM export, videos, PDFs and photos.
        </EmptyState>
      )}
      {q.data && q.data.length > 0 && (
        <div className="card-grid">
          {q.data.map((c) => (
            <button key={c.id} className="card cs-list-card" onClick={() => navigate(`/cases/${c.id}/overview`)}>
              <CaseThumb caseId={c.id} itemId={c.thumbItem} />
              <div>
                <strong>{c.title}</strong>
                <span className="field-hint">{[c.age, c.sex, c.specialty].filter(Boolean).join(' · ')}</span>
                {c.chiefComplaint && <span className="field-hint">{c.chiefComplaint}</span>}
                <span className="field-hint">{c.items} item{c.items === 1 ? '' : 's'} · edited {new Date(`${c.updatedAt.replace(' ', 'T')}Z`).toLocaleDateString()}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {creating && (
        <Modal
          title="New case"
          onClose={() => setCreating(false)}
          busy={busy}
          width={480}
          footer={
            <>
              <button className="btn" onClick={() => setCreating(false)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={create} disabled={busy}>Create</button>
            </>
          }
        >
          <Field label="Title" hint="A de-identified label, e.g. “6-year-old with exercise intolerance after TOF repair”.">
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="Untitled case" />
          </Field>
          {error && <Alert>{error}</Alert>}
        </Modal>
      )}
    </div>
  );
}
