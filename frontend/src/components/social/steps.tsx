// The influencer wizard, one component per step.

import { useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, Clapperboard, ExternalLink, Loader2, RefreshCw, Sparkles, ThumbsDown, ThumbsUp, Wand2 } from 'lucide-react';
import * as api from '../../api/influencers';
import type { InfluencerMedia, Persona, PersonaSuggestion, Research } from '../../api/influencers';
import { Alert, Field } from '../ui';
import { AuthedMedia, CheckList, ListEditor, StepNav, statusBadge, useAction, type StepProps } from './shared';
import { PostsPanel } from './posts';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 25 }, (_, h) => h);
const fmtHour = (h: number) => (h === 0 || h === 24 ? '12 am' : h === 12 ? '12 pm' : h < 12 ? `${h} am` : `${h - 12} pm`);

// ── 1. Ground rules ────────────────────────────────────────────────────────

const RULES: Array<{ key: keyof api.Attestation; title: string; body: string }> = [
  {
    key: 'invented',
    title: 'The persona is invented.',
    body: "It isn't based on, and doesn't resemble, any real person. No real photos are used to create its face.",
  },
  {
    key: 'adult',
    title: 'The persona is a clearly adult character.',
    body: 'It has a stated age of 21 or older, looks like an adult in every image, and is never aimed at minors.',
  },
  {
    key: 'disclose',
    title: 'Every account is labelled as AI.',
    body: "The bio says it's an AI-generated persona, images carry an embedded AI tag that platforms read to label them, and each platform's AI label is turned on.",
  },
  {
    key: 'noDeception',
    title: "It never pretends to be a real person.",
    body: "No claiming to be human, no romantic or financial relationships with followers, no impersonating real people or organisations.",
  },
  {
    key: 'platformRules',
    title: "I'll follow each platform's rules.",
    body: 'Including limits on automation, political content and spam. DeadChat caps posting volume and blocks posts that fail its checks.',
  },
];

export function StepRules({ detail, save, busyGlobal }: StepProps & { busyGlobal?: boolean }) {
  const [a, setA] = useState<api.Attestation>(detail.influencer.attestation);
  const { busy, error, run } = useAction();
  const all = RULES.every((r) => a[r.key]);
  return (
    <div>
      <p className="section-hint" style={{ marginBottom: 16 }}>
        These rules keep the persona honest and its accounts in good standing. DeadChat enforces them on every image and
        post, whatever the automation settings say.
      </p>
      <div className="rule-list">
        {RULES.map((r) => (
          <label key={r.key} className="toggle card">
            <input type="checkbox" checked={!!a[r.key]} onChange={(e) => setA({ ...a, [r.key]: e.target.checked })} />
            <span>
              <strong>{r.title}</strong> {r.body}
            </span>
          </label>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
      <StepNav
        onNext={() => run('save', () => save({ attestation: a }, true))}
        nextLabel="Accept & continue"
        nextDisabled={!all}
        busy={!!busy || busyGlobal}
      />
    </div>
  );
}

// ── 2. Persona ─────────────────────────────────────────────────────────────

export function StepPersona({ detail, meta, save, back }: StepProps) {
  const inf = detail.influencer;
  const [p, setP] = useState<Persona>(inf.persona);
  const [brief, setBrief] = useState('');
  const [suggested, setSuggested] = useState<PersonaSuggestion | null>(null);
  const { busy, error, run } = useAction();
  const set = (k: keyof Persona) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setP({ ...p, [k]: k === 'age' ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value });

  const suggest = () =>
    run('suggest', async () => {
      const s = await api.suggestPersona(inf.id, brief);
      setP(s.persona);
      setSuggested(s);
    });

  const saveAndNext = () =>
    run('save', () =>
      save(
        {
          persona: p,
          ...(suggested?.appearance && !inf.look.appearance ? { look: { appearance: suggested.appearance } } : {}),
          ...(suggested?.themes?.length && !(inf.plan.themes ?? []).length ? { plan: { themes: suggested.themes } } : {}),
          ...(suggested?.topics?.length && !(inf.research.topics ?? []).length ? { research: { topics: suggested.topics } } : {}),
        },
        true,
      ),
    );

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <Field label="Describe the persona you want" hint="Optional. The AI drafts every field below; edit anything before saving.">
          <textarea
            rows={2}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={
              inf.kind === 'visual'
                ? 'e.g. a trail runner and camp cook in the Pacific Northwest, warm and funny'
                : 'e.g. calm, non-partisan explainer of what Congress did this week'
            }
          />
        </Field>
        <button className="btn" onClick={suggest} disabled={!!busy}>
          {busy === 'suggest' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {inf.persona.displayName ? 'Suggest again' : 'Suggest a persona'}
        </button>
        {suggested && (
          <div className="field-hint" style={{ marginTop: 8 }}>
            Draft filled in.{' '}
            {suggested.appearance && 'A look description and photo themes were drafted too. '}
            {suggested.topics?.length ? `Topics: ${suggested.topics.join(', ')}. ` : ''}
            Keep refining with a new description, or edit the fields.
          </div>
        )}
      </div>

      <div className="form-grid">
        <Field label="Display name">
          <input value={p.displayName ?? ''} onChange={set('displayName')} />
        </Field>
        <Field label="Age" hint={`${meta.rules.minAge} or older`}>
          <input type="number" min={meta.rules.minAge} max={90} value={p.age ?? ''} onChange={set('age')} />
        </Field>
        <Field label="Gender">
          <input value={p.gender ?? ''} onChange={set('gender')} placeholder="woman, man, non-binary…" />
        </Field>
        <Field label="Language">
          <input value={p.language ?? ''} onChange={set('language')} />
        </Field>
        <div className="wide">
          <Field label="Niche — what they post about">
            <input value={p.niche ?? ''} onChange={set('niche')} />
          </Field>
        </div>
        <Field label="Audience">
          <input value={p.audience ?? ''} onChange={set('audience')} placeholder="Adults who…" />
        </Field>
        <Field label="Voice / tone">
          <input value={p.tone ?? ''} onChange={set('tone')} />
        </Field>
        {inf.kind === 'text' && (
          <div className="wide">
            <Field label="Perspective" hint="How the persona approaches topics. Facts are always verified; opinions are labelled as opinions.">
              <input value={p.perspective ?? ''} onChange={set('perspective')} placeholder="neutral explainer" />
            </Field>
          </div>
        )}
        <div className="wide">
          <Field label="Bio">
            <textarea rows={2} value={p.bio ?? ''} onChange={set('bio')} />
          </Field>
        </div>
        <div className="wide">
          <Field label="Backstory" hint="Kept consistent across posts.">
            <textarea rows={3} value={p.backstory ?? ''} onChange={set('backstory')} />
          </Field>
        </div>
        <div className="wide">
          <Field label="AI disclosure" hint="Shown in the bio on every platform. Must mention AI.">
            <input value={p.disclosure ?? ''} onChange={set('disclosure')} />
          </Field>
        </div>
      </div>

      <CheckList kind="warn" title="Before this persona can be used:" items={detail.checks.persona.issues} />
      {error && <Alert>{error}</Alert>}
      <StepNav onBack={back} onNext={saveAndNext} busy={!!busy} />
    </div>
  );
}

// ── shared candidate grid ──────────────────────────────────────────────────

function CandidateGrid({
  rows,
  onApprove,
  onReject,
  onAnimate,
  busy,
}: {
  rows: InfluencerMedia[];
  onApprove?: (r: InfluencerMedia) => void;
  onReject?: (r: InfluencerMedia) => void;
  onAnimate?: (r: InfluencerMedia) => void;
  busy?: boolean;
}) {
  if (!rows.length) return null;
  return (
    <div className="candidate-grid">
      {rows.map((r) => (
        <div key={r.id} className={`candidate ${r.status}`}>
          <div className="candidate-media">
            {r.media_id ? (
              <AuthedMedia mediaId={r.media_id} video={r.role === 'clip'} alt={r.scene ?? ''} />
            ) : r.status === 'failed' ? (
              <span className="field-hint" style={{ padding: 8 }}>{r.error ?? 'Failed'}</span>
            ) : (
              <span className="field-hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Loader2 size={14} className="spin" /> Generating…
              </span>
            )}
          </div>
          {r.scene && <div className="candidate-scene" title={r.scene}>{r.scene}</div>}
          <div className="candidate-actions">
            {statusBadge(r.status === 'ready' ? 'new' : r.status)}
            <span style={{ display: 'flex', gap: 4 }}>
              {onAnimate && r.status === 'approved' && r.role !== 'clip' && (
                <button className="icon-btn" title="Make a short clip from this image" onClick={() => onAnimate(r)} disabled={busy}>
                  <Clapperboard size={15} />
                </button>
              )}
              {onApprove && r.media_id && r.status !== 'approved' && (
                <button className="icon-btn" title="Approve" onClick={() => onApprove(r)} disabled={busy}>
                  <ThumbsUp size={15} />
                </button>
              )}
              {onReject && r.media_id && r.status !== 'rejected' && (
                <button className="icon-btn danger" title="Reject" onClick={() => onReject(r)} disabled={busy}>
                  <ThumbsDown size={15} />
                </button>
              )}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 3. Look (visual) ───────────────────────────────────────────────────────

export function StepLook({ detail, meta, save, apply, back, next }: StepProps) {
  const inf = detail.influencer;
  const [appearance, setAppearance] = useState(inf.look.appearance ?? '');
  const [style, setStyle] = useState(inf.look.style ?? '');
  const [model, setModel] = useState(inf.look.imageModel ?? meta.models.image[0]?.id ?? '');
  const [ratio, setRatio] = useState(inf.look.ratio ?? '3:4');
  const savedLevel = inf.look.contentLevel ?? (inf.look.suggestive ? 'implied' : 'sfw');
  const [level, setLevel] = useState<'sfw' | 'implied' | 'explicit'>(savedLevel);
  const [feedback, setFeedback] = useState('');
  const { busy, error, run } = useAction();
  const looks = detail.media.filter((m) => m.role === 'look');
  const shown = [...looks.filter((m) => m.status !== 'rejected'), ...looks.filter((m) => m.status === 'rejected')].slice(0, 16);
  const dirty =
    appearance !== (inf.look.appearance ?? '') || style !== (inf.look.style ?? '') || model !== (inf.look.imageModel ?? '') || ratio !== (inf.look.ratio ?? '3:4') ||
    level !== savedLevel;

  const persist = () => save({ look: { appearance, style, imageModel: model, ratio, contentLevel: level } });

  return (
    <div>
      <p className="section-hint" style={{ marginBottom: 12 }}>
        Describe how the persona looks, generate options on your GPU, and approve the one that fits. Refine and regenerate as
        many times as you like. The approved look's description and seed are reused for every future image.
      </p>
      <Field label="Appearance" hint="Concrete physical traits and signature style. No real people, nothing that reads as under 21.">
        <textarea rows={4} value={appearance} onChange={(e) => setAppearance(e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label="Photo style">
          <input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Natural, candid phone photo, golden hour" />
        </Field>
        <Field label="Image model (local)">
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {meta.models.image.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.speed}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Aspect ratio">
          <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
            <option value="3:4">3:4 portrait (feeds)</option>
            <option value="9:16">9:16 vertical (stories, reels)</option>
            <option value="1:1">1:1 square</option>
            <option value="4:3">4:3 landscape</option>
          </select>
        </Field>
      </div>
      <Field
        label="Content"
        hint={
          level === 'explicit'
            ? `Adult nudity and sexual content between consenting adults. These projects never publish: posts stay as drafts you can download. Needs a persona aged 25+, every image is checked to make sure everyone clearly looks 21 or older, and youth-coded words (girl, young, petite…) are refused.`
            : level === 'implied'
              ? 'Scenes like a bubble bath or a towel after a shower, framed so nothing private shows; each image is checked. Instagram and Threads may show these to fewer people; Bluesky and Mastodon posts are marked sensitive.'
              : 'Every image is fully clothed.'
        }
      >
        <select value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
          <option value="sfw">Safe for work</option>
          <option value="implied">Tasteful implied nudity</option>
          <option value="explicit">Explicit (adult, never published)</option>
        </select>
      </Field>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button
          className="btn btn-primary"
          disabled={!!busy || !appearance.trim()}
          onClick={() =>
            run('generate', async () => {
              if (dirty) await persist();
              apply(await api.generateLooks(inf.id, 4));
            })
          }
        >
          {busy === 'generate' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Generate 4 options
        </button>
        {dirty && (
          <button className="btn" disabled={!!busy} onClick={() => run('save', persist)}>
            Save description
          </button>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <Field label="Not quite right? Say what to change" hint="Rewrites the appearance; then generate again.">
          <div className="list-editor-row">
            <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="shorter hair, warmer smile, more outdoorsy clothes" />
            <button
              className="btn"
              disabled={!!busy || !feedback.trim()}
              onClick={() =>
                run('refine', async () => {
                  setAppearance(await api.refineLook(inf.id, feedback));
                  setFeedback('');
                })
              }
            >
              {busy === 'refine' ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Refine
            </button>
          </div>
        </Field>
      </div>

      <CandidateGrid
        rows={shown}
        busy={!!busy}
        onApprove={(r) => run('approve', async () => apply(await api.approveMedia(inf.id, r.id)))}
        onReject={(r) => run('reject', async () => apply(await api.rejectMedia(inf.id, r.id)))}
      />
      {!looks.length && <div className="field-hint">No options yet. Generating 4 takes a few minutes on the GPU box.</div>}
      {error && <Alert>{error}</Alert>}
      <StepNav
        onBack={back}
        onNext={() => run('next', async () => (dirty ? save({ look: { appearance, style, imageModel: model, ratio, contentLevel: level } }, true) : next()))}
        nextLabel={inf.look.approvedMediaId ? 'Continue with this look' : 'Approve a look to continue'}
        nextDisabled={!inf.look.approvedMediaId}
        busy={!!busy}
      />
    </div>
  );
}

// ── 4. Portfolio (visual) ──────────────────────────────────────────────────

export function StepPortfolio({ detail, meta, save, apply, back, next }: StepProps) {
  const inf = detail.influencer;
  const [themes, setThemes] = useState<string[]>(inf.plan.themes ?? []);
  const [count, setCount] = useState(6);
  const { busy, error, run } = useAction();
  const items = detail.media.filter((m) => m.role === 'portfolio');
  const clips = detail.media.filter((m) => m.role === 'clip');
  const approved = items.filter((m) => m.status === 'approved').length;
  const themesDirty = JSON.stringify(themes) !== JSON.stringify(inf.plan.themes ?? []);

  return (
    <div>
      <p className="section-hint" style={{ marginBottom: 12 }}>
        The portfolio is the persona's first set of posts and the reference for everything after. Approve at least{' '}
        {meta.rules.minPortfolio} images that look like the same person. Animate approved images into short clips with the local
        image-to-video model.
      </p>
      <Field label="Recurring themes" hint="Rotated through when the persona posts.">
        <ListEditor values={themes} onChange={setThemes} placeholder="morning trail run, camp breakfast, gear check…" />
      </Field>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0 16px', flexWrap: 'wrap' }}>
        <select value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 'auto' }}>
          {[3, 6, 9, 12].map((n) => (
            <option key={n} value={n}>
              {n} images
            </option>
          ))}
        </select>
        <button
          className="btn btn-primary"
          disabled={!!busy}
          onClick={() =>
            run('generate', async () => {
              if (themesDirty) await save({ plan: { themes } });
              apply(await api.generatePortfolio(inf.id, count));
            })
          }
        >
          {busy === 'generate' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Generate {count} more
        </button>
        <span className={approved >= meta.rules.minPortfolio ? 'badge badge-success' : 'badge'}>
          {approved} / {meta.rules.minPortfolio} approved
        </span>
      </div>
      <CandidateGrid
        rows={items}
        busy={!!busy}
        onApprove={(r) => run('approve', async () => apply(await api.approveMedia(inf.id, r.id)))}
        onReject={(r) => run('reject', async () => apply(await api.rejectMedia(inf.id, r.id)))}
        onAnimate={meta.models.video.length ? (r) => run('animate', async () => apply(await api.animateMedia(inf.id, r.id))) : undefined}
      />
      {clips.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 20 }}>Clips</div>
          <CandidateGrid
            rows={clips}
            busy={!!busy}
            onApprove={(r) => run('approve', async () => apply(await api.approveMedia(inf.id, r.id)))}
            onReject={(r) => run('reject', async () => apply(await api.rejectMedia(inf.id, r.id)))}
          />
        </>
      )}
      {error && <Alert>{error}</Alert>}
      <StepNav
        onBack={back}
        onNext={() => run('next', async () => (themesDirty ? save({ plan: { themes } }, true) : next()))}
        nextDisabled={approved < meta.rules.minPortfolio}
        nextLabel={approved < meta.rules.minPortfolio ? `Approve ${meta.rules.minPortfolio - approved} more` : 'Continue'}
        busy={!!busy}
      />
    </div>
  );
}

// ── 3. Topics & sources (text) ─────────────────────────────────────────────

function ResearchProvider({ meta, isAdmin, onSaved }: { meta: api.Meta; isAdmin: boolean; onSaved: () => void }) {
  const [url, setUrl] = useState(meta.research.searxngUrl ?? '');
  const [key, setKey] = useState('');
  const { busy, error, run } = useAction();
  if (meta.research.configured) {
    return (
      <Alert kind="info">
        Web search: {meta.research.searxngUrl ? `SearXNG at ${meta.research.searxngUrl}` : 'Brave Search API'}.
      </Alert>
    );
  }
  if (!isAdmin) return <Alert kind="warn">An admin needs to configure a web search provider before posts can be fact-checked.</Alert>;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-title">Web search provider</div>
      <div className="section-hint">
        Needed to research and verify every claim. SearXNG is open source and can run in your cluster; Brave Search is a
        hosted API.
      </div>
      <div className="form-grid">
        <Field label="SearXNG URL">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://searxng.searxng.svc:8080" />
        </Field>
        <Field label="or Brave Search API key">
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} />
        </Field>
      </div>
      {error && <Alert>{error}</Alert>}
      <button
        className="btn btn-primary"
        disabled={!!busy || (!url.trim() && !key.trim())}
        onClick={() =>
          run('save', async () => {
            await api.saveResearchSettings({ searxngUrl: url.trim() || null, ...(key.trim() ? { braveKey: key.trim() } : {}) });
            onSaved();
          })
        }
      >
        Save provider
      </button>
    </div>
  );
}

export function StepResearch({ detail, meta, save, back, isAdmin, refreshMeta }: StepProps & { refreshMeta: () => void }) {
  const inf = detail.influencer;
  const [r, setR] = useState<Research>(inf.research);
  const [showTrusted, setShowTrusted] = useState(false);
  const { busy, error, run } = useAction();
  const minSources = Math.max(r.political ? 2 : 1, r.minSources ?? 2);

  return (
    <div>
      <p className="section-hint" style={{ marginBottom: 12 }}>
        Every post is researched and fact-checked before anyone sees it: each factual claim must be backed by{' '}
        {minSources} independent trusted sources and contradicted by none, or the post is blocked.
      </p>
      <ResearchProvider meta={meta} isAdmin={isAdmin} onSaved={refreshMeta} />

      <Field label="Topics to cover">
        <ListEditor values={r.topics ?? []} onChange={(topics) => setR({ ...r, topics })} placeholder="housing policy, Supreme Court, climate…" />
      </Field>
      <label className="toggle" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={!!r.political} onChange={(e) => setR({ ...r, political: e.target.checked, minSources: Math.max(2, r.minSources ?? 2) })} />
        <span>
          <strong>Political or civic content.</strong> Stricter rules: at least two sources per claim, no @-mentions of people,
          and election dates, places or eligibility only from official government sources.
        </span>
      </label>

      <Field label="News feeds" hint="RSS/Atom feeds where the persona finds stories. Stories are matched to your topics.">
        <ListEditor values={r.feeds ?? []} onChange={(feeds) => setR({ ...r, feeds })} placeholder="https://…/rss.xml" />
      </Field>
      <div className="chips" style={{ marginBottom: 14 }}>
        {meta.suggestedFeeds
          .filter((f) => !(r.feeds ?? []).includes(f.url))
          .map((f) => (
            <button key={f.url} className="chip" onClick={() => setR({ ...r, feeds: [...(r.feeds ?? []), f.url] })}>
              + {f.label}
            </button>
          ))}
      </div>
      <label className="toggle" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={r.useBlueskyTrends !== false} onChange={(e) => setR({ ...r, useBlueskyTrends: e.target.checked })} />
        <span>
          <strong>Read what people are posting.</strong> Searches Bluesky for top posts on each topic to see what's being
          discussed. The persona responds to the topic, never to individual people.
        </span>
      </label>

      <div className="form-grid">
        <Field label="Sources required per claim">
          <select value={minSources} onChange={(e) => setR({ ...r, minSources: Number(e.target.value) })}>
            {[1, 2, 3, 4].filter((n) => !r.political || n >= 2).map((n) => (
              <option key={n} value={n}>
                {n} independent source{n > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Also trust these domains">
        <ListEditor values={r.trustedDomains ?? []} onChange={(trustedDomains) => setR({ ...r, trustedDomains })} placeholder="seattletimes.com" />
      </Field>
      <Field label="Never cite these domains">
        <ListEditor values={r.blockedDomains ?? []} onChange={(blockedDomains) => setR({ ...r, blockedDomains })} placeholder="example.com" />
      </Field>
      <button className="btn btn-sm" onClick={() => setShowTrusted((v) => !v)}>
        {showTrusted ? 'Hide' : 'Show'} the built-in trusted sources
      </button>
      {showTrusted && (
        <div className="field-hint" style={{ marginTop: 8 }}>
          {meta.defaultTrustedDomains.join(' · ')} · plus any .gov, .mil, .edu, .gov.uk and .int site.
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      <StepNav
        onBack={back}
        onNext={() => run('save', () => save({ research: { ...r, minSources } }, true))}
        nextDisabled={!(r.topics ?? []).length}
        busy={!!busy}
      />
    </div>
  );
}

// ── Posting plan ───────────────────────────────────────────────────────────

export function StepPlan({ detail, meta, save, back }: StepProps) {
  const inf = detail.influencer;
  const browserTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [plan, setPlan] = useState<api.Plan>({ ...inf.plan, timezone: inf.plan.timezone || browserTz });
  const { busy, error, run } = useAction();
  const platforms = meta.platforms.filter((p) => inf.kind === 'visual' ? p.media.image || p.media.video : p.media.textOnly);
  const toggle = <T,>(list: T[] | undefined, v: T) => ((list ?? []).includes(v) ? (list ?? []).filter((x) => x !== v) : [...(list ?? []), v]);

  return (
    <div>
      <Field label="Where to post">
        <div className="checklist">
          {platforms.map((p) => (
            <label key={p.id} className="toggle">
              <input type="checkbox" checked={(plan.platforms ?? []).includes(p.id)} onChange={() => setPlan({ ...plan, platforms: toggle(plan.platforms, p.id) })} />
              <span>
                <strong>{p.name}</strong>{' '}
                <span className={p.mode === 'api' ? 'badge badge-accent' : 'badge'}>{p.mode === 'api' ? 'posts automatically' : 'you post it'}</span>{' '}
                <span className="field-hint">up to {p.maxText} characters</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <div className="form-grid">
        <Field label="Posts per week" hint={`Capped at ${meta.rules.maxPostsPerDay} a day, at least ${meta.rules.minMinutesBetween} minutes apart.`}>
          <input type="number" min={1} max={meta.rules.maxPostsPerDay * 7} value={plan.postsPerWeek ?? ''} onChange={(e) => setPlan({ ...plan, postsPerWeek: Number(e.target.value) || undefined })} />
        </Field>
        <Field label="Time zone">
          <input value={plan.timezone ?? ''} onChange={(e) => setPlan({ ...plan, timezone: e.target.value })} />
        </Field>
        <Field label="From">
          <select value={plan.windowStart ?? 9} onChange={(e) => setPlan({ ...plan, windowStart: Number(e.target.value) })}>
            {HOURS.slice(0, 24).map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
          </select>
        </Field>
        <Field label="Until">
          <select value={plan.windowEnd ?? 20} onChange={(e) => setPlan({ ...plan, windowEnd: Number(e.target.value) })}>
            {HOURS.slice(1).map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Posting days">
        <div className="day-picker">
          {DAYS.map((d, i) => (
            <button key={d} className={(plan.days ?? []).includes(i) ? 'on' : ''} onClick={() => setPlan({ ...plan, days: toggle(plan.days, i).sort() })}>
              {d}
            </button>
          ))}
        </div>
      </Field>
      {inf.kind === 'visual' && meta.models.video.length > 0 && (
        <Field label={`Share of posts that are short clips: ${Math.round((plan.videoShare ?? 0) * 100)}%`} hint="Clips take much longer to render on the GPU.">
          <input type="range" min={0} max={0.5} step={0.05} value={plan.videoShare ?? 0} onChange={(e) => setPlan({ ...plan, videoShare: Number(e.target.value) })} />
        </Field>
      )}
      <label className="toggle card" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={!!plan.autoPublish} onChange={(e) => setPlan({ ...plan, autoPublish: e.target.checked })} />
        <span>
          <strong>Publish without my review.</strong> Posts that pass every check
          {inf.kind === 'text' ? ' (including the fact-check)' : ''} go out on their own. Posts that fail are always held,
          and you can still edit or reject anything in the queue. Off by default.
        </span>
      </label>
      <CheckList kind="warn" items={detail.checks.plan.issues} />
      {error && <Alert>{error}</Alert>}
      <StepNav onBack={back} onNext={() => run('save', () => save({ plan }, true))} busy={!!busy} />
    </div>
  );
}

// ── Accounts ───────────────────────────────────────────────────────────────

const MANUAL_REASON: Record<string, string> = {
  tiktok: 'TikTok keeps API posts private until it audits the app, so these are posted by hand.',
  x: "X charges for each post made through its API (about $0.20 with a link), so these are posted by hand.",
};

function AccountCard({
  inf,
  platform,
  account,
  publishing,
  apply,
}: {
  inf: api.Influencer;
  platform: api.PlatformDef;
  account?: api.AccountView;
  publishing: api.Meta['publishing'];
  apply: (d: api.Detail) => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>(account?.fields ?? {});
  const [checklist, setChecklist] = useState<Record<string, boolean>>(account?.checklist ?? {});
  const { busy, error, run } = useAction();
  useEffect(() => {
    setFields(account?.fields ?? {});
    setChecklist(account?.checklist ?? {});
  }, [account?.updatedAt]);

  return (
    <div className="card platform-card">
      <div className="platform-head">
        <div className="section-title" style={{ margin: 0 }}>
          {platform.name} <span className={platform.mode === 'api' ? 'badge badge-accent' : 'badge'}>{platform.mode === 'api' ? 'API' : 'manual'}</span>
        </div>
        {account ? statusBadge(account.status) : statusBadge('not set up')}
      </div>
      <div className="field-hint" style={{ marginBottom: 8 }}>{platform.aiRule}</div>
      {platform.mode === 'manual' && (
        <div className="field-hint" style={{ marginBottom: 8 }}>
          DeadChat prepares each post for {platform.name}; you publish it there and mark it as posted.{' '}
          {MANUAL_REASON[platform.id] ?? ''}
        </div>
      )}
      {platform.needsPublicUrl && !publishing.publicUrlConfigured && (
        <Alert kind="warn">
          {platform.name} downloads images and videos from DeadChat. Set PUBLIC_URL on the server to DeadChat's public https address.
        </Alert>
      )}
      {platform.connect === 'google' && (
        <div className="field-hint" style={{ marginBottom: 8 }}>
          Authorised redirect URI for the OAuth client:{' '}
          {publishing.youtubeRedirectUri ? <code style={{ userSelect: 'all', overflowWrap: 'anywhere' }}>{publishing.youtubeRedirectUri}</code> : 'set PUBLIC_URL on the server first'}
          . Google may warn that the app is unverified; since it's your own app, choose Advanced → Continue.
        </div>
      )}
      <div className="checklist">
        {platform.checklist.map((c) => (
          <label key={c.id} className="toggle">
            <input type="checkbox" checked={!!checklist[c.id]} onChange={(e) => setChecklist({ ...checklist, [c.id]: e.target.checked })} />
            <span>
              {c.label}
              {c.id === 'bio-disclosure' && inf.persona.disclosure ? ` ("${inf.persona.disclosure}")` : ''}
              {c.link && (
                <>
                  {' '}
                  <a href={c.link} target="_blank" rel="noreferrer">
                    <ExternalLink size={11} />
                  </a>
                </>
              )}
              {!c.required && <span className="field-hint"> (optional)</span>}
            </span>
          </label>
        ))}
      </div>
      <div className="form-grid">
        {platform.fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <input
              type={f.secret ? 'password' : 'text'}
              value={fields[f.key] ?? ''}
              placeholder={f.placeholder}
              onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      {account?.lastError && <Alert>{account.lastError}</Alert>}
      {error && <Alert>{error}</Alert>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={!!busy} onClick={() => run('save', async () => apply(await api.saveAccount(inf.id, platform.id, fields, checklist)))}>
          {busy === 'save' ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Save
        </button>
        {platform.connect === 'google' && account && (
          <button
            className="btn"
            disabled={!!busy || !publishing.youtubeRedirectUri}
            onClick={() =>
              run('connect', async () => {
                const { url } = await api.connectYouTube(inf.id);
                window.location.assign(url);
              })
            }
          >
            {busy === 'connect' ? <Loader2 size={14} className="spin" /> : <ExternalLink size={14} />}{' '}
            {account.status === 'connected' ? 'Reconnect Google' : 'Connect with Google'}
          </button>
        )}
        {platform.mode === 'api' && account && (
          <button className="btn" disabled={!!busy} onClick={() => run('test', async () => apply(await api.testAccount(inf.id, platform.id)))}>
            {busy === 'test' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Test connection
          </button>
        )}
      </div>
    </div>
  );
}

export function StepAccounts({ detail, meta, apply, back, next }: StepProps) {
  const inf = detail.influencer;
  const chosen = meta.platforms.filter((p) => (inf.plan.platforms ?? []).includes(p.id));
  // Back from Google's consent screen: /social/:id/accounts?connected=youtube or ?error=…
  const [oauth] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return { connected: q.get('connected'), error: q.get('error') };
  });
  useEffect(() => {
    if (oauth.connected || oauth.error) window.history.replaceState(null, '', window.location.pathname);
  }, [oauth]);
  return (
    <div>
      {oauth.connected && <Alert kind="info">{meta.platforms.find((p) => p.id === oauth.connected)?.name ?? oauth.connected} is connected.</Alert>}
      {oauth.error && <Alert>{oauth.error}</Alert>}
      <p className="section-hint" style={{ marginBottom: 12 }}>
        Create a dedicated account per platform for this persona, turn on that platform's AI labelling, and connect it. Keys
        and passwords are stored encrypted and never shown again.
      </p>
      {chosen.length === 0 && <Alert kind="warn">Pick platforms on the posting plan step first.</Alert>}
      {chosen.map((p) => (
        <AccountCard
          key={p.id}
          inf={inf}
          platform={p}
          account={detail.accounts.find((a) => a.platform === p.id)}
          publishing={meta.publishing}
          apply={apply}
        />
      ))}
      <StepNav onBack={back} onNext={next} nextLabel="Continue" />
    </div>
  );
}

// ── Review & launch ────────────────────────────────────────────────────────

export function StepLaunch({ detail, apply, back }: StepProps) {
  const inf = detail.influencer;
  const [topic, setTopic] = useState('');
  const { busy, error, run } = useAction();
  const launch = detail.checks.launch;
  const canCreate = detail.checks.persona.passed && (inf.kind === 'text' || !!inf.look.approvedMediaId);
  const createHint = !detail.checks.persona.passed ? 'Finish the persona first' : 'Approve a look first';
  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="platform-head">
          <div className="section-title" style={{ margin: 0 }}>Status</div>
          {statusBadge(inf.status)}
        </div>
        {launch.passed ? (
          <div className="field-hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <CheckCircle2 size={14} color="#4ade80" /> Everything is set. {inf.plan.postsPerWeek} posts a week on{' '}
            {(inf.plan.platforms ?? []).join(', ')}, {inf.plan.autoPublish ? 'published automatically when they pass every check' : 'each waiting for your approval'}.
          </div>
        ) : (
          <CheckList kind="warn" title="Before launch:" items={launch.issues} />
        )}
        <CheckList kind="info" items={launch.warnings} />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {inf.status !== 'active' ? (
            <button className="btn btn-primary" disabled={!launch.passed || !!busy} onClick={() => run('activate', async () => apply(await api.activate(inf.id)))}>
              Start posting
            </button>
          ) : (
            <button className="btn" disabled={!!busy} onClick={() => run('pause', async () => apply(await api.pause(inf.id)))}>
              Pause
            </button>
          )}
        </div>
        {inf.status === 'active' && detail.nextWindow && (
          <div className="field-hint" style={{ marginTop: 8 }}>Next posting window: {new Date(detail.nextWindow).toLocaleString()}</div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Create a post now</div>
        <div className="section-hint">
          {inf.kind === 'text'
            ? 'Finds a story on your topics (or the one you name), researches it, drafts a post and fact-checks every claim.'
            : 'Picks a theme (or the one you name), renders an image of the approved look and writes the caption.'}{' '}
          It lands in the queue below for review.
          {!canCreate && <> {createHint}.</>}
        </div>
        <div className="list-editor-row">
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={inf.kind === 'text' ? 'Optional: a specific story' : 'Optional: a theme'} />
          <button className="btn btn-primary" disabled={!!busy || !!detail.working || !canCreate} title={canCreate ? undefined : createHint} onClick={() => run('generate', async () => apply(await api.generatePost(inf.id, topic || undefined)))}>
            {detail.working ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {detail.working ? 'Working…' : 'Create post'}
          </button>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      <PostsPanel detail={detail} apply={apply} />
      <StepNav onBack={back} />
    </div>
  );
}
