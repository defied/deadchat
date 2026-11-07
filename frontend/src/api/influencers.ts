import client from './client';

export type InfluencerKind = 'visual' | 'text';
export type InfluencerStatus = 'draft' | 'active' | 'paused';

export interface Persona {
  displayName?: string;
  age?: number;
  gender?: string;
  niche?: string;
  audience?: string;
  tone?: string;
  language?: string;
  bio?: string;
  backstory?: string;
  perspective?: string;
  disclosure?: string;
  hashtags?: string[];
}

export interface Look {
  appearance?: string;
  style?: string;
  imageModel?: string;
  videoModel?: string;
  ratio?: string;
  seed?: number;
  approvedMediaId?: number;
}

export interface Research {
  topics?: string[];
  feeds?: string[];
  useBlueskyTrends?: boolean;
  trustedDomains?: string[];
  blockedDomains?: string[];
  minSources?: number;
  political?: boolean;
}

export interface Plan {
  postsPerWeek?: number;
  days?: number[];
  windowStart?: number;
  windowEnd?: number;
  timezone?: string;
  themes?: string[];
  videoShare?: number;
  autoPublish?: boolean;
  platforms?: string[];
}

export interface Attestation {
  invented?: boolean;
  adult?: boolean;
  disclose?: boolean;
  platformRules?: boolean;
  noDeception?: boolean;
  acceptedAt?: string;
}

export interface Influencer {
  id: number;
  userId: number;
  name: string;
  kind: InfluencerKind;
  status: InfluencerStatus;
  step: string;
  persona: Persona;
  look: Look;
  research: Research;
  plan: Plan;
  attestation: Attestation;
  lastPostAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InfluencerSummary extends Influencer {
  approvedPortfolio: number;
  pendingReview: number;
  published: number;
}

export interface InfluencerMedia {
  id: number;
  role: 'look' | 'portfolio' | 'clip' | 'post';
  status: 'pending' | 'ready' | 'approved' | 'rejected' | 'failed';
  job_id: number | null;
  media_id: number | null;
  prompt: string | null;
  scene: string | null;
  error: string | null;
  created_at: string;
}

export interface Check {
  passed: boolean;
  issues: string[];
  warnings: string[];
}

export interface AccountView {
  platform: string;
  handle: string | null;
  status: 'pending' | 'connected' | 'manual' | 'error';
  lastError: string | null;
  checklist: Record<string, boolean>;
  checklistDone: boolean;
  fields: Record<string, string>;
  updatedAt: string;
}

export interface Source {
  url: string;
  title?: string;
  domain: string;
  publishedAt?: string;
}

export interface FactCheck {
  passed: boolean;
  minSources: number;
  reason?: string;
  checkedAt: string;
  claims: Array<{ claim: string; verdict: 'supported' | 'unsupported' | 'contradicted'; supportingDomains: string[]; note?: string }>;
}

export interface Post {
  id: number;
  status: 'review' | 'approved' | 'publishing' | 'published' | 'rejected' | 'blocked' | 'failed';
  origin: 'auto' | 'manual';
  topic: string | null;
  text: string;
  mediaIds: number[];
  sources: Source[];
  factCheck: FactCheck | null;
  compliance: Check | null;
  checkedText: string | null;
  scheduledFor: string | null;
  results: Record<string, { ok: boolean; url?: string; error?: string; at: string; manual?: boolean }>;
  error: string | null;
  createdAt: string;
}

export interface Detail {
  influencer: Influencer;
  steps: string[];
  media: InfluencerMedia[];
  accounts: AccountView[];
  posts: Post[];
  checks: { persona: Check; plan: Check; launch: Check };
  working: string | null;
  nextWindow: string | null;
}

export interface PlatformDef {
  id: string;
  name: string;
  mode: 'api' | 'manual';
  maxText: number;
  media: { image: boolean; video: boolean; textOnly: boolean };
  fields: Array<{ key: string; label: string; secret?: boolean; placeholder?: string; hint?: string }>;
  checklist: Array<{ id: string; label: string; required: boolean; link?: string }>;
  aiRule: string;
  connect?: 'google';
  needsPublicUrl?: boolean;
}

export interface ModelOption {
  id: string;
  label: string;
  summary: string;
  speed: string;
}

export interface Meta {
  steps: Record<InfluencerKind, string[]>;
  platforms: PlatformDef[];
  publishing: { publicUrlConfigured: boolean; youtubeRedirectUri: string | null };
  models: { image: ModelOption[]; video: ModelOption[] };
  rules: { minAge: number; maxPostsPerDay: number; minMinutesBetween: number; minPortfolio: number };
  research: { searxngUrl: string | null; braveKeySet: boolean; configured: boolean };
  defaultTrustedDomains: string[];
  suggestedFeeds: Array<{ label: string; url: string }>;
}

export interface PersonaSuggestion {
  persona: Persona;
  appearance?: string;
  themes?: string[];
  topics?: string[];
}

const base = '/api/influencers';

export const getMeta = async () => (await client.get<Meta>(`${base}/meta`)).data;
export const listInfluencers = async () => (await client.get<{ influencers: InfluencerSummary[] }>(base)).data.influencers;
export const createInfluencer = async (name: string, kind: InfluencerKind) => (await client.post<Detail>(base, { name, kind })).data;
export const getInfluencer = async (id: number) => (await client.get<Detail>(`${base}/${id}`)).data;
export const deleteInfluencer = async (id: number) => {
  await client.delete(`${base}/${id}`);
};

export const updateInfluencer = async (
  id: number,
  patch: Partial<{ name: string; step: string; persona: Persona; look: Look; research: Research; plan: Plan; attestation: Attestation }>,
) => (await client.patch<Detail>(`${base}/${id}`, patch)).data;

export const suggestPersona = async (id: number, brief: string) =>
  (await client.post<PersonaSuggestion>(`${base}/${id}/suggest`, { brief })).data;
export const refineLook = async (id: number, feedback: string) =>
  (await client.post<{ appearance: string }>(`${base}/${id}/look/refine`, { feedback })).data.appearance;
export const generateLooks = async (id: number, count: number) => (await client.post<Detail>(`${base}/${id}/look/generate`, { count })).data;
export const generatePortfolio = async (id: number, count: number) =>
  (await client.post<Detail>(`${base}/${id}/portfolio/generate`, { count })).data;
export const approveMedia = async (id: number, mid: number) => (await client.post<Detail>(`${base}/${id}/media/${mid}/approve`)).data;
export const rejectMedia = async (id: number, mid: number) => (await client.post<Detail>(`${base}/${id}/media/${mid}/reject`)).data;
export const animateMedia = async (id: number, mid: number, motion?: string) =>
  (await client.post<Detail>(`${base}/${id}/media/${mid}/animate`, { motion })).data;

export const saveAccount = async (id: number, platform: string, fields: Record<string, string>, checklist: Record<string, boolean>) =>
  (await client.put<Detail>(`${base}/${id}/accounts/${platform}`, { fields, checklist })).data;
export const testAccount = async (id: number, platform: string) => (await client.post<Detail>(`${base}/${id}/accounts/${platform}/test`)).data;
export const connectYouTube = async (id: number) =>
  (await client.post<{ url: string }>(`${base}/${id}/accounts/youtube/connect`)).data;
export const removeAccount = async (id: number, platform: string) => (await client.delete<Detail>(`${base}/${id}/accounts/${platform}`)).data;

export const activate = async (id: number) => (await client.post<Detail>(`${base}/${id}/activate`)).data;
export const pause = async (id: number) => (await client.post<Detail>(`${base}/${id}/pause`)).data;

export const generatePost = async (id: number, topic?: string) => (await client.post<Detail>(`${base}/${id}/posts/generate`, { topic })).data;
export const editPost = async (id: number, pid: number, text: string) => (await client.patch<Detail>(`${base}/${id}/posts/${pid}`, { text })).data;
export const recheckPost = async (id: number, pid: number) => (await client.post<Detail>(`${base}/${id}/posts/${pid}/recheck`)).data;
export const approvePost = async (id: number, pid: number, now = false) =>
  (await client.post<Detail>(`${base}/${id}/posts/${pid}/approve`, { now })).data;
export const rejectPost = async (id: number, pid: number) => (await client.post<Detail>(`${base}/${id}/posts/${pid}/reject`)).data;
export const markPosted = async (id: number, pid: number, platform: string, url?: string) =>
  (await client.post<Detail>(`${base}/${id}/posts/${pid}/mark-posted`, { platform, url })).data;

export const saveResearchSettings = async (p: { searxngUrl?: string | null; braveKey?: string | null }) =>
  (await client.put(`${base}/research-settings`, p)).data;
