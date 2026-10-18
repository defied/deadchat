import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth';
import chatRoutes from './routes/chat';
import usersRoutes from './routes/users';
import generateRoutes from './routes/generate';
import uploadRoutes from './routes/upload';
import ollamaRoutes from './routes/ollama';
import tokensRoutes from './routes/tokens';
import modelSettingsRoutes from './routes/modelSettings';
import publicApiRoutes from './routes/publicApi';
import anthropicCompatRoutes from './routes/anthropicCompat';
import agentsRoutes from './routes/agents';
import jobsRoutes from './routes/jobs';
import assetsRoutes from './routes/assets';
import charactersRoutes from './routes/characters';
import mediaRoutes from './routes/media';
import providersRoutes from './routes/providers';
import schedulesRoutes from './routes/schedules';
import comfyuiRoutes from './routes/comfyui';

const app = express();

// Global middleware
app.use(cors());
// 32mb body limit accommodates Claude Code / Anthropic SDK payloads, which
// can be large with prompt context + tool definitions.
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));

// Serve uploaded chat attachments. /api/uploads is what the UI uses (it is
// routed to the backend by both the ingress and the frontend nginx);
// /uploads is kept for older links.
// Uploads are user-controlled content on our origin: sandbox them so an
// uploaded .html/.svg can never run script in the app's context.
const uploadsStatic = express.static(path.resolve(config.uploadDir), {
  maxAge: '7d',
  index: false,
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    if (/\.(html?|svg|xml|js|mjs)$/i.test(filePath)) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
  },
});
app.use('/api/uploads', uploadsStatic);
app.use('/uploads', uploadsStatic);

// Media files are served through the /api/media route (with Range support + auth)

// Public (API-token-authed) routes — mounted first so POST /api/chat,
// /api/tags, etc. reach the Ollama-compat handlers before the JWT-authed
// web routes below.
app.use(publicApiRoutes);
app.use(anthropicCompatRoutes);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/ollama', ollamaRoutes);
app.use('/api/tokens', tokensRoutes);
app.use('/api/admin/model-settings', modelSettingsRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/characters', charactersRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/providers', providersRoutes);
app.use('/api/schedules', schedulesRoutes);
app.use('/api/comfyui', comfyuiRoutes);

// Health checks
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health/backends', async (_req, res) => {
  const { isReachable: comfyReachable } = await import('./services/comfyui');
  const { getOllamaUrl } = await import('./services/appSettings');
  const { getComfyuiUrl } = await import('./services/comfyuiSettings');
  const [comfyOk, ollamaOk] = await Promise.allSettled([
    comfyReachable(),
    fetch(`${getOllamaUrl()}/api/tags`, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok).catch(() => false),
  ]);
  res.json({
    ollama: { reachable: ollamaOk.status === 'fulfilled' && ollamaOk.value, url: getOllamaUrl() },
    comfyui: { reachable: comfyOk.status === 'fulfilled' && comfyOk.value, url: getComfyuiUrl() },
    timestamp: new Date().toISOString(),
  });
});

// Global error handler
app.use(errorHandler);

export default app;
