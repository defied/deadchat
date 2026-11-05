// Review queue: generated posts with their fact-check, policy review and
// publishing results.

import { useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, HelpCircle, Loader2, Send, XCircle } from 'lucide-react';
import * as api from '../../api/influencers';
import type { Detail, Post } from '../../api/influencers';
import { fetchMediaBlobUrl } from '../../api/media';
import { Alert } from '../ui';
import { AuthedMedia, CheckList, statusBadge, useAction } from './shared';

const FILTERS: Array<{ id: string; label: string; match: (p: Post) => boolean }> = [
  { id: 'review', label: 'Needs review', match: (p) => p.status === 'review' },
  { id: 'approved', label: 'Approved', match: (p) => p.status === 'approved' || p.status === 'publishing' },
  { id: 'published', label: 'Published', match: (p) => p.status === 'published' },
  { id: 'held', label: 'Blocked & failed', match: (p) => p.status === 'blocked' || p.status === 'failed' },
  { id: 'all', label: 'All', match: () => true },
];

async function download(mediaId: number) {
  const url = await fetchMediaBlobUrl(mediaId);
  const a = document.createElement('a');
  a.href = url;
  a.download = `post-media-${mediaId}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function PostCard({ detail, post, apply }: { detail: Detail; post: Post; apply: (d: Detail) => void }) {
  const inf = detail.influencer;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(post.text);
  const [postedUrl, setPostedUrl] = useState('');
  const { busy, error, run } = useAction();
  const manualPlatforms = (inf.plan.platforms ?? []).filter((p) => {
    const acct = detail.accounts.find((a) => a.platform === p);
    return acct?.status === 'manual' && !post.results[p]?.ok;
  });
  const stale = inf.kind === 'text' && post.text !== post.checkedText;
  const canApprove = ['review', 'failed'].includes(post.status) && !stale && (inf.kind !== 'text' || !!post.factCheck?.passed);

  return (
    <div className="card post-card">
      <div className="post-head">
        {statusBadge(post.status)}
        <span>{post.origin === 'auto' ? 'automatic' : 'manual'}</span>
        <span>· {new Date(post.createdAt.replace(' ', 'T') + 'Z').toLocaleString()}</span>
        {post.topic && <span>· {post.topic}</span>}
        {post.scheduledFor && post.status === 'approved' && <span>· goes out {new Date(post.scheduledFor).toLocaleString()}</span>}
      </div>

      <div className={`post-body${post.mediaIds.length ? ' has-media' : ''}`}>
        {post.mediaIds.length > 0 && (
          <div className="post-media">
            <AuthedMedia mediaId={post.mediaIds[0]} />
          </div>
        )}
        <div>
          {editing ? (
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          ) : (
            <div className="post-text">{post.text || <span className="field-hint">(no text)</span>}</div>
          )}

          {post.error && <Alert kind={post.status === 'blocked' || post.status === 'failed' ? 'error' : 'warn'}>{post.error}</Alert>}

          {post.factCheck && (
            <div style={{ marginTop: 8 }}>
              <div className="field-label">
                Fact-check {post.factCheck.passed ? 'passed' : 'failed'} · {post.factCheck.minSources} sources per claim
              </div>
              <ul className="claim-list">
                {post.factCheck.claims.map((c) => (
                  <li key={c.claim}>
                    {c.verdict === 'supported' ? (
                      <CheckCircle2 size={14} color="#4ade80" />
                    ) : c.verdict === 'contradicted' ? (
                      <XCircle size={14} color="#f87171" />
                    ) : (
                      <HelpCircle size={14} color="#fbbf24" />
                    )}
                    <span>
                      {c.claim}{' '}
                      <span className="field-hint">
                        {c.supportingDomains.length ? `(${c.supportingDomains.join(', ')})` : ''} {c.note ?? ''}
                      </span>
                    </span>
                  </li>
                ))}
                {post.factCheck.claims.length === 0 && <li className="field-hint">No factual claims; opinion only.</li>}
              </ul>
            </div>
          )}

          {post.sources.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="field-label">Sources</div>
              <div className="chips">
                {post.sources.map((s) => (
                  <a key={s.url} className="chip" href={s.url} target="_blank" rel="noreferrer" title={s.title}>
                    {s.domain} <ExternalLink size={11} />
                  </a>
                ))}
              </div>
            </div>
          )}

          {post.compliance && <CheckList kind="error" title="Rules & policy review:" items={post.compliance.issues} />}
          {post.compliance && <CheckList kind="info" items={post.compliance.warnings} />}
          {stale && <Alert kind="warn">Edited after the fact-check. Re-check before approving.</Alert>}

          {Object.entries(post.results).length > 0 && (
            <div className="chips" style={{ marginTop: 8 }}>
              {Object.entries(post.results).map(([platform, r]) =>
                r.ok ? (
                  r.url ? (
                    <a key={platform} className="chip" href={r.url} target="_blank" rel="noreferrer">
                      <CheckCircle2 size={12} /> {platform} <ExternalLink size={11} />
                    </a>
                  ) : (
                    <span key={platform} className="chip"><CheckCircle2 size={12} /> {platform}</span>
                  )
                ) : (
                  <span key={platform} className="chip" title={r.error}><XCircle size={12} /> {platform}: {r.error}</span>
                ),
              )}
            </div>
          )}

          {error && <Alert>{error}</Alert>}

          <div className="post-actions">
            {editing ? (
              <>
                <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => run('save', async () => { apply(await api.editPost(inf.id, post.id, text)); setEditing(false); })}>
                  Save
                </button>
                <button className="btn btn-sm" onClick={() => { setEditing(false); setText(post.text); }}>Cancel</button>
              </>
            ) : (
              <>
                {canApprove && (
                  <>
                    <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => run('approve', async () => apply(await api.approvePost(inf.id, post.id)))}>
                      Approve
                    </button>
                    {inf.status === 'active' && (
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => run('now', async () => apply(await api.approvePost(inf.id, post.id, true)))}>
                        {busy === 'now' ? <Loader2 size={13} className="spin" /> : <Send size={13} />} Publish now
                      </button>
                    )}
                  </>
                )}
                {['review', 'blocked', 'failed'].includes(post.status) && (
                  <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
                )}
                {inf.kind === 'text' && ['review', 'blocked'].includes(post.status) && post.sources.length > 0 && (
                  <button className="btn btn-sm" disabled={!!busy || !!detail.working} onClick={() => run('recheck', async () => apply(await api.recheckPost(inf.id, post.id)))}>
                    Re-check
                  </button>
                )}
                {['review', 'approved', 'blocked', 'failed'].includes(post.status) && (
                  <button className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => run('reject', async () => apply(await api.rejectPost(inf.id, post.id)))}>
                    Reject
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(post.text)} title="Copy text">
                  <Copy size={13} /> Copy
                </button>
                {post.mediaIds.map((id, i) => (
                  <button key={id} className="btn btn-sm" onClick={() => download(id)}>
                    Download {post.mediaIds.length > 1 ? `media ${i + 1}` : 'media'}
                  </button>
                ))}
              </>
            )}
          </div>

          {post.status === 'approved' && manualPlatforms.length > 0 && (
            <div className="list-editor-row" style={{ marginTop: 10 }}>
              <input value={postedUrl} onChange={(e) => setPostedUrl(e.target.value)} placeholder="Link to the published post (optional)" />
              {manualPlatforms.map((p) => (
                <button key={p} className="btn btn-sm" disabled={!!busy} onClick={() => run('mark', async () => { apply(await api.markPosted(inf.id, post.id, p, postedUrl || undefined)); setPostedUrl(''); })}>
                  Posted on {p}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PostsPanel({ detail, apply }: { detail: Detail; apply: (d: Detail) => void }) {
  const [filter, setFilter] = useState(() => (detail.posts.some((p) => p.status === 'review') ? 'review' : 'all'));
  const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[4];
  const posts = detail.posts.filter(f.match);
  return (
    <div>
      <div className="section-title">Posts</div>
      {detail.working && (
        <Alert kind="info">
          <Loader2 size={13} className="spin" /> {detail.working}…
        </Alert>
      )}
      <div className="seg" style={{ margin: '8px 0 12px', flexWrap: 'wrap' }}>
        {FILTERS.map((x) => (
          <button key={x.id} className={x.id === filter ? 'on' : ''} onClick={() => setFilter(x.id)}>
            {x.label} ({detail.posts.filter(x.match).length})
          </button>
        ))}
      </div>
      {posts.length === 0 && <div className="field-hint">Nothing here yet.</div>}
      {posts.map((p) => (
        <PostCard key={`${p.id}-${p.status}-${p.text.length}`} detail={detail} post={p} apply={apply} />
      ))}
    </div>
  );
}
