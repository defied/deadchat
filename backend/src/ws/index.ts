import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { authenticateWs, WsUser } from './auth';
import { handleChatMessage, cancelGeneration } from './chatHandler';

export function createWebSocketServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, request) => {
    const user = authenticateWs(request);

    if (!user) {
      ws.close(4001, 'Authentication required');
      return;
    }

    console.log(`[ws] User connected: ${user.username} (id: ${user.id})`);

    ws.on('message', async (raw: Buffer) => {
      let data: any;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      switch (data.type) {
        case 'chat':
          await handleChatMessage(ws, user, data);
          break;
        case 'cancel':
          if (!cancelGeneration(user, Number(data.sessionId))) {
            ws.send(JSON.stringify({ type: 'error', sessionId: data.sessionId, message: 'Nothing to stop' }));
          }
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        default:
          ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${data.type}` }));
      }
    });

    ws.on('close', () => {
      console.log(`[ws] User disconnected: ${user.username} (id: ${user.id})`);
    });

    ws.on('error', (err) => {
      console.error(`[ws] Error for user ${user.username}:`, err.message);
    });

    // Send connected confirmation
    ws.send(JSON.stringify({ type: 'connected', user: { id: user.id, username: user.username } }));
  });

  // Heartbeat: terminate sockets that stop answering pings (dead proxies,
  // sleeping laptops) so we don't keep streaming into the void.
  const alive = new WeakMap<WebSocket, boolean>();
  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
  }, 30_000);
  wss.on('close', () => clearInterval(heartbeat));

  console.log('[ws] WebSocket server attached at /ws');
  return wss;
}
