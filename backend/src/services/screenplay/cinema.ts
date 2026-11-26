// The language of a shot, in the categories cinematography models (ShotVL /
// ShotBench) are trained on. The shot list, the shot mentor and the framing
// check all use these.

export const SIZES = ['Extreme Wide', 'Wide', 'Medium Wide', 'Medium', 'Medium Close Up', 'Close Up', 'Extreme Close Up'] as const;
export const FRAMINGS = ['Single', 'Two shot', 'Group shot', 'Over the shoulder', 'Point of view', 'Insert'] as const;
export const ANGLES = ['Aerial', 'Overhead', 'High angle', 'Eye level', 'Low angle', 'Dutch angle'] as const;
export const LENS_SIZES = ['Ultra wide / fisheye', 'Wide', 'Medium', 'Long lens / telephoto'] as const;
export const LIGHT_TYPES = ['Daylight', 'Overcast', 'Sunny', 'Moonlight', 'Practical light', 'Artificial light', 'Firelight', 'Mixed light'] as const;
export const LIGHT_CONDITIONS = ['Soft light', 'Hard light', 'High contrast', 'Low contrast', 'Backlight', 'Side light', 'Top light', 'Silhouette'] as const;
export const COMPOSITIONS = ['Centered', 'Balanced', 'Symmetrical', 'Left heavy', 'Right heavy', 'Short side'] as const;
export const MOVEMENTS = ['Static', 'Pan', 'Tilt', 'Dolly in', 'Dolly out', 'Truck', 'Pedestal', 'Zoom in', 'Zoom out', 'Handheld', 'Arc', 'Crane'] as const;

export const SETUP_FIELDS = {
  size: { label: 'Shot size', options: SIZES },
  framing: { label: 'Framing', options: FRAMINGS },
  angle: { label: 'Camera angle', options: ANGLES },
  lens: { label: 'Lens', options: LENS_SIZES },
  lightType: { label: 'Lighting type', options: LIGHT_TYPES },
  lightCondition: { label: 'Lighting condition', options: LIGHT_CONDITIONS },
  composition: { label: 'Composition', options: COMPOSITIONS },
  movement: { label: 'Camera movement', options: MOVEMENTS },
} as const;

export type SetupField = keyof typeof SETUP_FIELDS;
export type ShotSetup = Partial<Record<SetupField, string>>;

/** Keep only known fields with known values (case-insensitive match to the option). */
export function cleanSetup(raw: unknown): ShotSetup | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: ShotSetup = {};
  for (const [k, def] of Object.entries(SETUP_FIELDS) as Array<[SetupField, { options: readonly string[] }]>) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v !== 'string') continue;
    const hit = def.options.find((o) => o.toLowerCase() === v.trim().toLowerCase());
    if (hit) out[k] = hit;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A shot-type label from the setup, e.g. "Over the shoulder, Medium Close Up, Low angle". */
export function typeFromSetup(s: ShotSetup | undefined): string | undefined {
  if (!s) return undefined;
  const parts = [s.framing && s.framing !== 'Single' ? s.framing : '', s.size ?? '', s.angle && s.angle !== 'Eye level' ? s.angle : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

/** Plain words for the image model, from the setup (everything but movement, which a still can't show). */
export function setupPhrases(s: ShotSetup | undefined): string[] {
  if (!s) return [];
  const lens: Record<string, string> = {
    'Ultra wide / fisheye': 'ultra-wide lens, exaggerated perspective',
    Wide: 'wide-angle lens, deep focus',
    Medium: 'normal lens, natural perspective',
    'Long lens / telephoto': 'telephoto lens, compressed background, shallow depth of field',
  };
  return [
    s.lens ? lens[s.lens] : '',
    s.lightType || s.lightCondition ? `Lighting: ${[s.lightType, s.lightCondition].filter(Boolean).join(', ').toLowerCase()}` : '',
    s.composition ? `Composition: ${s.composition.toLowerCase()}` : '',
  ].filter(Boolean);
}
