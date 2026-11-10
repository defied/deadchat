// One medical case: Overview (drill-down), Evidence, Profile, and Present.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ClipboardList, Eye, FolderOpen, LayoutDashboard, Loader2, LogOut, MonitorPlay, Pencil, Share2, Trash2, Users } from 'lucide-react';
import * as api from '../api/cases';
import { useAuth } from '../hooks/useAuth';
import type { CaseDetail, CaseProfile } from '../api/cases';
import { Alert, Loading, RouteTabs, errorMessage } from '../components/ui';
import { Overview } from '../components/cases/Overview';
import { Evidence } from '../components/cases/Evidence';
import { Profile } from '../components/cases/Profile';
import { ItemDetail } from '../components/cases/ItemDetail';
import { Present } from '../components/cases/Present';
import { ShareDialog } from '../components/cases/ShareDialog';
import { CaseAccessContext } from '../components/cases/access';

export function CasePage() {
  const id = Number(useParams().id);
  const tab = useParams().tab ?? 'overview';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['case', id],
    queryFn: () => api.getCase(id),
    refetchInterval: (query) => {
      const d = query.state.data as CaseDetail | undefined;
      return d?.items.some((i) => i.status === 'processing' || i.aiStatus === 'running' || (i.analysis && ['queued', 'running'].includes(i.analysis.status))) ? 2000 : false;
    },
  });
  const setDetail = useCallback((fn: (d: CaseDetail) => CaseDetail) => qc.setQueryData<CaseDetail>(['case', id], (d) => (d ? fn(d) : d)), [id, qc]);

  // Profile and title: local while typing, saved shortly after.
  const [profile, setProfile] = useState<CaseProfile | null>(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<{ title?: string; profile?: CaseProfile }>({});
  useEffect(() => {
    if (q.data && profile === null) {
      setProfile(q.data.case.profile);
      setTitle(q.data.case.title);
    }
  }, [q.data, profile]);

  const flush = useCallback(async () => {
    const patch = pending.current;
    pending.current = {};
    if (!patch.title && !patch.profile) return;
    setSaving('saving');
    try {
      const d = await api.updateCase(id, patch);
      setDetail((cur) => ({ ...cur, case: d.case }));
      setSaving(Object.keys(pending.current).length ? 'unsaved' : 'saved');
    } catch (e) {
      setError(errorMessage(e));
      setSaving('unsaved');
    }
  }, [id, setDetail]);
  const queue = (patch: { title?: string; profile?: CaseProfile }) => {
    pending.current = { ...pending.current, ...patch };
    setSaving('unsaved');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 800);
  };
  useEffect(() => () => void flush(), [flush]);

  const [open, setOpen] = useState<number | null>(null);
  const [presenting, setPresenting] = useState<{ start?: number } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  if (q.isLoading || !q.data || !profile) return q.error ? <div className="page"><Alert>{errorMessage(q.error)}</Alert></div> : <Loading />;
  const detail: CaseDetail = { ...q.data, case: { ...q.data.case, profile, title } };
  const shown = detail.items.filter((i) => i.include);
  const access = q.data.access;
  const readOnly = access === 'viewer';
  const isOwner = access === 'owner';

  return (
    <CaseAccessContext.Provider value={access}>
    <div className={`page cs-page ${readOnly ? 'cs-readonly' : ''}`}>
      <div className="sp-header">
        <Link to="/cases" className="icon-btn" title="All cases"><ChevronLeft size={18} /></Link>
        <input
          className="sp-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            queue({ title: e.target.value });
          }}
          aria-label="Case title"
          readOnly={readOnly}
        />
        {readOnly ? (
          <span className="cs-shared-chip" title={`Shared with you by ${detail.owner}. You can look at everything but not change it.`}>
            <Eye size={12} /> View only · shared by {detail.owner}
          </span>
        ) : (
          <span className={`sp-save ${saving}`}>
            {saving === 'saving' ? <Loader2 size={12} className="spin" /> : saving === 'saved' ? <Check size={12} /> : null} {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : 'Unsaved'}
          </span>
        )}
        {access === 'editor' && (
          <span className="cs-shared-chip" title={`Shared with you by ${detail.owner}. You can edit it.`}>
            <Pencil size={12} /> Shared by {detail.owner}
          </span>
        )}
        <span className="sp-grow" />
        <button
          className="btn btn-primary"
          onClick={async () => {
            await flush();
            setPresenting({});
          }}
          disabled={!shown.length && !profile.chiefComplaint}
        >
          <MonitorPlay size={15} /> Present
        </button>
        {isOwner ? (
          <>
            <button className="btn" onClick={() => setSharing(true)} title="Share this case with other members">
              {detail.shares.length ? <Users size={15} /> : <Share2 size={15} />} {detail.shares.length ? `Shared (${detail.shares.length})` : 'Share'}
            </button>
            <button
              className="icon-btn"
              title="Delete case"
              onClick={async () => {
                if (!window.confirm(`Delete “${title}” and all its files?${detail.shares.length ? ` It’s shared with ${detail.shares.length} member${detail.shares.length === 1 ? '' : 's'}; they’ll lose it too.` : ''}`)) return;
                await api.deleteCase(id);
                navigate('/cases');
              }}
            >
              <Trash2 size={15} />
            </button>
          </>
        ) : (
          <button
            className="icon-btn"
            title="Remove this shared case from your list"
            onClick={async () => {
              if (!window.confirm(`Remove “${title}” from your cases? ${detail.owner} can share it again.`)) return;
              const me = detail.shares.find((s) => s.role === access && s.username === user?.username);
              if (me) await api.unshareCase(id, me.userId);
              navigate('/cases');
            }}
          >
            <LogOut size={15} />
          </button>
        )}
      </div>
      {error && <Alert>{error}</Alert>}

      <RouteTabs
        tabs={[
          { to: `/cases/${id}/overview`, label: 'Overview', icon: <LayoutDashboard size={14} /> },
          { to: `/cases/${id}/evidence`, label: `Evidence${detail.items.length ? ` (${detail.items.length})` : ''}`, icon: <FolderOpen size={14} /> },
          { to: `/cases/${id}/profile`, label: 'Profile', icon: <ClipboardList size={14} /> },
        ]}
      />

      {tab === 'overview' && (
        <Overview
          detail={detail}
          onOpen={setOpen}
          drafting={drafting}
          draftError={draftError}
          onDraft={async () => {
            setDrafting(true);
            setDraftError(null);
            try {
              await flush();
              const d = await api.draftSummary(id);
              setDetail((cur) => ({ ...cur, case: d.case }));
            } catch (e) {
              setDraftError(errorMessage(e));
            } finally {
              setDrafting(false);
            }
          }}
          onSaveSummary={async (summary) => {
            const d = await api.updateCase(id, { summary });
            setDetail((cur) => ({ ...cur, case: d.case }));
          }}
        />
      )}
      {tab === 'evidence' && <Evidence detail={detail} setDetail={setDetail} refetch={() => void q.refetch()} onOpen={setOpen} />}
      {tab === 'profile' && (
        <fieldset className="cs-fieldset" disabled={readOnly}>
          <Profile
            profile={profile}
            onChange={(p) => {
              setProfile(p);
              queue({ profile: p });
            }}
          />
        </fieldset>
      )}

      {open != null && (
        <ItemDetail
          caseId={id}
          items={tab === 'overview' ? shown : detail.items}
          itemId={open}
          onClose={() => setOpen(null)}
          onGo={setOpen}
          onChanged={() => void q.refetch()}
        />
      )}
      {presenting && <Present detail={detail} startItem={presenting.start} onClose={() => setPresenting(null)} />}
      {sharing && <ShareDialog detail={detail} onChange={(d) => setDetail((cur) => ({ ...cur, shares: d.shares }))} onClose={() => setSharing(false)} />}
    </div>
    </CaseAccessContext.Provider>
  );
}
