import http from 'http';
import app from './app';
import { config } from './config';
import { runMigrations } from './db/migrate';
import { getCachedOllamaUrlOverride } from './services/appSettings';
import { listBackends, startBackendMonitor } from './services/ollamaBackends';
import { createWebSocketServer } from './ws/index';
import { countMissingMediaFiles } from './services/mediaStore';
import { startWorker } from './services/worker';
import { startScheduler } from './services/scheduler';
import { startInfluencerAutomation } from './services/influencers/automation';

// Run database migrations
console.log('[startup] Running database migrations...');
runMigrations();
console.log('[startup] Migrations complete.');

// Create HTTP server
const server = http.createServer(app);

// Attach WebSocket server
createWebSocketServer(server);

// Start listening
server.listen(config.port, () => {
  console.log(`[startup] Deadchat backend running on port ${config.port}`);
  startBackendMonitor(getCachedOllamaUrlOverride);
  console.log(`[startup] Ollama backends: ${listBackends().map((b) => `${b.id}=${b.url}`).join(', ')}`);
  console.log(`[startup] Default model: ${config.ollamaModel}`);
  console.log(`[startup] ComfyUI endpoint: ${config.comfyuiUrl}`);
  console.log(`[startup] Media dir: ${config.mediaDir}`);
  const media = countMissingMediaFiles();
  if (media.missing > 0) {
    console.warn(
      `[startup] ${media.missing} of ${media.total} media files are missing from ${config.mediaDir}. ` +
        'If that number grows after restarts, MEDIA_DIR is not on persistent storage.',
    );
  }
  console.log(`[startup] Database: ${config.dbPath}`);
  console.log(`[startup] WebSocket available at ws://localhost:${config.port}/ws`);

  if (config.runWorker) {
    startWorker();
    startScheduler();
    startInfluencerAutomation();
  } else {
    console.log('[startup] Worker/scheduler disabled (RUN_WORKER=false)');
  }
});
