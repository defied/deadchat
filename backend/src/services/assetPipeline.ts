// Generic draft->approve creative-asset pipeline. Wraps the existing `jobs`
// execution engine (jobQueue.ts) rather than replacing it: every draft,
// revision, or final generation attempt is one `jobs` row underneath one
// `creative_assets` row, which tracks the lifecycle of the thing being made.

import db from '../db/connection';
import * as jobQueue from './jobQueue';
import { getHandler } from './assetTypes/registry';
import type { CreativeAsset, AssetRevision, DurationEstimate, Job } from '../types/models';

const EMA_WINDOW = 20;

export interface CreateAssetOptions {
  userId?: number;
  name?: string;
}

export function getAsset(id: number): CreativeAsset | null {
  return db.prepare('SELECT * FROM creative_assets WHERE id = ?').get(id) as CreativeAsset | null;
}

export function listAssets(userId: number, limit = 50): CreativeAsset[] {
  return db.prepare(
    'SELECT * FROM creative_assets WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, limit) as CreativeAsset[];
}

export function listRevisions(assetId: number): AssetRevision[] {
  return db.prepare(
    'SELECT * FROM asset_revisions WHERE asset_id = ? ORDER BY created_at DESC'
  ).all(assetId) as AssetRevision[];
}

function requireAsset(id: number): CreativeAsset {
  const asset = getAsset(id);
  if (!asset) throw new Error(`Asset ${id} not found`);
  return asset;
}

function patchAsset(id: number, patch: Record<string, unknown>): CreativeAsset {
  const keys = Object.keys(patch);
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE creative_assets SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map((k) => patch[k]), id);
  return requireAsset(id);
}

export function createAsset(
  assetType: string,
  input: Record<string, unknown>,
  opts: CreateAssetOptions = {}
): CreativeAsset {
  const handler = getHandler(assetType);
  const draftParams = handler.buildDraftParams(input);
  const qualityTier = handler.qualityTier('draft', draftParams);

  const result = db.prepare(`
    INSERT INTO creative_assets (user_id, asset_type, name, stage, quality_tier, params)
    VALUES (?, ?, ?, 'draft_queued', ?, ?)
  `).run(opts.userId ?? null, assetType, opts.name ?? null, qualityTier, JSON.stringify(draftParams));
  const assetId = result.lastInsertRowid as number;

  const jobId = jobQueue.enqueue(handler.capability, draftParams, {
    userId: opts.userId,
    heavy: true,
    assetId,
    assetStage: 'draft',
  });

  return patchAsset(assetId, { latest_job_id: jobId });
}

// Called by worker.ts right after claimNext() hands back a job with asset_id set,
// before processJob() runs it - flips draft_queued/final_queued -> *_running.
export function onJobStarted(job: Job): void {
  if (job.asset_id == null) return;
  const asset = getAsset(job.asset_id);
  if (!asset) return;
  if (job.asset_stage === 'draft' && asset.stage === 'draft_queued') {
    patchAsset(asset.id, { stage: 'draft_running' });
  } else if (job.asset_stage === 'final' && asset.stage === 'final_queued') {
    patchAsset(asset.id, { stage: 'final_running' });
  }
}

// Called by worker.ts after a media job with asset_id set reaches a terminal state.
export function onJobFinished(jobId: number): void {
  const job = jobQueue.getJob(jobId);
  if (!job || job.asset_id == null) return;
  const asset = getAsset(job.asset_id);
  if (!asset) return;

  const stage = job.asset_stage as 'draft' | 'final' | null;

  if (job.status === 'succeeded') {
    const result = job.result ? (JSON.parse(job.result) as { media_ids?: number[] }) : {};
    const mediaId = result.media_ids?.[0] ?? null;

    recordDuration(asset, job, stage);

    if (stage === 'final') {
      patchAsset(asset.id, { stage: 'final_ready', final_media_id: mediaId, latest_job_id: job.id });
    } else {
      patchAsset(asset.id, { stage: 'awaiting_review', draft_media_id: mediaId, latest_job_id: job.id });
    }
  } else {
    // failed or canceled
    patchAsset(asset.id, {
      stage: 'failed',
      error: job.error ?? 'Job canceled',
      latest_job_id: job.id,
    });
  }
}

function recordDuration(asset: CreativeAsset, job: Job, stage: 'draft' | 'final' | null): void {
  if (!job.started_at || !job.finished_at || !stage) return;
  const elapsedS = (Date.parse(`${job.finished_at}Z`) - Date.parse(`${job.started_at}Z`)) / 1000;
  if (!(elapsedS > 0)) return;

  const handler = getHandler(asset.asset_type);
  const params = job.params ? (JSON.parse(job.params) as Record<string, unknown>) : {};
  const bucketKey = `${asset.asset_type}:${handler.qualityTier(stage, params)}`;
  updateDurationEstimate(bucketKey, elapsedS);
}

function updateDurationEstimate(bucketKey: string, elapsedS: number): void {
  const existing = db.prepare(
    'SELECT * FROM duration_estimates WHERE bucket_key = ?'
  ).get(bucketKey) as DurationEstimate | undefined;

  if (!existing) {
    db.prepare(`
      INSERT INTO duration_estimates (bucket_key, sample_count, avg_duration_s, last_duration_s)
      VALUES (?, 1, ?, ?)
    `).run(bucketKey, elapsedS, elapsedS);
    return;
  }

  const newCount = Math.min((existing.sample_count ?? 0) + 1, EMA_WINDOW);
  const prevAvg = existing.avg_duration_s ?? elapsedS;
  const newAvg = prevAvg + (elapsedS - prevAvg) / newCount;

  db.prepare(`
    UPDATE duration_estimates
    SET sample_count = sample_count + 1, avg_duration_s = ?, last_duration_s = ?, updated_at = datetime('now')
    WHERE bucket_key = ?
  `).run(newAvg, elapsedS, bucketKey);
}

export async function requestRevision(assetId: number, userId: number | undefined, note: string): Promise<CreativeAsset> {
  const asset = requireAsset(assetId);
  if (asset.stage !== 'awaiting_review' && asset.stage !== 'failed') {
    throw new Error(`Cannot request a revision from stage "${asset.stage}"`);
  }

  const handler = getHandler(asset.asset_type);
  const paramsBefore = asset.params;
  const currentParams = JSON.parse(asset.params) as Record<string, unknown>;
  const newParams = await handler.applyRevision(currentParams, note);
  const qualityTier = handler.qualityTier('draft', newParams);

  const revisionResult = db.prepare(`
    INSERT INTO asset_revisions (asset_id, note, params_before, created_by)
    VALUES (?, ?, ?, ?)
  `).run(assetId, note, paramsBefore, userId ?? null);
  const revisionId = revisionResult.lastInsertRowid as number;

  const jobId = jobQueue.enqueue(handler.capability, newParams, {
    userId,
    heavy: true,
    assetId,
    assetStage: 'draft',
  });

  db.prepare('UPDATE asset_revisions SET params_after = ?, job_id = ? WHERE id = ?')
    .run(JSON.stringify(newParams), jobId, revisionId);

  return patchAsset(assetId, {
    stage: 'draft_queued',
    params: JSON.stringify(newParams),
    quality_tier: qualityTier,
    latest_job_id: jobId,
    error: null,
  });
}

export function approve(assetId: number, opts: { holdFinal?: boolean } = {}): CreativeAsset {
  const asset = requireAsset(assetId);
  if (asset.stage !== 'awaiting_review') {
    throw new Error(`Cannot approve from stage "${asset.stage}"`);
  }
  const approved = patchAsset(assetId, { stage: 'approved' });
  if (opts.holdFinal) return approved;
  return requestFinal(assetId);
}

export function requestFinal(assetId: number): CreativeAsset {
  const asset = requireAsset(assetId);
  if (asset.stage !== 'approved') {
    throw new Error(`Cannot render final from stage "${asset.stage}"`);
  }

  const handler = getHandler(asset.asset_type);
  const approvedParams = JSON.parse(asset.params) as Record<string, unknown>;
  const finalParams = handler.buildFinalParams(approvedParams);
  const qualityTier = handler.qualityTier('final', finalParams);

  const jobId = jobQueue.enqueue(handler.capability, finalParams, {
    userId: asset.user_id ?? undefined,
    heavy: true,
    assetId,
    assetStage: 'final',
  });

  return patchAsset(assetId, {
    stage: 'final_queued',
    params: JSON.stringify(finalParams),
    quality_tier: qualityTier,
    latest_job_id: jobId,
  });
}

export function cancelAsset(assetId: number): CreativeAsset {
  const asset = requireAsset(assetId);
  if (asset.latest_job_id != null) jobQueue.cancel(asset.latest_job_id);
  return patchAsset(assetId, { stage: 'canceled' });
}

export interface AssetEstimate {
  stage: 'draft' | 'final' | null;
  estimated_total_s: number | null;
  elapsed_s: number;
  remaining_s: number | null;
  progress_pct: number;
  sample_count: number;
}

export function getEstimate(assetId: number): AssetEstimate {
  const asset = requireAsset(assetId);
  const job = asset.latest_job_id != null ? jobQueue.getJob(asset.latest_job_id) : null;

  const stage: 'draft' | 'final' | null =
    asset.stage === 'draft_queued' || asset.stage === 'draft_running' ? 'draft'
      : asset.stage === 'final_queued' || asset.stage === 'final_running' ? 'final'
        : null;

  let estimatedTotalS: number | null = null;
  let sampleCount = 0;
  if (stage) {
    const handler = getHandler(asset.asset_type);
    const params = JSON.parse(asset.params) as Record<string, unknown>;
    const bucketKey = `${asset.asset_type}:${handler.qualityTier(stage, params)}`;
    const estimate = db.prepare(
      'SELECT * FROM duration_estimates WHERE bucket_key = ?'
    ).get(bucketKey) as DurationEstimate | undefined;
    estimatedTotalS = estimate?.avg_duration_s ?? null;
    sampleCount = estimate?.sample_count ?? 0;
  }

  const elapsedS = stage && job?.started_at
    ? Math.max(0, (Date.now() - Date.parse(`${job.started_at}Z`)) / 1000)
    : 0;

  let remainingS: number | null = null;
  if (estimatedTotalS != null) {
    remainingS = job && job.progress > 0
      ? Math.max(0, estimatedTotalS * (1 - job.progress))
      : Math.max(0, estimatedTotalS - elapsedS);
  }

  return {
    stage,
    estimated_total_s: estimatedTotalS,
    elapsed_s: elapsedS,
    remaining_s: remainingS,
    progress_pct: job ? Math.round(job.progress * 100) : 0,
    sample_count: sampleCount,
  };
}
