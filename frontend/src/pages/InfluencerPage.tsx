// One influencer project: the step-by-step wizard, which stays available
// after launch for edits and the post queue.

import { useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Trash2 } from 'lucide-react';
import * as api from '../api/influencers';
import type { Detail } from '../api/influencers';
import { useAuth } from '../hooks/useAuth';
import { Alert, Loading, PageHeader, errorMessage } from '../components/ui';
import { STEP_LABELS, statusBadge, type StepProps } from '../components/social/shared';
import {
  StepAccounts,
  StepLaunch,
  StepLook,
  StepPersona,
  StepPlan,
  StepPortfolio,
  StepResearch,
  StepRules,
} from '../components/social/steps';

/** Which steps count as done, for the sidebar ticks. */
function doneSteps(d: Detail): Set<string> {
  const i = d.influencer;
  const done = new Set<string>();
  const a = i.attestation;
  if (a.invented && a.adult && a.disclose && a.platformRules && a.noDeception) done.add('rules');
  if (d.checks.persona.passed) done.add('persona');
  if (i.look.approvedMediaId) done.add('look');
  if (d.media.filter((m) => m.role === 'portfolio' && m.status === 'approved').length >= 6) done.add('portfolio');
  if ((i.research.topics ?? []).length) done.add('research');
  if (d.checks.plan.passed) done.add('plan');
  const plat = i.plan.platforms ?? [];
  if (plat.length && plat.every((p) => d.accounts.find((x) => x.platform === p)?.checklistDone)) done.add('accounts');
  if (i.status === 'active') done.add('launch');
  return done;
}

export function InfluencerPage() {
  const id = Number(useParams().id);
  const stepParam = useParams().step;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();

  const metaQ = useQuery({ queryKey: ['influencer-meta'], queryFn: api.getMeta, staleTime: 60_000 });
  const q = useQuery({
    queryKey: ['influencer', id],
    queryFn: () => api.getInfluencer(id),
    // Poll while images/clips render or a post is being generated.
    refetchInterval: (query) => {
      const d = query.state.data as Detail | undefined;
      if (!d) return false;
      if (d.working || d.media.some((m) => m.status === 'pending')) return 4000;
      return d.influencer.status === 'active' ? 30_000 : false;
    },
  });

  const apply = useCallback((d: Detail) => qc.setQueryData(['influencer', id], d), [qc, id]);

  if (q.isLoading || metaQ.isLoading) return <div className="page"><Loading /></div>;
  if (q.error || metaQ.error || !q.data || !metaQ.data) {
    return <div className="page"><Alert>{errorMessage(q.error ?? metaQ.error, 'Could not load the influencer')}</Alert></div>;
  }

  const detail = q.data;
  const meta = metaQ.data;
  const inf = detail.influencer;
  const steps = detail.steps;
  const current = steps.includes(stepParam ?? '') ? stepParam! : steps.includes(inf.step) ? inf.step : steps[0];
  const idx = steps.indexOf(current);
  const done = doneSteps(detail);
  const go = (step: string) => navigate(`/social/${id}/${step}`);

  const save: StepProps['save'] = async (patch, nextStep) => {
    const target = nextStep ? steps[Math.min(steps.length - 1, idx + 1)] : undefined;
    const d = await api.updateInfluencer(id, { ...patch, ...(target ? { step: target } : {}) });
    apply(d);
    qc.invalidateQueries({ queryKey: ['influencers'] });
    if (target) go(target);
  };

  const props: StepProps = {
    detail,
    meta,
    save,
    apply,
    next: () => go(steps[Math.min(steps.length - 1, idx + 1)]),
    back: () => go(steps[Math.max(0, idx - 1)]),
    isAdmin: user?.role === 'admin',
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${inf.name}" and all its posts? Generated images stay in the gallery.`)) return;
    await api.deleteInfluencer(id);
    qc.invalidateQueries({ queryKey: ['influencers'] });
    navigate('/social');
  };

  return (
    <div className="page">
      <PageHeader
        title={
          <>
            <Link to="/social" className="icon-btn" title="All influencers"><ChevronLeft size={18} /></Link>
            {inf.persona.displayName || inf.name} {statusBadge(inf.status)}
          </>
        }
        subtitle={inf.kind === 'visual' ? 'Photo & video persona' : 'Text & commentary persona'}
        actions={
          <button className="icon-btn danger" onClick={remove} title="Delete project">
            <Trash2 size={16} />
          </button>
        }
      />
      {inf.status === 'active' && ['persona', 'look'].includes(current) && (
        <Alert kind="info">Pause the influencer to change its persona or look.</Alert>
      )}
      <div className="social-layout">
        <nav className="wizard-steps">
          {steps.map((s, i) => (
            <button key={s} className={`wizard-step${s === current ? ' on' : ''}${done.has(s) ? ' done' : ''}`} onClick={() => go(s)}>
              <span className="num">{done.has(s) ? '✓' : i + 1}</span>
              {STEP_LABELS[s] ?? s}
            </button>
          ))}
        </nav>
        <section>
          <h2 className="section-title" style={{ fontSize: 16, marginBottom: 12 }}>{STEP_LABELS[current]}</h2>
          {current === 'rules' && <StepRules {...props} />}
          {current === 'persona' && <StepPersona {...props} />}
          {current === 'look' && <StepLook {...props} />}
          {current === 'portfolio' && <StepPortfolio {...props} />}
          {current === 'research' && <StepResearch {...props} refreshMeta={() => qc.invalidateQueries({ queryKey: ['influencer-meta'] })} />}
          {current === 'plan' && <StepPlan {...props} />}
          {current === 'accounts' && <StepAccounts {...props} />}
          {current === 'launch' && <StepLaunch {...props} />}
        </section>
      </div>
    </div>
  );
}
