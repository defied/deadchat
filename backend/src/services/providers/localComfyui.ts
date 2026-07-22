import { randomUUID } from 'crypto';
import * as comfyui from '../comfyui';
import type { MediaProvider, GenerateRequest, GenerateResult } from './types';
import type { MediaCapability } from '../../types/models';

// Minimal ComfyUI workflow graphs. %PLACEHOLDER% tokens replaced by fillTemplate().
// Override per-provider via config.workflowTemplate in the DB.

/* eslint-disable */
// Flux.1-schnell: UNETLoader + DualCLIPLoader + VAELoader.
// CLIP1=t5xxl_fp8_e4m3fn.safetensors, CLIP2=clip_l.safetensors, VAE=ae.safetensors.
const DEFAULT_IMAGE_WORKFLOW = '{"6":{"inputs":{"text":"%PROMPT%","clip":["32",0]},"class_type":"CLIPTextEncode"},"8":{"inputs":{"samples":["13",0],"vae":["33",0]},"class_type":"VAEDecode"},"9":{"inputs":{"filename_prefix":"deadchat_img","images":["8",0]},"class_type":"SaveImage"},"13":{"inputs":{"noise":["25",0],"guider":["22",0],"sampler":["16",0],"sigmas":["17",0],"latent_image":["27",0]},"class_type":"SamplerCustomAdvanced"},"16":{"inputs":{"sampler_name":"euler"},"class_type":"KSamplerSelect"},"17":{"inputs":{"scheduler":"simple","steps":%STEPS%,"denoise":1,"model":["31",0]},"class_type":"BasicScheduler"},"22":{"inputs":{"model":["31",0],"conditioning":["6",0]},"class_type":"BasicGuider"},"25":{"inputs":{"noise_seed":%SEED%},"class_type":"RandomNoise"},"27":{"inputs":{"width":%WIDTH%,"height":%HEIGHT%,"batch_size":1},"class_type":"EmptySD3LatentImage"},"31":{"inputs":{"unet_name":"%MODEL%","weight_dtype":"fp8_e4m3fn"},"class_type":"UNETLoader"},"32":{"inputs":{"clip_name1":"%CLIP1%","clip_name2":"%CLIP2%","type":"flux"},"class_type":"DualCLIPLoader"},"33":{"inputs":{"vae_name":"%VAE%"},"class_type":"VAELoader"}}';

// Wan 2.2 T2V 14B (MoE: high-noise + low-noise expert models, sampled in two
// KSamplerAdvanced passes split at %STEPS_SPLIT% of %STEPS% total steps).
// Full-quality settings (no speed LoRA) per the official Comfy-Org template:
// steps=20 (10+10 split), cfg=3.5, ModelSamplingSD3 shift=5.0, fps=16.
// VAE=wan_2.1_vae.safetensors, CLIP1=umt5_xxl_fp8_e4m3fn_scaled.safetensors.
// MODEL=low-noise expert filename; MODEL_HIGH=high-noise expert filename.
// FRAMES must satisfy (n-1)%4==0 (81 is the standard default).
const DEFAULT_WAN_WORKFLOW = '{"1":{"inputs":{"unet_name":"%MODEL%","weight_dtype":"default"},"class_type":"UNETLoader"},"2":{"inputs":{"unet_name":"%MODEL_HIGH%","weight_dtype":"default"},"class_type":"UNETLoader"},"3":{"inputs":{"clip_name":"%CLIP1%","type":"wan"},"class_type":"CLIPLoader"},"4":{"inputs":{"text":"%PROMPT%","clip":["3",0]},"class_type":"CLIPTextEncode"},"5":{"inputs":{"text":"色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走，裸露，NSFW","clip":["3",0]},"class_type":"CLIPTextEncode"},"6":{"inputs":{"vae_name":"%VAE%"},"class_type":"VAELoader"},"7":{"inputs":{"model":["2",0],"shift":%SHIFT%},"class_type":"ModelSamplingSD3"},"8":{"inputs":{"model":["1",0],"shift":%SHIFT%},"class_type":"ModelSamplingSD3"},"9":{"inputs":{"width":%WIDTH%,"height":%HEIGHT%,"length":%FRAMES%,"batch_size":1},"class_type":"EmptyHunyuanLatentVideo"},"10":{"inputs":{"add_noise":"enable","noise_seed":%SEED%,"steps":%STEPS%,"cfg":%CFG%,"sampler_name":"euler","scheduler":"simple","start_at_step":0,"end_at_step":%STEPS_SPLIT%,"return_with_leftover_noise":"enable","model":["7",0],"positive":["4",0],"negative":["5",0],"latent_image":["9",0]},"class_type":"KSamplerAdvanced"},"11":{"inputs":{"add_noise":"disable","noise_seed":%SEED%,"steps":%STEPS%,"cfg":%CFG%,"sampler_name":"euler","scheduler":"simple","start_at_step":%STEPS_SPLIT%,"end_at_step":10000,"return_with_leftover_noise":"disable","model":["8",0],"positive":["4",0],"negative":["5",0],"latent_image":["10",0]},"class_type":"KSamplerAdvanced"},"12":{"inputs":{"samples":["11",0],"vae":["6",0]},"class_type":"VAEDecode"},"13":{"inputs":{"images":["12",0],"fps":%FPS%},"class_type":"CreateVideo"},"14":{"inputs":{"video":["13",0],"filename_prefix":"deadchat_vid","format":"auto","codec":"auto"},"class_type":"SaveVideo"}}';
/* eslint-enable */

export class LocalComfyuiProvider implements MediaProvider {
  readonly capability: MediaCapability;
  private workflowTemplate: string;
  private defaultModel: string;

  constructor(
    capability: MediaCapability,
    providerConfig: Record<string, unknown> = {}
  ) {
    this.capability = capability;
    this.workflowTemplate = (providerConfig.workflowTemplate as string | undefined)
      ?? (capability === 'image' ? DEFAULT_IMAGE_WORKFLOW : DEFAULT_WAN_WORKFLOW);
    this.defaultModel = (providerConfig.defaultModel as string | undefined)
      ?? (capability === 'image' ? 'flux1-schnell-fp8.safetensors' : 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors');
  }

  get id(): string {
    return `local_comfyui_${this.capability}`;
  }

  async isReachable(): Promise<boolean> {
    return comfyui.isReachable();
  }

  async listModels(): Promise<string[]> {
    return comfyui.listModels();
  }

  async generate(
    req: GenerateRequest,
    onProgress?: (p: number) => void
  ): Promise<GenerateResult> {
    const clientId = randomUUID();
    const extra: Record<string, string> = { ...req.extra };
    const isVideo = this.capability === 'video';
    const effectiveModel = req.model ?? this.defaultModel;

    const workflow = this.workflowTemplate;
    let defaultSteps: number | undefined;
    let defaultCfg: number | undefined;

    if (isVideo) {
      // Wan 2.2 T2V 14B: MoE (high-noise + low-noise expert models). Full-quality
      // settings per the official Comfy-Org template - see DEFAULT_WAN_WORKFLOW comment.
      // The workflow graph only works with Wan checkpoints; anything else (e.g. a
      // leftover LTX-Video model from a stale provider config) silently produces a
      // broken hybrid graph instead of erroring, so reject it up front.
      if (!/wan/i.test(effectiveModel)) {
        throw new Error(
          `Video model "${effectiveModel}" is not a Wan 2.2 checkpoint. Only Wan T2V models are supported by the current video workflow.`
        );
      }
      if (!extra.VAE) extra.VAE = 'wan_2.1_vae.safetensors';
      if (!extra.CLIP1) extra.CLIP1 = 'umt5_xxl_fp8_e4m3fn_scaled.safetensors';
      if (!extra.FRAMES) extra.FRAMES = '81';
      if (!extra.FPS) extra.FPS = '16';
      if (!extra.SHIFT) extra.SHIFT = '5.0';
      if (!extra.STEPS_SPLIT) extra.STEPS_SPLIT = '10';
      if (!extra.MODEL_HIGH) {
        extra.MODEL_HIGH = effectiveModel.includes('low_noise')
          ? effectiveModel.replace('low_noise', 'high_noise')
          : 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors';
      }
      defaultSteps = 20;
      defaultCfg = 3.5;
    }

    const promptId = await comfyui.submitWorkflow(workflow, {
      prompt: req.prompt,
      seed: req.seed,
      width: req.width,
      height: req.height,
      steps: req.steps ?? defaultSteps,
      cfg: req.cfg ?? defaultCfg,
      model: effectiveModel,
      extra,
    }, clientId);

    const outputFiles = await comfyui.pollHistory(
      promptId,
      onProgress,
      // Full-quality Wan 2.2 14B (two 14B experts, 20 steps) benchmarks at
      // ~530s on an RTX 4090 at 640x640 - 600s was too tight, give real headroom.
      isVideo ? 1_200_000 : 300_000
    );

    const files = await Promise.all(
      outputFiles.map(async (f) => ({
        bytes: await comfyui.fetchOutputFile(f),
        mime: f.mime,
        filename: f.filename,
      }))
    );

    return { files, meta: { promptId, model: effectiveModel } };
  }
}
