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
