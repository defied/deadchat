import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { adminOnly } from '../middleware/adminOnly';
import { config } from '../config';
import {
  getComfyuiUrl,
  getComfyuiUrlOverride,
  setComfyuiUrl,
} from '../services/comfyuiSettings';

const router = Router();

// ── Public (all authenticated users) ────────────────────────────────────────

// GET /api/comfyui/status — reachability + VRAM/RAM stats
router.get('/status', authenticate, async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await fetch(`${getComfyuiUrl()}/system_stats`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) {
      res.json({ reachable: false, error: `ComfyUI responded ${r.status}` });
      return;
    }
    const data = await r.json() as Record<string, unknown>;
    res.json({ reachable: true, ...data });
  } catch (err: any) {
    res.json({ reachable: false, error: err.message });
  }
});

// ── Admin-only ───────────────────────────────────────────────────────────────

router.use(adminOnly);

// GET /api/comfyui/models — installed models by type
// Pulls the relevant loader nodes out of /object_info to give a clean summary
// instead of dumping the entire (very large) object_info payload.
router.get('/models', authenticate, async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await fetch(`${getComfyuiUrl()}/object_info`);
    if (!r.ok) {
      res.status(502).json({ error: `ComfyUI responded ${r.status}` });
      return;
    }
    const info = await r.json() as Record<string, unknown>;

    function pickList(nodeClass: string, inputKey: string): string[] {
      const node = info[nodeClass] as Record<string, unknown> | undefined;
      const required = (node?.input as Record<string, unknown>)?.required as Record<string, unknown> | undefined;
      const field = required?.[inputKey] as [string[]] | undefined;
      return field?.[0] ?? [];
    }

    res.json({
      checkpoints:  pickList('CheckpointLoaderSimple', 'ckpt_name'),
      loras:        pickList('LoraLoader', 'lora_name'),
      vae:          pickList('VAELoader', 'vae_name'),
      controlnets:  pickList('ControlNetLoader', 'control_net_name'),
      upscalers:    pickList('UpscaleModelLoader', 'model_name'),
      clip:         pickList('CLIPLoader', 'clip_name'),
      unets:        pickList('UNETLoader', 'unet_name'),
    });
  } catch (err: any) {
    res.status(502).json({ error: `Failed to connect to ComfyUI: ${err.message}` });
  }
});

// GET /api/comfyui/queue — running + pending items
router.get('/queue', authenticate, async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await fetch(`${getComfyuiUrl()}/queue`);
    if (!r.ok) { res.status(502).json({ error: `ComfyUI responded ${r.status}` }); return; }
    res.json(await r.json());
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// DELETE /api/comfyui/queue — clear queue or cancel specific prompt IDs
// Body: {} clears all; { delete: ["id1","id2"] } cancels specific items
router.delete('/queue', authenticate, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { delete?: string[] } | undefined;
  const payload = body?.delete ? { delete: body.delete } : { clear: true };
  try {
    const r = await fetch(`${getComfyuiUrl()}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) { res.status(502).json({ error: `ComfyUI responded ${r.status}` }); return; }
    res.json({ cleared: true });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/comfyui/history — completed generation history
// Optional query: ?limit=50&prompt_id=<id>
router.get('/history', authenticate, async (req: Request, res: Response): Promise<void> => {
  const promptId = req.query.prompt_id ? String(req.query.prompt_id) : null;
  const limit = req.query.limit ? `?max_items=${String(req.query.limit)}` : '';
  const url = promptId
    ? `${getComfyuiUrl()}/history/${promptId}`
    : `${getComfyuiUrl()}/history${limit}`;
  try {
    const r = await fetch(url);
    if (!r.ok) { res.status(502).json({ error: `ComfyUI responded ${r.status}` }); return; }
    res.json(await r.json());
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// DELETE /api/comfyui/history — clear history or specific items
// Body: {} clears all; { delete: ["prompt_id1"] } removes specific entries
router.delete('/history', authenticate, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { delete?: string[] } | undefined;
  const payload = body?.delete ? { delete: body.delete } : { clear: true };
  try {
    const r = await fetch(`${getComfyuiUrl()}/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) { res.status(502).json({ error: `ComfyUI responded ${r.status}` }); return; }
    res.json({ cleared: true });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/comfyui/free — unload models + free VRAM
// Body: { unload_models?: boolean, free_memory?: boolean }
router.post('/free', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { unload_models = true, free_memory = true } = req.body as {
    unload_models?: boolean;
    free_memory?: boolean;
  };
  try {
    const r = await fetch(`${getComfyuiUrl()}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models, free_memory }),
    });
    if (!r.ok) { res.status(502).json({ error: `ComfyUI responded ${r.status}` }); return; }
    res.json({ freed: true, unload_models, free_memory });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/comfyui/interrupt — cancel the currently-running generation
router.post('/interrupt', authenticate, async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await fetch(`${getComfyuiUrl()}/interrupt`, { method: 'POST' });
    if (!r.ok) { res.status(502).json({ error: `ComfyUI responded ${r.status}` }); return; }
    res.json({ interrupted: true });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/comfyui/extensions — list installed custom nodes / extensions
router.get('/extensions', authenticate, async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await fetch(`${getComfyuiUrl()}/extensions`);
    if (!r.ok) { res.status(502).json({ error: `ComfyUI responded ${r.status}` }); return; }
    res.json(await r.json());
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/comfyui/backend-url
router.get('/backend-url', authenticate, (_req: Request, res: Response): void => {
  const override = getComfyuiUrlOverride();
  res.json({
    url: getComfyuiUrl(),
    default: config.comfyuiUrl,
    isOverride: override !== null,
  });
});

// PUT /api/comfyui/backend-url — set or clear the ComfyUI URL override
// Body: { url: string | null }
router.put('/backend-url', authenticate, (req: Request, res: Response): void => {
  const raw = req.body?.url;

  if (raw === null || raw === undefined || raw === '') {
    setComfyuiUrl(null);
    res.json({
      url: getComfyuiUrl(),
      default: config.comfyuiUrl,
      isOverride: false,
      message: 'ComfyUI URL override cleared; using boot-time default',
    });
    return;
  }

  if (typeof raw !== 'string') {
    res.status(400).json({ error: 'url must be a string or null' });
    return;
  }

  const trimmed = raw.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    res.status(400).json({ error: 'url is not a valid URL' });
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    res.status(400).json({ error: 'url must use http:// or https://' });
    return;
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    res.status(400).json({ error: 'url must not contain a path' });
    return;
  }
  if (parsed.search || parsed.hash) {
    res.status(400).json({ error: 'url must not contain a query string or fragment' });
    return;
  }

  const normalised = `${parsed.protocol}//${parsed.host}`;
  setComfyuiUrl(normalised);
  res.json({
    url: normalised,
    default: config.comfyuiUrl,
    isOverride: true,
    message: `ComfyUI URL set to ${normalised}`,
  });
});

export default router;
