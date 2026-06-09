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

// LTX-Video (distilled): UNETLoader + CLIPLoader(ltxv/T5-XXL) + LTXV-specific nodes.
// VAE=ltxv-vae.safetensors, CLIP1=t5xxl_fp8_e4m3fn.safetensors, FRAMES=65, FPS=24.
// Distilled model: cfg≈1.0, steps≈8.
const DEFAULT_LTXV_WORKFLOW = '{"1":{"inputs":{"unet_name":"%MODEL%","weight_dtype":"default"},"class_type":"UNETLoader"},"2":{"inputs":{"clip_name":"%CLIP1%","type":"ltxv"},"class_type":"CLIPLoader"},"3":{"inputs":{"text":"%PROMPT%","clip":["2",0]},"class_type":"CLIPTextEncode"},"4":{"inputs":{"text":"low quality, blurry, distorted, watermark","clip":["2",0]},"class_type":"CLIPTextEncode"},"5":{"inputs":{"positive":["3",0],"negative":["4",0],"frame_rate":%FPS%},"class_type":"LTXVConditioning"},"6":{"inputs":{"width":%WIDTH%,"height":%HEIGHT%,"length":%FRAMES%,"batch_size":1},"class_type":"EmptyLTXVLatentVideo"},"7":{"inputs":{"model":["1",0],"max_shift":2.05,"base_shift":0.95},"class_type":"ModelSamplingLTXV"},"8":{"inputs":{"steps":%STEPS%,"max_shift":2.05,"base_shift":0.95,"stretch":true,"terminal":0.1},"class_type":"LTXVScheduler"},"9":{"inputs":{"noise_seed":%SEED%},"class_type":"RandomNoise"},"10":{"inputs":{"model":["7",0],"positive":["5",0],"negative":["5",1],"cfg":%CFG%},"class_type":"CFGGuider"},"11":{"inputs":{"sampler_name":"euler"},"class_type":"KSamplerSelect"},"12":{"inputs":{"noise":["9",0],"guider":["10",0],"sampler":["11",0],"sigmas":["8",0],"latent_image":["6",0]},"class_type":"SamplerCustomAdvanced"},"13":{"inputs":{"vae_name":"%VAE%"},"class_type":"VAELoader"},"14":{"inputs":{"samples":["12",0],"vae":["13",0],"tile_size":512,"overlap":64,"temporal_size":64,"temporal_overlap":8},"class_type":"VAEDecodeTiled"},"15":{"inputs":{"images":["14",0],"filename_prefix":"deadchat_vid","fps":%FPS%,"lossless":false,"quality":80,"method":"default"},"class_type":"SaveAnimatedWEBP"}}';

// Wan 2.1 T2V: UNETLoader + CLIPLoader(wan/UMT5-XXL) + WanImageToVideo (no start_image = T2V)
// + KSampler(euler/beta) + VAEDecodeTiled + SaveAnimatedWEBP.
// VAE=Wan2_1_VAE_bf16.safetensors, CLIP1=umt5-xxl-enc-fp8_e4m3fn.safetensors.
// FRAMES=81 (step-4 constraint: (n-1)%4==0), FPS=24, cfg≈5.0, steps≈20.
const DEFAULT_WAN_WORKFLOW = '{"1":{"inputs":{"unet_name":"%MODEL%","weight_dtype":"default"},"class_type":"UNETLoader"},"2":{"inputs":{"clip_name":"%CLIP1%","type":"wan"},"class_type":"CLIPLoader"},"3":{"inputs":{"text":"%PROMPT%","clip":["2",0]},"class_type":"CLIPTextEncode"},"4":{"inputs":{"text":"low quality, blurry, distorted, watermark, text, logo","clip":["2",0]},"class_type":"CLIPTextEncode"},"5":{"inputs":{"vae_name":"%VAE%"},"class_type":"VAELoader"},"6":{"inputs":{"positive":["3",0],"negative":["4",0],"vae":["5",0],"width":%WIDTH%,"height":%HEIGHT%,"length":%FRAMES%,"batch_size":1},"class_type":"WanImageToVideo"},"7":{"inputs":{"model":["1",0],"seed":%SEED%,"steps":%STEPS%,"cfg":%CFG%,"sampler_name":"euler","scheduler":"beta","positive":["6",0],"negative":["6",1],"latent_image":["6",2],"denoise":1.0},"class_type":"KSampler"},"8":{"inputs":{"samples":["7",0],"vae":["5",0],"tile_size":512,"overlap":64,"temporal_size":64,"temporal_overlap":8},"class_type":"VAEDecodeTiled"},"9":{"inputs":{"images":["8",0],"filename_prefix":"deadchat_vid","fps":%FPS%,"lossless":false,"quality":80,"method":"default"},"class_type":"SaveAnimatedWEBP"}}';
/* eslint-enable */

const WAN_RE = /wan/i;

type VideoBackend = 'wan' | 'ltxv';

function detectVideoBackend(modelName: string): VideoBackend {
  return WAN_RE.test(modelName) ? 'wan' : 'ltxv';
}

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
      ?? (capability === 'image' ? DEFAULT_IMAGE_WORKFLOW : DEFAULT_LTXV_WORKFLOW);
    this.defaultModel = (providerConfig.defaultModel as string | undefined)
      ?? (capability === 'image' ? 'flux1-schnell-fp8.safetensors' : 'ltxv-2b-0.9.8-distilled-fp8.safetensors');
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

    // Select workflow and per-backend defaults based on model name.
    let workflow = this.workflowTemplate;
    let defaultSteps: number | undefined;
    let defaultCfg: number | undefined;

    if (isVideo) {
      const backend: VideoBackend = detectVideoBackend(effectiveModel);
      if (backend === 'wan') {
        workflow = DEFAULT_WAN_WORKFLOW;
        if (!extra.VAE) extra.VAE = 'Wan2_1_VAE_bf16.safetensors';
        if (!extra.CLIP1) extra.CLIP1 = 'umt5-xxl-enc-fp8_e4m3fn.safetensors';
        if (!extra.FRAMES) extra.FRAMES = '81';
        defaultSteps = 20;
        defaultCfg = 5.0;
      } else {
        // LTXV distilled: guidance-baked, low cfg and few steps needed.
        if (!extra.VAE) extra.VAE = 'ltxv-vae.safetensors';
        defaultSteps = 8;
        defaultCfg = 1.0;
      }
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
      isVideo ? 600_000 : 300_000
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
