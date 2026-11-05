// Social Media tab: list of influencers, and the entry point to create one.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Image as ImageIcon, Megaphone, Newspaper, Plus, UserRound } from 'lucide-react';
import * as api from '../api/influencers';
import type { InfluencerKind } from '../api/influencers';
import { Alert, EmptyState, Field, Loading, Modal, PageHeader, errorMessage } from '../components/ui';
import { AuthedMedia, statusBadge } from '../components/social/shared';

function CreateModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<InfluencerKind>('visual');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api.createInfluencer(name.trim(), kind);
      navigate(`/social/${d.influencer.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New influencer"
      onClose={onClose}
      busy={busy}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={create} disabled={busy || !name.trim()}>Create project</button>
        </>
      }
    >
      <div className="kind-choice">
        <button className={kind === 'visual' ? 'on' : ''} onClick={() => setKind('visual')}>
          <strong><ImageIcon size={15} /> Photo & video persona</strong>
          A consistent AI character whose photos and clips are generated on your GPU with local models.
        </button>
        <button className={kind === 'text' ? 'on' : ''} onClick={() => setKind('text')}>
          <strong><Newspaper size={15} /> Text & commentary</strong>
          Posts and stories about chosen topics. Every post is researched and fact-checked against trusted sources first.
        </button>
      </div>
      <Field label="Project name" hint="Just for you; the persona's public name comes later.">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} />
      </Field>
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}

export function SocialPage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['influencers'], queryFn: api.listInfluencers });

  return (
    <div className="page">
      <PageHeader
        title="Social Media"
        icon={<Megaphone size={20} />}
        subtitle="AI influencers: design a persona, build its portfolio, connect accounts and automate posting, within each platform's rules."
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> New influencer
          </button>
        }
      />
      {q.isLoading && <Loading />}
      {q.error && <Alert>{errorMessage(q.error)}</Alert>}
      {q.data && q.data.length === 0 && (
        <EmptyState
          title="No influencers yet"
          action={
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> Create your first
            </button>
          }
        >
          The wizard walks you through the rules, persona, look, portfolio, posting plan and accounts.
        </EmptyState>
      )}
      <div className="card-grid">
        {(q.data ?? []).map((i) => (
          <button key={i.id} className="card influencer-card" onClick={() => navigate(`/social/${i.id}`)}>
            <div className="influencer-thumb">
              {i.look.approvedMediaId ? <AuthedMedia mediaId={i.look.approvedMediaId} /> : i.kind === 'text' ? <Newspaper size={22} /> : <UserRound size={22} />}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <strong>{i.persona.displayName || i.name}</strong> {statusBadge(i.status)}
              </div>
              <div className="field-hint">{i.kind === 'visual' ? 'Photo & video' : 'Text & commentary'} · {i.persona.niche || 'no niche yet'}</div>
              <div className="field-hint" style={{ marginTop: 4 }}>
                {i.status === 'draft'
                  ? `Wizard: ${i.step}`
                  : `${i.published} published${i.pendingReview ? ` · ${i.pendingReview} waiting for review` : ''}`}
              </div>
            </div>
          </button>
        ))}
      </div>
      {creating && <CreateModal onClose={() => setCreating(false)} />}
    </div>
  );
}
