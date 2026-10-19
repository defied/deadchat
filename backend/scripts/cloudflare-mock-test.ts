// Exercise runCloudflare against a local mock of the Workers AI REST API.
// Covers: JSON request (schnell), multipart request (FLUX.2), quota error, usage tally.
import http from 'http';
import os from 'os';
import path from 'path';

process.env.DB_PATH = path.join(os.tmpdir(), `cf-mock-${Date.now()}.db`);
process.env.CLOUDFLARE_API_BASE = 'http://127.0.0.1:8799/client/v4';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let quotaHit = false;
const seen: Array<{ url: string; type: string; body: string }> = [];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ url: req.url!, type: req.headers['content-type'] || '', body: body.slice(0, 400) });
    if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401); res.end('{"errors":[{"message":"bad token"}]}'); return; }
    if (quotaHit) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end('{"errors":[{"message":"daily free allocation of neurons exceeded"}]}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result: { image: PNG_1PX }, success: true }));
  });
});

async function main() {
  await new Promise<void>((r) => server.listen(8799, '127.0.0.1', r));
  const { runMigrations } = await import('../src/db/migrate');
  runMigrations();
  const settings = await import('../src/services/media/settings');
  const { MEDIA_MODELS, resolveParams } = await import('../src/services/media/catalog');
  const { runCloudflare } = await import('../src/services/media/cloudflare');

  settings.updateMediaSettings({ cloudflareAccountId: 'acct123', cloudflareToken: 'test-token' });
  const schnell = MEDIA_MODELS.find((m) => m.id === 'cf-flux1-schnell')!;
  const klein = MEDIA_MODELS.find((m) => m.id === 'cf-flux2-klein-9b')!;

  const a = await runCloudflare(schnell, resolveParams(schnell, { prompt: 'a red cube', fast: true, seed: 7 }));
  console.log('schnell ->', a[0].mime, a[0].bytes.length, 'bytes |', seen[0].url, '|', seen[0].type, '|', seen[0].body);
  const b = await runCloudflare(klein, resolveParams(klein, { prompt: 'a blue sphere', ratio: '16:9', seed: 9 }));
  console.log('klein   ->', b[0].mime, '|', seen[1].url, '|', seen[1].type.split(';')[0], '| has width field:', seen[1].body.includes('name="width"'));
  console.log('usage after 2 images:', settings.getCloudflareUsage());

  quotaHit = true;
  try {
    await runCloudflare(schnell, resolveParams(schnell, { prompt: 'x' }));
    console.log('ERROR: quota response did not throw');
  } catch (e) {
    console.log('quota   -> threw:', (e as Error).message);
  }
  console.log('usage after quota error:', settings.getCloudflareUsage());
  server.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
