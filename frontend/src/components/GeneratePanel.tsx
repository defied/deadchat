import { useState, useEffect, useCallback } from 'react';
import { Image, Film, Loader, CheckCircle, XCircle, RefreshCw, AlertCircle } from 'lucide-react';
import { generateImage, generateVideo, pollJob, listJobs, type Job } from '../api/jobs';
import { listMedia, fetchMediaBlobUrl, type MediaItem } from '../api/media';
import { MediaImage } from './MediaImage';

type Tab = 'generate' | 'gallery';
type GenType = 'image' | 'video';

interface ActiveJob {
  id: number;
  type: GenType;
  status: Job['status'];
  progress: number;
  mediaId?: number;
  error?: string;
}

function StatusIcon({ status }: { status: Job['status'] }) {
  if (status === 'succeeded') return <CheckCircle size={14} color="var(--color-success, #22c55e)" />;
  if (status === 'failed') return <XCircle size={14} color="var(--color-error, #ef4444)" />;
  if (status === 'canceled') return <XCircle size={14} color="var(--color-text-dim)" />;
  return <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />;
}

export function GeneratePanel() {
  const [tab, setTab] = useState<Tab>('generate');
  const [genType, setGenType] = useState<GenType>('image');
  const [prompt, setPrompt] = useState('');
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [submitting, setSubmitting] = useState(false);
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [gallery, setGallery] = useState<MediaItem[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGallery = useCallback(async () => {
    setGalleryLoading(true);
    try {
      const items = await listMedia({ limit: 50 });
      setGallery(items);
    } catch {
      // silently ignore
    } finally {
      setGalleryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'gallery') loadGallery();
  }, [tab, loadGallery]);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const resp = genType === 'image'
        ? await generateImage({ prompt: prompt.trim(), width, height })
        : await generateVideo({ prompt: prompt.trim(), width, height });

      const jobEntry: ActiveJob = {
        id: resp.job_id,
        type: genType,
        status: 'queued',
        progress: 0,
      };
      setActiveJobs((prev) => [jobEntry, ...prev]);
      setPrompt('');

      // Poll in background
      pollJob(resp.job_id).then((finalJob) => {
        setActiveJobs((prev) =>
          prev.map((j) => {
            if (j.id !== resp.job_id) return j;
            let mediaId: number | undefined;
            try {
              const result = finalJob.result ? JSON.parse(finalJob.result) : null;
              if (result?.media_ids?.[0]) mediaId = result.media_ids[0];
              else if (result?.media_id) mediaId = result.media_id;
            } catch {}
            return { ...j, status: finalJob.status, progress: 100, mediaId, error: finalJob.error ?? undefined };
          })
        );
        if (finalJob.status === 'succeeded') loadGallery();
      }).catch((e: any) => {
        setActiveJobs((prev) =>
          prev.map((j) => j.id !== resp.job_id ? j : { ...j, status: 'failed', error: e?.message || 'Poll error' })
        );
      });
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Failed to submit job');
    } finally {
      setSubmitting(false);
    }
  };

  const tabStyle = (t: Tab) => ({
    padding: '8px 18px',
    borderRadius: 'var(--radius)',
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    background: tab === t ? 'var(--color-accent-dim)' : 'transparent',
    color: tab === t ? 'var(--color-accent-light)' : 'var(--color-text-secondary)',
  } as React.CSSProperties);

  const typeBtn = (t: GenType) => ({
    flex: 1,
    padding: '10px',
    borderRadius: 'var(--radius)',
    border: `1px solid ${genType === t ? 'var(--color-accent)' : 'var(--color-border)'}`,
    background: genType === t ? 'var(--color-accent-dim)' : 'var(--color-surface)',
    color: genType === t ? 'var(--color-accent-light)' : 'var(--color-text-secondary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontSize: 13,
    fontWeight: 500,
  } as React.CSSProperties);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '20px 24px', gap: 16 }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)', paddingBottom: 12 }}>
        <button style={tabStyle('generate')} onClick={() => setTab('generate')}>Generate</button>
        <button style={tabStyle('gallery')} onClick={() => setTab('gallery')}>Gallery</button>
      </div>

      {tab === 'generate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflowY: 'auto' }}>
          {/* Type selector */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={typeBtn('image')} onClick={() => setGenType('image')}>
              <Image size={16} /> Image
            </button>
            <button style={typeBtn('video')} onClick={() => setGenType('video')}>
              <Film size={16} /> Video
            </button>
          </div>

          {/* Prompt */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500 }}>Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder={`Describe the ${genType} you want to generate...`}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                color: 'var(--color-text)',
                padding: '10px 12px',
                fontSize: 13,
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: 1.5,
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) handleSubmit(); }}
            />
          </div>

          {/* Dimensions */}
          <div style={{ display: 'flex', gap: 12 }}>
            {(['width', 'height'] as const).map((dim) => (
              <div key={dim} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500, textTransform: 'capitalize' }}>{dim}</label>
                <input
                  type="number"
                  value={dim === 'width' ? width : height}
                  onChange={(e) => dim === 'width' ? setWidth(Number(e.target.value)) : setHeight(Number(e.target.value))}
                  step={64}
                  min={256}
                  max={2048}
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    color: 'var(--color-text)',
                    padding: '8px 10px',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
              </div>
            ))}
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-error, #ef4444)', fontSize: 13 }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || !prompt.trim()}
            style={{
              padding: '10px 20px',
              background: 'var(--color-accent)',
              border: 'none',
              borderRadius: 'var(--radius)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: submitting || !prompt.trim() ? 'not-allowed' : 'pointer',
              opacity: submitting || !prompt.trim() ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {submitting && <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            {submitting ? 'Queuing...' : `Generate ${genType === 'image' ? 'Image' : 'Video'}`}
          </button>

          {/* Active jobs */}
          {activeJobs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-dim)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Jobs</div>
              {activeJobs.map((job) => (
                <div
                  key={job.id}
                  style={{
                    padding: '10px 12px',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusIcon status={job.status} />
                    <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', flex: 1 }}>
                      {job.type} #{job.id}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-dim)', textTransform: 'capitalize' }}>{job.status}</span>
                  </div>
                  {(job.status === 'queued' || job.status === 'running') && (
                    <div style={{ height: 3, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: job.status === 'running' ? `${job.progress || 10}%` : '5%',
                          background: 'var(--color-accent)',
                          borderRadius: 2,
                          transition: 'width 0.5s ease',
                          animation: job.status === 'queued' ? 'pulse 1.5s infinite' : undefined,
                        }}
                      />
                    </div>
                  )}
                  {job.status === 'failed' && job.error && (
                    <div style={{ fontSize: 12, color: 'var(--color-error, #ef4444)' }}>{job.error}</div>
                  )}
                  {job.status === 'succeeded' && job.mediaId && (
                    <MediaImage mediaId={job.mediaId} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'gallery' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {gallery.length} item{gallery.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={loadGallery}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)', color: 'var(--color-text-secondary)',
                cursor: 'pointer', fontSize: 12,
              }}
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          {galleryLoading && (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-dim)' }}>
              <Loader size={20} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          )}

          {!galleryLoading && gallery.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-dim)', fontSize: 14 }}>
              No media yet. Generate something first!
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 10,
            }}
          >
            {gallery.map((item) => (
              <div
                key={item.id}
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div style={{ aspectRatio: '1/1', overflow: 'hidden', background: '#1e1e2e' }}>
                  {item.type === 'image' ? (
                    <MediaImage mediaId={item.id} alt={item.prompt ?? 'Generated image'} />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-dim)' }}>
                      <Film size={32} />
                    </div>
                  )}
                </div>
                <div style={{ padding: '6px 8px' }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.prompt || item.filename}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-dim)', marginTop: 2 }}>
                    {new Date(item.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
