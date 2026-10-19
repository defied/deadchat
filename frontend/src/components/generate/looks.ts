// Optional cinematography presets appended to the prompt (from the original Generate panel).
export interface LookOption { value: string; label: string }

export const FRAMERATE_LOOKS: LookOption[] = [
  { value: '', label: 'None' },
  { value: 'cinematic 24fps, natural motion blur, film-like cadence', label: '24fps Cinematic' },
  { value: '30fps broadcast, smooth natural motion', label: '30fps Broadcast' },
  { value: '60fps high frame rate, hyper-real fluid motion', label: '60fps HFR' },
  { value: 'slow motion, overcranked, high-speed capture', label: 'Slow Motion' },
];

export const LENS_TYPES: LookOption[] = [
  { value: '', label: 'None' },
  { value: 'shot on 50mm normal lens, natural perspective', label: '50mm Normal' },
  { value: 'shot on 28mm wide angle lens, expanded field of view', label: '28mm Wide' },
  { value: 'shot on 16mm ultra-wide angle lens, dramatic perspective', label: '16mm Ultra-wide' },
  { value: 'shot on 85mm portrait telephoto lens, shallow depth of field, subject isolation', label: '85mm Portrait' },
  { value: 'shot on 200mm telephoto lens, compressed perspective, background compression', label: '200mm Telephoto' },
  { value: 'macro lens, extreme close-up, fine detail, shallow depth of field', label: 'Macro' },
  { value: 'fisheye lens, extreme barrel distortion, 180 degree field of view', label: 'Fisheye' },
  { value: 'anamorphic lens, 2.39:1 widescreen, oval bokeh, horizontal lens character', label: 'Anamorphic' },
];

export const FILM_STOCKS: LookOption[] = [
  { value: '', label: 'None' },
  { value: 'Kodak Vision3 250D film stock, warm daylight balanced, fine grain, rich shadows', label: 'Kodak Vision3 250D' },
  { value: 'Kodak Vision3 500T film stock, tungsten balanced, cinematic warm midtones', label: 'Kodak Vision3 500T' },
  { value: 'Kodak Portra 400, natural warm skin tones, wide exposure latitude', label: 'Kodak Portra 400' },
  { value: 'Fuji Eterna 500 film stock, cool desaturated tones, flat low-contrast look', label: 'Fuji Eterna 500' },
  { value: 'Fuji Velvia 50, ultra-saturated vivid colors, high contrast, punchy', label: 'Fuji Velvia 50' },
  { value: 'Ilford HP5 Plus, black and white film, medium contrast, fine grain monochrome', label: 'Ilford HP5 (B&W)' },
  { value: 'Kodak Tri-X 400, high contrast black and white, pronounced grain, gritty monochrome', label: 'Kodak Tri-X 400 (B&W)' },
];

export const GRAIN_ISO: LookOption[] = [
  { value: '', label: 'None' },
  { value: 'ISO 100, virtually grainless, pristine clean image', label: 'ISO 100 (clean)' },
  { value: 'ISO 400, fine film grain, subtle organic texture', label: 'ISO 400 (subtle)' },
  { value: 'ISO 800, visible film grain, textured cinematic look', label: 'ISO 800 (moderate)' },
  { value: 'ISO 1600, heavy film grain, gritty organic texture, raw look', label: 'ISO 1600 (heavy)' },
  { value: 'ISO 3200, extreme film grain, high noise, raw gritty underground aesthetic', label: 'ISO 3200 (extreme)' },
];

export const COLOR_SCIENCES: LookOption[] = [
  { value: '', label: 'None' },
  { value: 'ARRI Alexa color science, LogC color grading, natural skin tones, cinematic warmth', label: 'ARRI Alexa' },
  { value: 'RED IPP2 color pipeline, wide color gamut, punchy highlights, high dynamic range', label: 'RED IPP2' },
  { value: 'Sony S-Log3 color science, extended dynamic range, clean clinical tones', label: 'Sony S-Log3' },
  { value: 'Kodak print film color science, warm golden tones, rich shadow detail', label: 'Kodak Print Film' },
  { value: 'Fujifilm color science, accurate vibrant natural colors, fine tonal gradation', label: 'Fujifilm' },
  { value: 'vintage film look, faded colors, lifted blacks, slight desaturation, nostalgic', label: 'Vintage / Faded' },
  { value: 'bleach bypass, desaturated, high contrast, silvery metallic tones, bleak', label: 'Bleach Bypass' },
];

export const FILTER_OPTIONS: LookOption[] = [
  { value: 'anamorphic lens flares, blue horizontal streak reflections', label: 'Anamorphic Flares' },
  { value: 'diffusion filter, Pro-Mist, soft ethereal glow on bright highlights', label: 'Diffusion / Pro-Mist' },
  { value: 'cross-process color treatment, unexpected hue shifts, experimental', label: 'Cross-process' },
  { value: 'natural vignette, darkened corners, focus toward center', label: 'Vignette' },
  { value: 'warm amber golden tones, golden hour sunlight', label: 'Warm Tones' },
  { value: 'cool teal blue tones, cold sterile atmosphere', label: 'Cool Tones' },
  { value: 'muted desaturated color palette, washed out', label: 'Desaturated' },
  { value: 'shallow depth of field, creamy bokeh, subject isolation', label: 'Shallow DOF' },
  { value: 'lens character, chromatic aberration, optical imperfections, organic', label: 'Lens Character' },
];
