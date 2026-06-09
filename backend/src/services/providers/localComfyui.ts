import { randomUUID } from 'crypto';
import * as comfyui from '../comfyui';
import type { MediaProvider, GenerateRequest, GenerateResult } from './types';
import type { MediaCapability } from '../../types/models';

// Minimal ComfyUI workflow graphs for Flux-schnell (image) and LTX-Video (video).
// %PLACEHOLDER% tokens are replaced by fillTemplate() in comfyui.ts.
// Override via the provider's `config.workflowTemplate` DB field.

/* eslint-disable */
const DEFAULT_IMAGE_WORKFLOW = '{"6":{"inputs":{"text":"%PROMPT%","clip":["30",1]},"class_type":"CLIPTextEncode"},"8":{"inputs":{"samples":["13",0],"vae":["30",2]},"class_type":"VAEDecode"},"9":{"inputs":{"filename_prefix":"deadchat_img","images":["8",0]},"class_type":"SaveImage"},"13":{"inputs":{"noise":["25",0],"guider":["22",0],"sampler":["16",0],"sigmas":["17",0],"latent_image":["27",0]},"class_type":"SamplerCustomAdvanced"},"16":{"inputs":{"sampler_name":"euler"},"class_type":"KSamplerSelect"},"17":{"inputs":{"scheduler":"simple","steps":%STEPS%,"denoise":1,"model":["30",0]},"class_type":"BasicScheduler"},"22":{"inputs":{"model":["30",0],"conditioning":["6",0]},"class_type":"BasicGuider"},"25":{"inputs":{"noise_seed":%SEED%},"class_type":"RandomNoise"},"27":{"inputs":{"width":%WIDTH%,"height":%HEIGHT%,"batch_size":1},"class_type":"EmptySD3LatentImage"},"30":{"inputs":{"ckpt_name":"%MODEL%"},"class_type":"CheckpointLoaderSimple"}}';

const DEFAULT_VIDEO_WORKFLOW = '{"1":{"inputs":{"ckpt_name":"%MODEL%"},"class_type":"CheckpointLoaderSimple"},"2":{"inputs":{"text":"%PROMPT%","clip":["1",1]},"class_type":"CLIPTextEncode"},"3":{"inputs":{"text":"","clip":["1",1]},"class_type":"CLIPTextEncode"},"4":{"inputs":{"model":["1",0],"positive":["2",0],"negative":["3",0],"latent_image":["5",0],"seed":%SEED%,"steps":%STEPS%,"cfg":%CFG%,"sampler_name":"euler","scheduler":"karras","denoise":1},"class_type":"KSampler"},"5":{"inputs":{"width":%WIDTH%,"height":%HEIGHT%,"batch_size":1},"class_type":"EmptyLatentImage"},"6":{"inputs":{"samples":["4",0],"vae":["1",2]},"class_type":"VAEDecode"},"7":{"inputs":{"filename_prefix":"deadchat_vid","images":["6",0]},"class_type":"SaveImage"}}';
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
      ?? (capability === 'image' ? DEFAULT_IMAGE_WORKFLOW : DEFAULT_VIDEO_WORKFLOW);
    this.defaultModel = (providerConfig.defaultModel as string | undefined)
      ?? (capability === 'image' ? 'flux1-schnell-fp8.safetensors' : 'ltx-video.safetensors');
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
    const promptId = await comfyui.submitWorkflow(this.workflowTemplate, {
      prompt: req.prompt,
      seed: req.seed,
      width: req.width,
      height: req.height,
      steps: req.steps,
      cfg: req.cfg,
      model: req.model ?? this.defaultModel,
      extra: req.extra,
    }, clientId);

    const outputFiles = await comfyui.pollHistory(
      promptId,
      onProgress,
      this.capability === 'video' ? 600_000 : 300_000
    );

    const files = await Promise.all(
      outputFiles.map(async (f) => ({
        bytes: await comfyui.fetchOutputFile(f),
        mime: f.mime,
        filename: f.filename,
      }))
    );

    return { files, meta: { promptId, model: req.model ?? this.defaultModel } };
  }
}
