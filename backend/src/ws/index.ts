import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { authenticateWs, WsUser } from './auth';
import { handleChatMessage } from './chatHandler';

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

  console.log('[ws] WebSocket server attached at /ws');
  return wss;
}
