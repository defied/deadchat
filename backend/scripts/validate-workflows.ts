// Validate every catalog graph against the live ComfyUI (no API key → nothing is billed).
// Each accepted prompt is removed from the queue immediately.
import { MEDIA_MODELS, buildGraph } from '../src/services/media/catalog';

const BASE = process.env.COMFY || 'http://localhost:8188';

async function main() {
  let bad = 0;
  for (const m of MEDIA_MODELS) {
    for (const variant of [{ fast: false }, { fast: true }]) {
      if (variant.fast && !m.hasFastMode) continue;
      const g = buildGraph(m, { prompt: 'validation test', image: 'example.png', ...variant });
      const r = await fetch(`${BASE}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: g, front: false }),
      });
      const body = (await r.json()) as { prompt_id?: string; error?: { message: string }; node_errors?: Record<string, { class_type: string; errors: Array<{ message: string; details: string }> }> };
      if (body.prompt_id) {
        await fetch(`${BASE}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [body.prompt_id] }) });
        console.log(`ok    ${m.id}${variant.fast ? ' (fast)' : ''}`);
      } else {
        bad++;
        const details = Object.values(body.node_errors ?? {}).flatMap((n) => n.errors.map((e) => `${n.class_type}: ${e.message} ${e.details}`));
        console.log(`FAIL  ${m.id}${variant.fast ? ' (fast)' : ''}: ${body.error?.message} ${details.join(' | ')}`);
      }
    }
  }
  console.log(bad ? `${bad} failed` : 'all graphs valid');
}

main();
