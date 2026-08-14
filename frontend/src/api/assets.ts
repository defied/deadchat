import client from './client';

export type AssetStage =
  | 'draft_queued' | 'draft_running' | 'awaiting_review' | 'revision_requested'
  | 'approved' | 'final_queued' | 'final_running' | 'final_ready' | 'failed' | 'canceled';

export interface CreativeAsset {
  id: number;
  user_id: number | null;
  asset_type: string;
  name: string | null;
  stage: AssetStage;
  quality_tier: string | null;
  params: string;
  draft_media_id: number | null;
  final_media_id: number | null;
  parent_asset_id: number | null;
  latest_job_id: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetRevision {
  id: number;
  asset_id: number;
  job_id: number | null;
  note: string;
  params_before: string;
  params_after: string | null;
  created_by: number | null;
  created_at: string;
}

export interface AssetDetail extends CreativeAsset {
  revisions: AssetRevision[];
}

export interface AssetEstimate {
  stage: 'draft' | 'final' | null;
  estimated_total_s: number | null;
  elapsed_s: number;
  remaining_s: number | null;
  progress_pct: number;
  sample_count: number;
}

export async function listAssetTypes(): Promise<string[]> {
  const { data } = await client.get<{ types: string[] }>('/api/assets/types');
  return data.types;
}

export async function listAssets(limit = 50): Promise<CreativeAsset[]> {
  const { data } = await client.get<CreativeAsset[]>('/api/assets', { params: { limit } });
  return data;
}

export async function getAsset(id: number): Promise<AssetDetail> {
  const { data } = await client.get<AssetDetail>(`/api/assets/${id}`);
  return data;
}

export async function getAssetEstimate(id: number): Promise<AssetEstimate> {
  const { data } = await client.get<AssetEstimate>(`/api/assets/${id}/estimate`);
  return data;
}

export async function createAsset(
  assetType: string,
  input: Record<string, unknown>,
  name?: string
): Promise<CreativeAsset> {
  const { data } = await client.post<CreativeAsset>('/api/assets', { asset_type: assetType, name, input });
  return data;
}

export async function reviseAsset(id: number, note: string): Promise<CreativeAsset> {
  const { data } = await client.post<CreativeAsset>(`/api/assets/${id}/revise`, { note });
  return data;
}

export async function approveAsset(id: number, holdFinal?: boolean): Promise<CreativeAsset> {
  const { data } = await client.post<CreativeAsset>(`/api/assets/${id}/approve`, { holdFinal });
  return data;
}

export async function renderFinal(id: number): Promise<CreativeAsset> {
  const { data } = await client.post<CreativeAsset>(`/api/assets/${id}/render-final`);
  return data;
}

export async function cancelAsset(id: number): Promise<CreativeAsset> {
  const { data } = await client.delete<CreativeAsset>(`/api/assets/${id}`);
  return data;
}
