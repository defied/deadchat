// Shapes of the JSON columns on `influencers` (and helpers' inputs).
// Every field is optional in storage; defaults live in withDefaults().

export type InfluencerKind = 'visual' | 'text';
export type InfluencerStatus = 'draft' | 'active' | 'paused';

/** Wizard steps, in order, per kind. */
export const STEPS: Record<InfluencerKind, string[]> = {
  visual: ['rules', 'persona', 'look', 'portfolio', 'plan', 'accounts', 'launch'],
  text: ['rules', 'persona', 'research', 'plan', 'accounts', 'launch'],
};

export interface Persona {
  displayName?: string;
  /** Stated age of the (fictional) persona. Must be an adult. */
  age?: number;
  gender?: string;
  niche?: string;
  audience?: string;
  tone?: string;
  language?: string;
  bio?: string;
  backstory?: string;
  /** Free-text perspective, e.g. "neutral explainer" or "pro-transit urbanist". */
  perspective?: string;
  /** Short AI disclosure shown in the bio and appended to posts. */
  disclosure?: string;
  hashtags?: string[];
}

export interface Look {
  /** Locked appearance description reused in every image prompt. */
  appearance?: string;
  /** Overall photographic style, e.g. "natural light iPhone photo". */
  style?: string;
  imageModel?: string;
  videoModel?: string;
  ratio?: string;
  /**
   * Allow tasteful implied nudity (a bath with the chest covered by foam, a towel
   * after a shower). Nipples, genitals and buttocks stay covered; nothing explicit.
   */
  suggestive?: boolean;
  /** Seed of the approved look, reused as the base seed for consistency. */
  seed?: number;
  approvedMediaId?: number;
}

export interface Research {
  topics?: string[];
  /** RSS/Atom feeds used to discover what's in the news. */
  feeds?: string[];
  /** Search Bluesky for what people are posting about each topic. */
  useBlueskyTrends?: boolean;
  /** Extra domains to trust on top of the built-in list. */
  trustedDomains?: string[];
  /** Domains never to cite. */
  blockedDomains?: string[];
  /** Independent trusted domains that must support each claim. */
  minSources?: number;
  /** Political / civic content: stricter rules (see compliance.ts). */
  political?: boolean;
}

export interface Plan {
  /** Posts per week (capped by compliance.MAX_POSTS_PER_DAY). */
  postsPerWeek?: number;
  /** 0 = Sunday … 6 = Saturday */
  days?: number[];
  /** Local posting window, hours 0-23, inclusive start, exclusive end. */
  windowStart?: number;
  windowEnd?: number;
  timezone?: string;
  /** Visual: themes to rotate through ("morning coffee", "hiking"). */
  themes?: string[];
  /** Visual: share of posts that are short clips, 0-1. */
  videoShare?: number;
  /** Publish without human approval once every automated check passes. */
  autoPublish?: boolean;
  platforms?: string[];
}

/** What the user confirmed on the rules step. */
export interface Attestation {
  invented?: boolean;
  adult?: boolean;
  disclose?: boolean;
  platformRules?: boolean;
  noDeception?: boolean;
  acceptedAt?: string;
}

export interface InfluencerRow {
  id: number;
  user_id: number;
  name: string;
  kind: InfluencerKind;
  status: InfluencerStatus;
  step: string;
  persona: string;
  look: string;
  research: string;
  plan: string;
  attestation: string;
  last_post_at: string | null;
  created_at: string;
  updated_at: string;
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

export type MediaRole = 'look' | 'portfolio' | 'clip' | 'post';
export type MediaStatus = 'pending' | 'ready' | 'approved' | 'rejected' | 'failed';

export interface InfluencerMedia {
  id: number;
  influencer_id: number;
  role: MediaRole;
  status: MediaStatus;
  job_id: number | null;
  media_id: number | null;
  prompt: string | null;
  scene: string | null;
  error: string | null;
  created_at: string;
}

export type PostStatus = 'review' | 'approved' | 'publishing' | 'published' | 'rejected' | 'blocked' | 'failed';

export interface Source {
  url: string;
  title?: string;
  domain: string;
  publishedAt?: string;
}

export interface ClaimCheck {
  claim: string;
  verdict: 'supported' | 'unsupported' | 'contradicted';
  supportingDomains: string[];
  note?: string;
}

export interface FactCheck {
  passed: boolean;
  claims: ClaimCheck[];
  minSources: number;
  reason?: string;
  checkedAt: string;
}

export interface ComplianceResult {
  passed: boolean;
  /** Blocking problems. */
  issues: string[];
  /** Non-blocking notes. */
  warnings: string[];
}
