// Analysis pipelines: which specialist models look at a study, what the
// frame-by-frame review focuses on, and which pipeline to suggest for a file.

import type { CaseItem, CaseProfile } from './store';

export type PipelineId = 'general' | 'peds-echo' | 'adult-echo' | 'angio' | 'cardiac-mri' | 'ct';

export interface Pipeline {
  id: PipelineId;
  label: string;
  description: string;
  /** Specialist models on the GPU box's medical service, in run order. */
  specialists: string[];
  /** What the frame-by-frame review should pay attention to. */
  focus: string;
}

export const PIPELINES: Pipeline[] = [
  {
    id: 'peds-echo',
    label: 'Pediatric echo',
    description: 'Frame review plus EchoAI-Peds (28 congenital, structural and repair findings) and PanEcho measurements (adult-trained).',
    specialists: ['echoai-peds', 'panecho'],
    focus:
      'This is a pediatric echocardiogram. Note the view, chamber sizes and their changes through the cycle, wall motion, ' +
      'septal position and motion, valve opening and closure, any colour Doppler jets (direction, timing), shunts, ' +
      'outflow tracts, and post-surgical material (patches, conduits, devices).',
  },
  {
    id: 'adult-echo',
    label: 'Adult echo',
    description: 'Frame review plus PanEcho (39 reporting tasks: function, chamber size, valves, effusion).',
    specialists: ['panecho'],
    focus:
      'This is an adult echocardiogram. Note the view, LV and RV size and systolic function through the cycle, regional ' +
      'wall motion, valve morphology and motion, colour Doppler jets, pericardial effusion and image quality.',
  },
  {
    id: 'angio',
    label: 'Cath angiography',
    description: 'Frame review focused on catheter position, contrast filling and washout, vessels and devices.',
    specialists: [],
    focus:
      'This is an X-ray angiogram (cath lab cine). Note the projection if you can tell, catheter and wire positions, ' +
      'when contrast is injected, which chamber or vessels fill and in what order, washout, any narrowing, filling ' +
      'defects, extravasation or collaterals, and devices, wires, clips or sternotomy wires.',
  },
  {
    id: 'cardiac-mri',
    label: 'Cardiac MRI',
    description: 'Frame review plus CineMA (ventricle segmentation, LV/RV ejection fraction, disease classification).',
    specialists: ['cinema'],
    focus:
      'This is cine cardiac MRI. Note the plane (short axis, 2/3/4-chamber), ventricular size and wall thickening ' +
      'through the cycle, regional wall motion, valve motion and flow artefacts, and pericardial or pleural fluid.',
  },
  {
    id: 'ct',
    label: 'CT',
    description: 'Slice-by-slice review plus TotalSegmentator (organ and structure segmentation and volumes).',
    specialists: ['totalsegmentator'],
    focus:
      'These are CT slices in order. Note the anatomy covered as you move through the stack, contrast phase, cardiac ' +
      'chambers and great vessels, lungs, any masses, collections, calcification and post-surgical material.',
  },
  {
    id: 'general',
    label: 'General review',
    description: 'Frame-by-frame review only, with no specialist model.',
    specialists: [],
    focus:
      'Describe what the images show: modality, anatomy, view, and every notable finding or change across frames, ' +
      'including devices and post-surgical material.',
  },
];

export const pipelineById = (id: string): Pipeline | undefined => PIPELINES.find((p) => p.id === id);

/** Age in years from DICOM ("006Y", "018M") or free text ("6 years", "3 months", "34 wk GA"). */
export function ageYears(dicomAge?: string, profileAge?: string): number | undefined {
  const d = /^(\d{1,3})([DWMY])$/i.exec(dicomAge?.trim() ?? '');
  if (d) {
    const n = Number(d[1]);
    return { D: n / 365, W: n / 52, M: n / 12, Y: n }[d[2].toUpperCase() as 'D' | 'W' | 'M' | 'Y'];
  }
  const t = (profileAge ?? '').toLowerCase();
  const m = /(\d+(?:\.\d+)?)\s*(y|yr|year|m|mo|month|w|wk|week|d|day)/.exec(t);
  if (m) {
    const n = Number(m[1]);
    const u = m[2][0];
    return u === 'y' ? n : u === 'm' ? n / 12 : u === 'w' ? n / 52 : n / 365;
  }
  if (/neonat|newborn|infant|preterm|ga\b/.test(t)) return 0;
  return undefined;
}

/** What a quick look at one frame by the vision model said. */
export interface Glance {
  modality?: string;
  anatomy?: string;
  view?: string;
  kind?: 'echo' | 'angio' | 'mri' | 'ct' | 'xray' | 'photo' | 'document' | 'other';
}

export interface Suggestion {
  pipeline: PipelineId;
  reasons: string[];
}

/** Pick a pipeline from the file's metadata, the case age, and (optionally) a glance at a frame. */
export function suggestPipeline(item: Pick<CaseItem, 'frames' | 'kind' | 'meta'>, profile: CaseProfile, glance?: Glance): Suggestion {
  const d = item.meta.dicom;
  const reasons: string[] = [];
  const age = ageYears(d?.patientAge, profile.age);
  const child = age !== undefined && age < 18;
  if (age !== undefined) reasons.push(`patient age ${age < 2 ? `${Math.round(age * 12)} months` : `${Math.round(age)} years`}`);
  const echo = (pediatric: boolean): Suggestion => ({ pipeline: pediatric ? 'peds-echo' : 'adult-echo', reasons });

  const modality = d?.modality;
  if (modality) reasons.unshift(`DICOM modality ${modality}${d?.seriesDescription ? ` (${d.seriesDescription})` : ''}`);
  if (modality === 'US') return echo(child);
  if (modality === 'XA' || modality === 'RF') return { pipeline: 'angio', reasons };
  if (modality === 'MR') return { pipeline: 'cardiac-mri', reasons };
  if (modality === 'CT') return { pipeline: 'ct', reasons };

  if (glance?.kind) {
    reasons.push(`the image looks like ${glance.kind}${glance.view ? ` (${glance.view})` : ''}${glance.anatomy ? `, ${glance.anatomy}` : ''}`);
    if (glance.kind === 'echo') return echo(child);
    if (glance.kind === 'angio') return { pipeline: 'angio', reasons };
    if (glance.kind === 'mri') return { pipeline: 'cardiac-mri', reasons };
    if (glance.kind === 'ct') return { pipeline: 'ct', reasons };
  }
  if (!reasons.length) reasons.push('no modality information');
  return { pipeline: 'general', reasons };
}

// ── timing ───────────────────────────────────────────────────────────────────

/** Overlapping windows of consecutive frames that together cover every frame. */
export function frameWindows(count: number, size = 8, overlap = 1): Array<[number, number]> {
  if (count <= 0) return [];
  if (count <= size) return [[0, count - 1]];
  const out: Array<[number, number]> = [];
  const step = Math.max(1, size - overlap);
  for (let start = 0; ; start += step) {
    const end = Math.min(count - 1, start + size - 1);
    out.push([start, end]);
    if (end === count - 1) break;
  }
  return out;
}

/** "0:01.84" for a frame at `fps`. */
export function frameTime(frame: number, fps?: number | null): string | null {
  if (!fps) return null;
  const t = frame / fps;
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
}
