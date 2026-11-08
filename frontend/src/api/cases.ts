import client from './client';

export const CATEGORIES = [
  { value: 'imaging', label: 'Imaging' },
  { value: 'cine', label: 'Cine & video' },
  { value: 'ecg', label: 'ECG' },
  { value: 'labs', label: 'Labs' },
  { value: 'reports', label: 'Reports' },
  { value: 'pathology', label: 'Pathology' },
  { value: 'photos', label: 'Clinical photos' },
  { value: 'notes', label: 'Notes & letters' },
  { value: 'other', label: 'Other' },
] as const;
export type Category = (typeof CATEGORIES)[number]['value'];

export interface LabRow {
  id: string;
  date?: string;
  test: string;
  value: string;
  unit?: string;
  low?: string;
  high?: string;
}

export interface TimelineEvent {
  id: string;
  date?: string;
  title: string;
  detail?: string;
}

export interface CaseProfile {
  age?: string;
  sex?: string;
  weightKg?: number;
  heightCm?: number;
  specialty?: string;
  chiefComplaint?: string;
  hpi?: string;
  pmh?: string;
  diagnoses?: string;
  procedures?: string;
  medications?: string;
  allergies?: string;
  familyHistory?: string;
  socialHistory?: string;
  exam?: string;
  vitals?: { hr?: string; bp?: string; rr?: string; spo2?: string; temp?: string };
  question?: string;
  teachingPoints?: string;
  labs?: LabRow[];
  events?: TimelineEvent[];
}

export interface MedicalCase {
  id: number;
  userId: number;
  title: string;
  profile: CaseProfile;
  summary: string | null;
  summarySource: 'ai' | 'user' | null;
  createdAt: string;
  updatedAt: string;
}

export interface DicomMeta {
  modality?: string;
  studyDate?: string;
  seriesDate?: string;
  studyDescription?: string;
  seriesDescription?: string;
  protocol?: string;
  bodyPart?: string;
  viewPosition?: string;
  laterality?: string;
  patientAge?: string;
  patientSex?: string;
  patientHeightM?: number;
  patientWeightKg?: number;
  manufacturer?: string;
  model?: string;
  rows?: number;
  columns?: number;
  frames: number;
  fps?: number;
  heartRate?: number;
  pixelSpacing?: string;
  sliceThickness?: number;
  photometric?: string;
  transferSyntax?: string;
  burnedInAnnotation?: boolean;
  unsupported?: string;
}

export interface CaseItem {
  id: number;
  kind: 'dicom' | 'image' | 'video' | 'document' | 'data' | 'other';
  category: Category;
  title: string;
  notes: string | null;
  takenAt: string | null;
  originalName: string | null;
  mime: string | null;
  sizeBytes: number;
  frames: number;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  aiNotes: string | null;
  aiStatus: 'running' | 'done' | 'failed' | null;
  aiError: string | null;
  maskTop: number;
  include: boolean;
  sort: number;
  createdAt: string;
  hasThumb: boolean;
  hasDisplay: boolean;
  displayMime: string | null;
  playable: boolean | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  table: { columns: string[]; rows: string[][]; total: number } | null;
  originals: number;
  stack: boolean;
  dicom: DicomMeta | null;
  sampledFrames: { count: number; fps: number } | null;
  analysis: AnalysisBrief | null;
}

// ── multi-model analysis ──

export type PipelineId = 'general' | 'peds-echo' | 'adult-echo' | 'angio' | 'cardiac-mri' | 'ct';
export type AnalysisStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export interface AnalysisBrief {
  id: number;
  status: AnalysisStatus;
  pipeline: PipelineId;
  etaS: number | null;
  elapsedS: number | null;
  framesDone: number;
  framesTotal: number;
}

export interface AnalysisStage {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'canceled';
  done: number;
  total: number;
  unit: string;
  startedAt?: string;
  finishedAt?: string;
  durationS?: number;
  secPerUnit?: number;
  error?: string;
  etaS: number | null;
  elapsedS: number | null;
}

export interface SpecialistFinding {
  label: string;
  value?: string | number | boolean | null;
  unit?: string;
  probability?: number;
  frames?: [number, number];
  note?: string;
}

export interface SpecialistResult {
  model: string;
  version?: string;
  durationS: number;
  findings: SpecialistFinding[];
  warnings?: string[];
}

export interface AnalysisResults {
  frameModel?: string;
  frameUnit?: 'frame' | 'slice' | 'image';
  frameCount?: number;
  fps?: number | null;
  windows?: Array<{ start: number; end: number; summary: string; durationS: number; observations: Array<{ frame: number; time?: string | null; finding: string }> }>;
  specialists?: Record<string, SpecialistResult | { error: string }>;
  report?: string;
  reportModel?: string;
}

export interface Analysis {
  id: number;
  itemId: number;
  pipeline: PipelineId;
  pipelineLabel: string;
  frameModel: string;
  status: AnalysisStatus;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  stages: AnalysisStage[];
  etaS: number | null;
  elapsedS: number | null;
  results: AnalysisResults;
}

export interface AnalysisOptions {
  pipelines: Array<{
    id: PipelineId;
    label: string;
    description: string;
    specialists: Array<{ id: string; label: string; ready: boolean; error: string | null; license: string | null }>;
  }>;
  frameModels: Array<{ name: string; installed: boolean; recommended: boolean; parameterSize: string | null; sizeBytes: number }>;
  defaultFrameModel: string;
  ollamaReachable: boolean;
  medService: { url: string; reachable: boolean; gpu: string | null; error: string | null };
}

export async function analysisOptions(): Promise<AnalysisOptions> {
  const { data } = await client.get<AnalysisOptions>('/api/cases/analysis/options', { timeout: 20_000 });
  return data;
}

export async function suggestAnalysis(id: number, itemId: number): Promise<{ pipeline: PipelineId; reasons: string[] }> {
  const { data } = await client.post<{ pipeline: PipelineId; reasons: string[] }>(`/api/cases/${id}/items/${itemId}/analysis/suggest`, {}, { timeout: 180_000 });
  return data;
}

export async function getItemAnalysis(id: number, itemId: number): Promise<{ current: Analysis | null; history: AnalysisBrief[] }> {
  const { data } = await client.get<{ current: Analysis | null; history: AnalysisBrief[] }>(`/api/cases/${id}/items/${itemId}/analysis`);
  return data;
}

export async function getAnalysisRun(id: number, itemId: number, aid: number): Promise<Analysis> {
  const { data } = await client.get<{ analysis: Analysis }>(`/api/cases/${id}/items/${itemId}/analysis/${aid}`);
  return data.analysis;
}

export async function startAnalysis(id: number, itemId: number, pipeline: PipelineId, frameModel: string, skipSpecialists = false): Promise<Analysis> {
  const { data } = await client.post<{ analysis: Analysis }>(`/api/cases/${id}/items/${itemId}/analysis`, { pipeline, frameModel, skipSpecialists }, { timeout: 60_000 });
  return data.analysis;
}

export async function cancelAnalysis(id: number, itemId: number, aid: number): Promise<Analysis> {
  const { data } = await client.post<{ analysis: Analysis }>(`/api/cases/${id}/items/${itemId}/analysis/${aid}/cancel`);
  return data.analysis;
}

export async function uploadSampledFrames(id: number, itemId: number, frames: Blob[], fps: number, onProgress?: (f: number) => void): Promise<CaseItem> {
  const form = new FormData();
  form.append('fps', String(fps));
  frames.forEach((b, i) => form.append('frames', b, `${String(i).padStart(5, '0')}.jpg`));
  const { data } = await client.post<{ item: CaseItem }>(`/api/cases/${id}/items/${itemId}/sampled-frames`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    onUploadProgress: (e) => e.total && onProgress?.(e.loaded / e.total),
  });
  return data.item;
}

export interface CaseDetail {
  case: MedicalCase;
  items: CaseItem[];
}

export interface CaseSummary {
  id: number;
  title: string;
  updatedAt: string;
  items: number;
  thumbItem: number | null;
  age?: string;
  sex?: string;
  specialty?: string;
  chiefComplaint?: string;
}

export async function listCases(): Promise<CaseSummary[]> {
  const { data } = await client.get<{ cases: CaseSummary[] }>('/api/cases');
  return data.cases;
}

export async function createCase(title: string): Promise<CaseDetail> {
  const { data } = await client.post<CaseDetail>('/api/cases', { title });
  return data;
}

export async function getCase(id: number): Promise<CaseDetail> {
  const { data } = await client.get<CaseDetail>(`/api/cases/${id}`);
  return data;
}

export async function updateCase(id: number, patch: { title?: string; profile?: CaseProfile; summary?: string }): Promise<CaseDetail> {
  const { data } = await client.put<CaseDetail>(`/api/cases/${id}`, patch);
  return data;
}

export async function deleteCase(id: number): Promise<void> {
  await client.delete(`/api/cases/${id}`);
}

export async function draftSummary(id: number): Promise<CaseDetail> {
  const { data } = await client.post<CaseDetail>(`/api/cases/${id}/summary`, {}, { timeout: 300_000 });
  return data;
}

export async function reorderItems(id: number, ids: number[]): Promise<CaseDetail> {
  const { data } = await client.post<CaseDetail>(`/api/cases/${id}/reorder`, { ids });
  return data;
}

export async function uploadItem(id: number, file: File, category: string, onProgress?: (fraction: number) => void): Promise<CaseItem> {
  const form = new FormData();
  if (category) form.append('category', category);
  form.append('file', file, file.name);
  const { data } = await client.post<{ item: CaseItem }>(`/api/cases/${id}/items`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    onUploadProgress: (e) => e.total && onProgress?.(e.loaded / e.total),
  });
  return data.item;
}

export async function updateItem(
  id: number,
  itemId: number,
  patch: Partial<{ title: string; category: Category; notes: string; aiNotes: string; takenAt: string; maskTop: number; include: boolean }>,
): Promise<CaseItem> {
  const { data } = await client.patch<{ item: CaseItem }>(`/api/cases/${id}/items/${itemId}`, patch);
  return data.item;
}

export async function deleteItem(id: number, itemId: number): Promise<void> {
  await client.delete(`/api/cases/${id}/items/${itemId}`);
}

export async function describeItem(id: number, itemId: number): Promise<CaseItem> {
  const { data } = await client.post<{ item: CaseItem }>(`/api/cases/${id}/items/${itemId}/describe`);
  return data.item;
}

export async function uploadThumb(id: number, itemId: number, blob: Blob, duration?: number): Promise<CaseItem> {
  const form = new FormData();
  form.append('thumb', blob, 'thumb.jpg');
  if (duration) form.append('duration', String(duration));
  const { data } = await client.post<{ item: CaseItem }>(`/api/cases/${id}/items/${itemId}/thumb`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.item;
}

export const itemUrl = (caseId: number, itemId: number, part: string) => `/api/cases/${caseId}/items/${itemId}/${part}`;
