import http from 'http';
import app from './app';
import { config } from './config';
import { runMigrations } from './db/migrate';
import { getOllamaUrl } from './services/appSettings';
import { createWebSocketServer } from './ws/index';
import { startWorker } from './services/worker';
import { startScheduler } from './services/scheduler';

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
  console.log(`[startup] Ollama endpoint: ${getOllamaUrl()}`);
  console.log(`[startup] Default model: ${config.ollamaModel}`);
  console.log(`[startup] ComfyUI endpoint: ${config.comfyuiUrl}`);
  console.log(`[startup] Media dir: ${config.mediaDir}`);
  console.log(`[startup] Database: ${config.dbPath}`);
  console.log(`[startup] WebSocket available at ws://localhost:${config.port}/ws`);

  if (config.runWorker) {
    startWorker();
    startScheduler();
  } else {
    console.log('[startup] Worker/scheduler disabled (RUN_WORKER=false)');
  }
});
