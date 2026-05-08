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

const app = express();

// Global middleware
app.use(cors());
// 32mb body limit accommodates Claude Code / Anthropic SDK payloads, which
// can be large with prompt context + tool definitions.
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));

// Serve uploaded files statically
app.use('/uploads', express.static(path.resolve(config.uploadDir)));

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

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler
app.use(errorHandler);

export default app;
