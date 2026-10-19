// Media model catalog: every image/video model DeadChat can drive through
// ComfyUI, local (weights on the GPU box) or hosted (ComfyUI partner API
// nodes, billed to a comfy.org API key).
//
// Graphs live in workflows.json. They are ComfyUI's own API-format export of
// the official templates (see ComfyUI-Installs/tools/build_workflows.py), so
// each entry only needs to write DeadChat's parameters into the right inputs.

import workflows from './workflows.json';
import { CF_NEURONS, type CloudflareSpec } from './cloudflare';

export type MediaKind = 'image' | 'video';
export type Ratio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9';
export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: unknown }>;

export interface MediaParams {
  prompt: string;
  negative?: string;
  seed: number;
  ratio: Ratio;
  resolution?: string;
  /** seconds (video) */
  duration?: number;
  /** draft quality: use the template's distilled / lightning path */
  fast?: boolean;
  /** ComfyUI input filename of the start/reference image */
  image?: string;
  /** generate a soundtrack where the model supports it */
  audio?: boolean;
}

export interface MediaModel {
  id: string;
  label: string;
  vendor: string;
  kind: MediaKind;
  /**
   * local: weights on the GPU box (free) · api: ComfyUI partner nodes (comfy.org credits)
   * · cloudflare: Workers AI free daily allowance (no ComfyUI involved)
   */
  backend: 'local' | 'api' | 'cloudflare';
  cloudflare?: CloudflareSpec;
  /** needs a start image (image-to-video) */
  needsImage?: boolean;
  /** accepts an optional start image */
  acceptsImage?: boolean;
  summary: string;
  strengths: string[];
  ratios: Ratio[];
  resolutions?: string[];
  durations?: { min: number; max: number; default: number };
  hasFastMode?: boolean;
  hasAudio?: boolean;
  /** rough guide shown in the UI */
  speed: string;
  cost?: string;
  /** local weight files, "<models subfolder>/<file>" */
  files?: string[];
  defaults: { ratio: Ratio; resolution?: string };
  apply(g: Graph, p: MediaParams): void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function set(g: Graph, node: string, input: string, value: unknown): void {
  const n = g[node];
  if (!n) throw new Error(`workflow node ${node} missing`);
  n.inputs[input] = value;
}

const SEED_MAX = 2_147_483_647;

/** ~1 MP sizes divisible by 64. */
const SIZE_1MP: Record<Ratio, [number, number]> = {
  '1:1': [1024, 1024], '16:9': [1344, 768], '9:16': [768, 1344],
  '4:3': [1152, 896], '3:4': [896, 1152], '21:9': [1536, 640],
};
/** Qwen-Image native resolutions (from the model card). */
const SIZE_QWEN: Record<Ratio, [number, number]> = {
  '1:1': [1328, 1328], '16:9': [1664, 928], '9:16': [928, 1664],
  '4:3': [1472, 1104], '3:4': [1104, 1472], '21:9': [1792, 768],
};
const SIZE_WAN5B: Record<Ratio, [number, number]> = {
  '1:1': [960, 960], '16:9': [1280, 704], '9:16': [704, 1280],
  '4:3': [1088, 832], '3:4': [832, 1088], '21:9': [1280, 544],
};
const SIZE_WAN14B: Record<Ratio, [number, number]> = {
  '1:1': [640, 640], '16:9': [832, 480], '9:16': [480, 832],
  '4:3': [736, 544], '3:4': [544, 736], '21:9': [960, 416],
};

function sizeOf(table: Record<Ratio, [number, number]>, r: Ratio): [number, number] {
  return table[r] ?? table['1:1'];
}

const ALL_RATIOS: Ratio[] = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const WIDE_RATIOS: Ratio[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
const LTX_RATIO: Record<Ratio, string> = {
  '1:1': '1:1 (Square)', '16:9': '16:9 (Widescreen)', '9:16': '9:16 (Portrait Widescreen)',
  '4:3': '4:3 (Standard)', '3:4': '3:4 (Portrait Standard)', '21:9': '21:9 (Ultrawide)',
};

// ── catalog ──────────────────────────────────────────────────────────────────

export const MEDIA_MODELS: MediaModel[] = [
  // ── Local images ──
  {
    id: 'z-image-turbo',
    label: 'Z-Image Turbo',
    vendor: 'Alibaba Tongyi',
    kind: 'image',
    backend: 'local',
    summary: 'Fast photoreal default. Top-ranked open model on the Artificial Analysis image arena.',
    strengths: ['photorealism', 'speed'],
    ratios: WIDE_RATIOS,
    speed: '~15–30 s (incl. prompt refinement)',
    files: ['diffusion_models/z_image_turbo_bf16.safetensors', 'text_encoders/qwen_3_4b.safetensors', 'vae/ae.safetensors'],
    defaults: { ratio: '1:1' },
    apply(g, p) {
      const [w, h] = sizeOf(SIZE_1MP, p.ratio);
      set(g, '57:27', 'text', p.prompt);
      set(g, '57:3', 'seed', p.seed);
      set(g, '57:13', 'width', w);
      set(g, '57:13', 'height', h);
    },
  },
  {
    id: 'qwen-image-2512',
    label: 'Qwen-Image 2512',
    vendor: 'Alibaba Qwen',
    kind: 'image',
    backend: 'local',
    summary: 'Best local model for exact prompt following and readable text in images (signs, posters, labels).',
    strengths: ['text rendering', 'prompt adherence', 'layouts'],
    ratios: WIDE_RATIOS,
    hasFastMode: true,
    speed: 'draft ~20 s · final ~2 min',
    files: [
      'diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors', 'text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors',
      'vae/qwen_image_vae.safetensors', 'loras/Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors',
    ],
    defaults: { ratio: '1:1' },
    apply(g, p) {
      const [w, h] = sizeOf(SIZE_QWEN, p.ratio);
      set(g, '238:227', 'text', p.prompt);
      if (p.negative) set(g, '238:228', 'text', p.negative);
      set(g, '238:230', 'seed', p.seed);
      set(g, '238:232', 'width', w);
      set(g, '238:232', 'height', h);
      set(g, '238:229', 'value', !!p.fast); // Lightning 4-step LoRA
    },
  },
  {
    id: 'flux2-dev',
    label: 'FLUX.2 [dev]',
    vendor: 'Black Forest Labs',
    kind: 'image',
    backend: 'local',
    summary: 'Highest-quality local image model: photorealism, lighting, typography. Non-commercial licence.',
    strengths: ['photorealism', 'detail', 'typography'],
    ratios: WIDE_RATIOS,
    hasFastMode: true,
    speed: 'draft ~35 s · final ~2 min',
    files: [
      'diffusion_models/flux2_dev_fp8mixed.safetensors', 'text_encoders/mistral_3_small_flux2_fp8.safetensors',
      'vae/flux2-vae.safetensors', 'loras/Flux2TurboComfyv2.safetensors',
    ],
    defaults: { ratio: '1:1' },
    apply(g, p) {
      const [w, h] = sizeOf(SIZE_1MP, p.ratio);
      set(g, '98:6', 'text', p.prompt);
      set(g, '98:25', 'noise_seed', p.seed);
      for (const n of ['98:47', '98:48']) {
        set(g, n, 'width', w);
        set(g, n, 'height', h);
      }
      set(g, '98:104', 'value', !!p.fast); // turbo LoRA, 8 steps
    },
  },

  // ── Local video ──
  {
    id: 'wan22-5b',
    label: 'Wan 2.2 TI2V 5B',
    vendor: 'Alibaba Wan',
    kind: 'video',
    backend: 'local',
    acceptsImage: true,
    summary: 'Fast local video at 720p/24 fps, from text or a start image.',
    strengths: ['speed', '720p'],
    ratios: ALL_RATIOS,
    durations: { min: 2, max: 5, default: 5 },
    speed: '~2 min for 4 s',
    files: ['diffusion_models/wan2.2_ti2v_5B_fp16.safetensors', 'vae/wan2.2_vae.safetensors', 'text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors'],
    defaults: { ratio: '16:9' },
    apply(g, p) {
      const [w, h] = sizeOf(SIZE_WAN5B, p.ratio);
      const secs = Math.min(5, Math.max(2, Math.round(p.duration ?? 5)));
      set(g, '6', 'text', p.prompt);
      if (p.negative) set(g, '7', 'text', p.negative);
      set(g, '3', 'seed', p.seed);
      set(g, '55', 'width', w);
      set(g, '55', 'height', h);
      set(g, '55', 'length', secs * 24 + 1);
      if (p.image) {
        g['dc_start'] = { class_type: 'LoadImage', inputs: { image: p.image } };
        set(g, '55', 'start_image', ['dc_start', 0]);
      }
    },
  },
  {
    id: 'wan22-14b-i2v',
    label: 'Wan 2.2 14B · image→video',
    vendor: 'Alibaba Wan',
    kind: 'video',
    backend: 'local',
    needsImage: true,
    summary: 'Best local motion for people, hands and faces. Animates a start image (make one with an image model first).',
    strengths: ['people', 'motion quality', 'consistency with the start image'],
    ratios: ALL_RATIOS,
    durations: { min: 2, max: 8, default: 5 },
    hasFastMode: true,
    speed: 'draft ~1 min · final ~10 min',
    files: [
      'diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors', 'diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
      'loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors', 'loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
      'vae/wan_2.1_vae.safetensors', 'text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    ],
    defaults: { ratio: '16:9' },
    apply(g, p) {
      const [w, h] = sizeOf(SIZE_WAN14B, p.ratio);
      set(g, '129:93', 'text', p.prompt);
      if (p.negative) set(g, '129:89', 'text', p.negative);
      set(g, '129:86', 'noise_seed', p.seed);
      set(g, '129:98', 'width', w);
      set(g, '129:98', 'height', h);
      set(g, '129:161', 'value', Math.min(8, Math.max(2, p.duration ?? 5)));
      set(g, '129:131', 'value', !!p.fast); // lightx2v 4-step LoRAs
      set(g, '97', 'image', p.image);
    },
  },
  {
    id: 'ltx25-t2v',
    label: 'LTX-2.5',
    vendor: 'Lightricks',
    kind: 'video',
    backend: 'local',
    summary: 'Local video with synchronized sound in one pass (22B, int8). Fast for its quality.',
    strengths: ['audio', 'speed', 'cinematic motion'],
    ratios: WIDE_RATIOS,
    durations: { min: 2, max: 8, default: 5 },
    hasAudio: true,
    speed: '~1–3 min',
    files: [
      'diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors',
      'text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
      'vae/ltx-2.5-video-vae-bf16.safetensors', 'vae/ltx-2.5-audio-vae-bf16.safetensors',
    ],
    defaults: { ratio: '16:9' },
    apply(g, p) {
      set(g, '405:376', 'value', p.prompt);
      set(g, '405:339', 'noise_seed', p.seed);
      set(g, '405:338', 'noise_seed', (p.seed + 1) % SEED_MAX);
      set(g, '409', 'aspect_ratio', LTX_RATIO[p.ratio]);
      // 8 s max: longer clips can run out of VRAM in the final decode on 24 GB.
      set(g, '405:362', 'value', Math.min(8, Math.max(2, Math.round(p.duration ?? 5))));
      set(g, '405:383', 'value', false); // DeadChat refines prompts itself
    },
  },
  {
    id: 'ltx25-i2v',
    label: 'LTX-2.5 · image→video',
    vendor: 'Lightricks',
    kind: 'video',
    backend: 'local',
    needsImage: true,
    summary: 'LTX-2.5 animating your start image, with sound.',
    strengths: ['audio', 'speed', 'keeps the start image'],
    ratios: WIDE_RATIOS,
    durations: { min: 2, max: 8, default: 5 },
    hasAudio: true,
    speed: '~1–3 min',
    files: [
      'diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors',
      'text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
      'vae/ltx-2.5-video-vae-bf16.safetensors', 'vae/ltx-2.5-audio-vae-bf16.safetensors',
    ],
    defaults: { ratio: '16:9' },
    apply(g, p) {
      set(g, '398:376', 'value', `Use the provided start image as the first frame. ${p.prompt}`);
      set(g, '398:339', 'noise_seed', p.seed);
      set(g, '398:338', 'noise_seed', (p.seed + 1) % SEED_MAX);
      set(g, '403', 'aspect_ratio', LTX_RATIO[p.ratio]);
      set(g, '398:362', 'value', Math.min(8, Math.max(2, Math.round(p.duration ?? 5))));
      set(g, '398:383', 'value', false);
      set(g, '398:363', 'value', false); // image conditioning on
      set(g, '395', 'image', p.image);
    },
  },

  // ── Hosted video ──
  {
    id: 'seedance25-t2v',
    label: 'Seedance 2.5',
    vendor: 'ByteDance',
    kind: 'video',
    backend: 'api',
    summary: 'Up to 30 s in one continuous shot with native audio; strong instruction following and physics.',
    strengths: ['long shots', 'audio', 'complex direction'],
    ratios: WIDE_RATIOS,
    resolutions: ['480p', '720p', '1080p'],
    durations: { min: 4, max: 30, default: 5 },
    hasAudio: true,
    hasFastMode: true,
    speed: '~1–4 min',
    cost: '≈ $0.10/s at 480p, more at 1080p',
    defaults: { ratio: '16:9', resolution: '720p' },
    apply(g, p) {
      set(g, '9', 'model', p.fast ? 'Seedance 2.5 Draft' : 'Seedance 2.5');
      set(g, '9', 'model.prompt', p.prompt);
      set(g, '9', 'model.resolution', p.fast ? '480p' : p.resolution ?? '720p');
      set(g, '9', 'model.ratio', p.ratio);
      set(g, '9', 'model.duration', Math.round(p.duration ?? 5));
      set(g, '9', 'model.generate_audio', p.audio !== false);
      set(g, '9', 'seed', p.seed);
    },
  },
  {
    id: 'seedance25-i2v',
    label: 'Seedance 2.5 · image→video',
    vendor: 'ByteDance',
    kind: 'video',
    backend: 'api',
    needsImage: true,
    summary: 'Seedance 2.5 animating your start image, up to 1080p.',
    strengths: ['long shots', 'audio', 'keeps the start image'],
    ratios: [...WIDE_RATIOS],
    resolutions: ['480p', '720p', '1080p'],
    durations: { min: 4, max: 30, default: 5 },
    hasAudio: true,
    speed: '~1–4 min',
    cost: '≈ $0.10/s at 480p, more at 1080p',
    defaults: { ratio: '16:9', resolution: '1080p' },
    apply(g, p) {
      set(g, '9', 'model.prompt', p.prompt);
      set(g, '9', 'model.resolution', p.resolution ?? '1080p');
      set(g, '9', 'model.ratio', 'adaptive');
      set(g, '9', 'model.duration', Math.round(p.duration ?? 5));
      set(g, '9', 'model.generate_audio', p.audio !== false);
      set(g, '9', 'seed', p.seed);
      set(g, '2', 'image', p.image);
    },
  },
  {
    id: 'wan30-t2v',
    label: 'Wan 3.0',
    vendor: 'Alibaba Wan',
    kind: 'video',
    backend: 'api',
    summary: 'Reported #1 on the Artificial Analysis text-to-video board; native audio, up to 14 s.',
    strengths: ['overall quality', 'audio'],
    ratios: ALL_RATIOS,
    resolutions: ['480P', '720P', '1080P'],
    durations: { min: 2, max: 14, default: 5 },
    hasAudio: true,
    speed: '~1–3 min',
    cost: '≈ $0.05–0.20/s',
    defaults: { ratio: '16:9', resolution: '720P' },
    apply(g, p) {
      set(g, '3', 'model.prompt', p.prompt);
      set(g, '3', 'model.resolution', p.resolution ?? '720P');
      set(g, '3', 'model.ratio', p.ratio);
      set(g, '3', 'model.duration', String(Math.round(p.duration ?? 5)));
      set(g, '3', 'model.audio', p.audio !== false);
      set(g, '3', 'model.prompt_extend', false); // DeadChat does its own prompt enhancement
      set(g, '3', 'seed', p.seed);
    },
  },
  {
    id: 'wan30-i2v',
    label: 'Wan 3.0 · image→video',
    vendor: 'Alibaba Wan',
    kind: 'video',
    backend: 'api',
    needsImage: true,
    summary: 'Wan 3.0 animating your start image.',
    strengths: ['overall quality', 'audio'],
    ratios: ALL_RATIOS,
    resolutions: ['480P', '720P', '1080P'],
    durations: { min: 2, max: 14, default: 5 },
    hasAudio: true,
    speed: '~1–3 min',
    cost: '≈ $0.05–0.20/s',
    defaults: { ratio: '16:9', resolution: '720P' },
    apply(g, p) {
      set(g, '5', 'model.prompt', p.prompt);
      set(g, '5', 'model.resolution', p.resolution ?? '720P');
      set(g, '5', 'model.duration', String(Math.round(p.duration ?? 5)));
      set(g, '5', 'model.audio', p.audio !== false);
      set(g, '5', 'model.prompt_extend', false);
      set(g, '5', 'seed', p.seed);
      set(g, '6', 'image', p.image);
    },
  },
  {
    id: 'kling-o3-t2v',
    label: 'Kling 3 Omni',
    vendor: 'Kuaishou',
    kind: 'video',
    backend: 'api',
    summary: 'Cinematic camera work and human motion, up to 4K and 15 s.',
    strengths: ['camera moves', 'people', '4K'],
    ratios: ['16:9', '9:16', '1:1'],
    resolutions: ['720p', '1080p', '4k'],
    durations: { min: 3, max: 15, default: 5 },
    hasAudio: true,
    speed: '~2–5 min',
    defaults: { ratio: '16:9', resolution: '1080p' },
    apply(g, p) {
      set(g, '15', 'prompt', p.prompt);
      set(g, '15', 'aspect_ratio', ['16:9', '9:16', '1:1'].includes(p.ratio) ? p.ratio : '16:9');
      set(g, '15', 'duration', Math.round(p.duration ?? 5));
      set(g, '15', 'resolution', p.resolution ?? '1080p');
      set(g, '15', 'generate_audio', p.audio !== false);
      set(g, '15', 'seed', p.seed);
    },
  },
  {
    id: 'kling-o3-i2v',
    label: 'Kling 3 Omni · image→video',
    vendor: 'Kuaishou',
    kind: 'video',
    backend: 'api',
    needsImage: true,
    summary: 'Kling 3 animating your start image.',
    strengths: ['camera moves', 'people', '4K'],
    ratios: ['16:9', '9:16', '1:1'],
    resolutions: ['720p', '1080p', '4k'],
    durations: { min: 3, max: 15, default: 5 },
    hasAudio: true,
    speed: '~2–5 min',
    defaults: { ratio: '16:9', resolution: '1080p' },
    apply(g, p) {
      set(g, '21', 'prompt', p.prompt);
      set(g, '21', 'aspect_ratio', ['16:9', '9:16', '1:1'].includes(p.ratio) ? p.ratio : '16:9');
      set(g, '21', 'duration', Math.round(p.duration ?? 5));
      set(g, '21', 'resolution', p.resolution ?? '1080p');
      set(g, '21', 'generate_audio', p.audio !== false);
      set(g, '21', 'seed', p.seed);
      set(g, '17', 'image', p.image);
    },
  },
  {
    id: 'omni-flash-t2v',
    label: 'Google Omni Flash 1.1',
    vendor: 'Google',
    kind: 'video',
    backend: 'api',
    summary: 'Google’s video model (Veo line) via Gemini: realistic footage up to 4K.',
    strengths: ['realism', '4K'],
    ratios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p', '4k'],
    speed: '~1–3 min',
    defaults: { ratio: '16:9', resolution: '720p' },
    apply(g, p) {
      set(g, '26', 'model.prompt', p.prompt);
      set(g, '26', 'model.resolution', p.resolution ?? '720p');
      set(g, '26', 'model.aspect_ratio', p.ratio === '9:16' ? '9:16' : '16:9');
      set(g, '26', 'model.seed', p.seed);
    },
  },
  {
    id: 'omni-flash-i2v',
    label: 'Google Omni Flash 1.1 · image→video',
    vendor: 'Google',
    kind: 'video',
    backend: 'api',
    needsImage: true,
    summary: 'Omni Flash animating your start image.',
    strengths: ['realism', '4K'],
    ratios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p', '4k'],
    speed: '~1–3 min',
    defaults: { ratio: '16:9', resolution: '720p' },
    apply(g, p) {
      set(g, '7', 'model.prompt', `Use @Image1 as the first frame. ${p.prompt}`);
      set(g, '7', 'model.resolution', p.resolution ?? '720p');
      set(g, '7', 'model.aspect_ratio', p.ratio === '9:16' ? '9:16' : '16:9');
      set(g, '7', 'model.seed', p.seed);
      set(g, '11', 'image', p.image);
    },
  },
  {
    id: 'minimax-h3-t2v',
    label: 'MiniMax Hailuo H3 Max',
    vendor: 'MiniMax',
    kind: 'video',
    backend: 'api',
    summary: 'Strong physics and dynamic action; up to 15 s.',
    strengths: ['physics', 'action'],
    ratios: WIDE_RATIOS,
    resolutions: ['480P', '768P'],
    durations: { min: 5, max: 15, default: 5 },
    speed: '~2–5 min',
    defaults: { ratio: '16:9', resolution: '768P' },
    apply(g, p) {
      set(g, '14', 'value', p.prompt);
      set(g, '31', 'model.resolution', p.resolution ?? '768P');
      set(g, '31', 'model.ratio', p.ratio);
      set(g, '31', 'model.duration', Math.max(5, Math.round(p.duration ?? 5)));
      set(g, '31', 'model.prompt_expansion_mode', 'quality');
      set(g, '31', 'seed', p.seed);
    },
  },
  {
    id: 'minimax-h3-i2v',
    label: 'MiniMax Hailuo H3 Max · image→video',
    vendor: 'MiniMax',
    kind: 'video',
    backend: 'api',
    needsImage: true,
    summary: 'H3 Max animating your start image.',
    strengths: ['physics', 'action'],
    ratios: ALL_RATIOS,
    resolutions: ['480P', '768P'],
    durations: { min: 5, max: 15, default: 5 },
    speed: '~2–5 min',
    defaults: { ratio: '16:9', resolution: '768P' },
    apply(g, p) {
      set(g, '14', 'value', p.prompt);
      set(g, '24', 'model.resolution', p.resolution ?? '768P');
      set(g, '24', 'model.duration', Math.max(5, Math.round(p.duration ?? 5)));
      set(g, '24', 'model.prompt_expansion_mode', 'quality');
      set(g, '24', 'seed', p.seed);
      set(g, '25', 'image', p.image);
    },
  },
  {
    id: 'luma-ray33-t2v',
    label: 'Luma Ray 3',
    vendor: 'Luma',
    kind: 'video',
    backend: 'api',
    summary: 'Painterly, cinematic looks and loops; 5 or 10 s up to 1080p.',
    strengths: ['cinematic look', 'loops'],
    ratios: WIDE_RATIOS,
    resolutions: ['540p', '720p', '1080p'],
    durations: { min: 5, max: 10, default: 5 },
    speed: '~1–3 min',
    defaults: { ratio: '16:9', resolution: '720p' },
    apply(g, p) {
      set(g, '3', 'prompt', p.prompt);
      set(g, '3', 'aspect_ratio', p.ratio);
      set(g, '3', 'resolution', p.resolution ?? '720p');
      set(g, '3', 'duration', (p.duration ?? 5) > 7 ? '10s' : '5s');
      set(g, '3', 'seed', p.seed);
    },
  },
  {
    id: 'luma-ray33-i2v',
    label: 'Luma Ray 3 · image→video',
    vendor: 'Luma',
    kind: 'video',
    backend: 'api',
    needsImage: true,
    summary: 'Luma Ray animating your start image.',
    strengths: ['cinematic look'],
    ratios: ALL_RATIOS,
    resolutions: ['540p', '720p', '1080p'],
    speed: '~1–3 min',
    defaults: { ratio: '16:9', resolution: '720p' },
    apply(g, p) {
      set(g, '13', 'prompt', p.prompt);
      set(g, '13', 'resolution', p.resolution ?? '720p');
      set(g, '13', 'seed', p.seed);
      set(g, '11', 'image', p.image);
    },
  },

  // ── Cloudflare Workers AI (free daily allowance) ──
  {
    id: 'cf-flux1-schnell',
    label: 'FLUX.1 [schnell] · Cloudflare',
    vendor: 'Black Forest Labs',
    kind: 'image',
    backend: 'cloudflare',
    summary: 'Runs on Cloudflare, not your GPU: ~100–170 free images a day. Good for quick drafts while the GPU is busy.',
    strengths: ['free daily', 'speed'],
    ratios: ['1:1'],
    hasFastMode: true,
    speed: '~5–10 s',
    cost: '~60–100 of 10,000 free neurons/day',
    defaults: { ratio: '1:1' },
    cloudflare: { model: '@cf/black-forest-labs/flux-1-schnell', format: 'json', steps: { draft: 4, final: 8 }, neurons: CF_NEURONS.schnell },
    apply() {},
  },
  {
    id: 'cf-flux2-klein-9b',
    label: 'FLUX.2 [klein] 9B · Cloudflare',
    vendor: 'Black Forest Labs',
    kind: 'image',
    backend: 'cloudflare',
    summary: 'FLUX.2 quality on Cloudflare’s free daily allowance (~7 images a day).',
    strengths: ['free daily', 'quality'],
    ratios: WIDE_RATIOS,
    speed: '~5–15 s',
    cost: '~1,400 of 10,000 free neurons/day',
    defaults: { ratio: '1:1' },
    cloudflare: { model: '@cf/black-forest-labs/flux-2-klein-9b', format: 'multipart', steps: { draft: 4, final: 4 }, neurons: CF_NEURONS.klein },
    apply() {},
  },
  {
    id: 'cf-flux2-dev',
    label: 'FLUX.2 [dev] · Cloudflare',
    vendor: 'Black Forest Labs',
    kind: 'image',
    backend: 'cloudflare',
    summary: 'Full FLUX.2 [dev] without using local VRAM; the free allowance covers only a few images a day.',
    strengths: ['free daily', 'photorealism'],
    ratios: WIDE_RATIOS,
    hasFastMode: true,
    speed: '~15–40 s',
    cost: 'draft ~1,200 · final ~3,000 of 10,000 free neurons/day',
    defaults: { ratio: '1:1' },
    cloudflare: { model: '@cf/black-forest-labs/flux-2-dev', format: 'multipart', steps: { draft: 8, final: 20 }, neurons: CF_NEURONS.flux2dev },
    apply() {},
  },

  // ── Hosted images ──
  {
    id: 'nano-banana-21',
    label: 'Nano Banana 2.1',
    vendor: 'Google',
    kind: 'image',
    backend: 'api',
    summary: 'Gemini image model with reasoning: very accurate on complex, multi-part prompts.',
    strengths: ['prompt adherence', 'reasoning', 'text'],
    ratios: WIDE_RATIOS,
    resolutions: ['1K', '2K', '4K'],
    speed: '~10–30 s',
    defaults: { ratio: '1:1', resolution: '2K' },
    apply(g, p) {
      set(g, '1', 'prompt', p.prompt);
      set(g, '1', 'model.aspect_ratio', p.ratio);
      set(g, '1', 'model.resolution', p.resolution ?? '2K');
      set(g, '1', 'model.thinking_level', p.fast ? 'MINIMAL' : 'HIGH');
      set(g, '1', 'seed', p.seed);
    },
  },
  {
    id: 'gpt-image-25',
    label: 'GPT Image 2.5',
    vendor: 'OpenAI',
    kind: 'image',
    backend: 'api',
    summary: 'OpenAI’s image model: excellent instruction following and in-image text.',
    strengths: ['instruction following', 'text', 'design'],
    ratios: ['1:1', '16:9', '9:16'],
    hasFastMode: true,
    speed: '~20–60 s',
    defaults: { ratio: '1:1' },
    apply(g, p) {
      const size = p.ratio === '16:9' ? '2048x1152' : p.ratio === '9:16' ? '1152x2048' : '2048x2048';
      set(g, '271', 'prompt', p.prompt);
      set(g, '271', 'model.size', p.fast ? 'auto' : size);
      set(g, '271', 'model.quality', p.fast ? 'low' : 'high');
      set(g, '271', 'seed', p.seed);
    },
  },
  {
    id: 'seedream-50-pro',
    label: 'Seedream 5.0 Pro',
    vendor: 'ByteDance',
    kind: 'image',
    backend: 'api',
    summary: 'ByteDance’s flagship image model; 2K output, strong aesthetics and posters.',
    strengths: ['aesthetics', 'posters', '2K'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    speed: '~15–40 s',
    defaults: { ratio: '1:1' },
    apply(g, p) {
      const preset: Record<string, string> = {
        '1:1': '(2K) 2048x2048 (1:1)', '16:9': '(2K) 2848x1600 (16:9)', '9:16': '(2K) 1600x2848 (9:16)',
        '4:3': '(2K) 2304x1728 (4:3)', '3:4': '(2K) 1728x2304 (3:4)',
      };
      set(g, '3', 'prompt', p.prompt);
      set(g, '3', 'model.size_preset', preset[p.ratio] ?? preset['1:1']);
      set(g, '3', 'model.prompt_optimization', 'standard');
      set(g, '3', 'model.seed', p.seed);
    },
  },
  {
    id: 'flux2-max',
    label: 'FLUX.2 [max]',
    vendor: 'Black Forest Labs',
    kind: 'image',
    backend: 'api',
    summary: 'BFL’s top hosted model; the best FLUX quality without using local VRAM.',
    strengths: ['photorealism', 'detail'],
    ratios: WIDE_RATIOS,
    speed: '~10–30 s',
    defaults: { ratio: '1:1' },
    apply(g, p) {
      const [w, h] = sizeOf(SIZE_1MP, p.ratio);
      set(g, '23', 'prompt', p.prompt);
      set(g, '23', 'model.width', Math.min(2048, Math.round((w * 1.5) / 32) * 32));
      set(g, '23', 'model.height', Math.min(2048, Math.round((h * 1.5) / 32) * 32));
      set(g, '23', 'seed', p.seed);
    },
  },
  {
    id: 'ideogram-45',
    label: 'Ideogram 4.5',
    vendor: 'Ideogram',
    kind: 'image',
    backend: 'api',
    summary: 'Typography specialist: logos, posters and precise lettering.',
    strengths: ['typography', 'graphic design'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    speed: '~10–30 s',
    defaults: { ratio: '1:1' },
    apply(g, p) {
      const size: Record<string, string> = {
        '1:1': '(2K) 2048x2048 (1:1)', '16:9': '(2K) 2560x1440 (16:9)', '9:16': '(2K) 1440x2560 (9:16)',
        '4:3': '(2K) 2304x1728 (4:3)', '3:4': '(2K) 1728x2304 (3:4)',
      };
      set(g, '1', 'model.prompt', p.prompt);
      set(g, '1', 'model.size', size[p.ratio] ?? 'auto');
      set(g, '1', 'model.quality', p.fast ? 'low' : 'high');
      set(g, '1', 'model.magic_prompt', 'off');
      set(g, '1', 'model.seed', p.seed);
    },
  },
  {
    id: 'recraft-41',
    label: 'Recraft V4.1',
    vendor: 'Recraft',
    kind: 'image',
    backend: 'api',
    summary: 'Design-oriented: illustrations, brand graphics, consistent styles.',
    strengths: ['illustration', 'brand style'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    speed: '~10–20 s',
    defaults: { ratio: '1:1' },
    apply(g, p) {
      const size: Record<string, string> = {
        '1:1': '1024x1024', '16:9': '1344x768', '9:16': '768x1344', '4:3': '1216x896', '3:4': '896x1216',
      };
      set(g, '12', 'prompt', p.prompt);
      if (p.negative) set(g, '12', 'negative_prompt', p.negative);
      set(g, '12', 'model.size', size[p.ratio] ?? '1024x1024');
      set(g, '12', 'seed', p.seed);
    },
  },
];

const GRAPHS = workflows as unknown as Record<string, Graph>;

export function getMediaModel(id: string): MediaModel | undefined {
  return MEDIA_MODELS.find((m) => m.id === id);
}

/** Clamp/fill request parameters to what `model` supports. */
export function resolveParams(model: MediaModel, params: Partial<MediaParams> & { prompt: string }): MediaParams {
  const ratio = params.ratio && model.ratios.includes(params.ratio) ? params.ratio : model.defaults.ratio;
  const resolution =
    params.resolution && model.resolutions?.includes(params.resolution) ? params.resolution : model.defaults.resolution;
  const d = model.durations;
  const duration = d ? Math.min(d.max, Math.max(d.min, params.duration ?? d.default)) : undefined;
  return {
    prompt: params.prompt,
    negative: params.negative,
    seed: Number.isFinite(params.seed) ? Math.abs(Math.floor(params.seed!)) % SEED_MAX : Math.floor(Math.random() * SEED_MAX),
    ratio,
    resolution,
    duration,
    fast: params.fast,
    image: params.image,
    audio: params.audio,
  };
}

/** Build a ready-to-queue ComfyUI API graph for `model` with `params`. */
export function buildGraph(model: MediaModel, params: Partial<MediaParams> & { prompt: string }): Graph {
  if (model.backend === 'cloudflare') throw new Error(`${model.label} runs on Cloudflare, not ComfyUI`);
  const base = GRAPHS[model.id];
  if (!base) throw new Error(`No workflow for ${model.id}`);
  if (model.needsImage && !params.image) throw new Error(`${model.label} needs a start image`);
  const g = JSON.parse(JSON.stringify(base)) as Graph;
  model.apply(g, resolveParams(model, params));
  return g;
}

/** Pick the catalog ratio closest to a width/height pair (legacy API callers). */
export function ratioFromSize(width?: number, height?: number): Ratio {
  if (!width || !height) return '1:1';
  const r = width / height;
  const opts: Array<[Ratio, number]> = [['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3], ['3:4', 3 / 4], ['21:9', 21 / 9]];
  return opts.reduce((best, cur) => (Math.abs(cur[1] - r) < Math.abs(best[1] - r) ? cur : best))[0];
}
