import http from 'http';
import app from './app';
import { config } from './config';
import { runMigrations } from './db/migrate';
import { createWebSocketServer } from './ws/index';

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
  console.log(`[startup] Ollama endpoint: ${config.ollamaUrl}`);
  console.log(`[startup] Default model: ${config.ollamaModel}`);
  console.log(`[startup] Database: ${config.dbPath}`);
  console.log(`[startup] WebSocket available at ws://localhost:${config.port}/ws`);
});
