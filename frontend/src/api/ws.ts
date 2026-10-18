// Single app-wide WebSocket used for streaming chat replies.
//
// - Reads the access token fresh on every (re)connect, and on an auth
//   rejection (close code 4001) pokes an authed REST call so the axios
//   interceptor refreshes the token before retrying.
// - Queues sends made while (re)connecting instead of silently dropping them.
// - Exposes connection status so the UI can show "reconnecting…".

import client from './client';

type MessageHandler = (data: WSEvent) => void;
export type WSStatus = 'idle' | 'connecting' | 'open' | 'closed';
type StatusHandler = (status: WSStatus) => void;

export interface WSEvent {
  type: string;
  sessionId?: number;
  [key: string]: unknown;
}

const AUTH_FAILED = 4001;

class WebSocketManager {
  private ws: WebSocket | null = null;
  private messageHandlers = new Set<MessageHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private attempts = 0;
  private queue: string[] = [];
  private _status: WSStatus = 'idle';

  get status(): WSStatus {
    return this._status;
  }

  private setStatus(s: WSStatus) {
    this._status = s;
    this.statusHandlers.forEach((h) => h(s));
  }

  /** Start (or keep) the connection alive. Safe to call repeatedly. */
  connect(): void {
    this.shouldReconnect = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.doConnect();
  }

  private doConnect(): void {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      this.setStatus('closed');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = import.meta.env.VITE_API_URL
      ? new URL(import.meta.env.VITE_API_URL).host
      : window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    this.setStatus('connecting');

    ws.onmessage = (event) => {
      let data: WSEvent;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === 'connected') {
        this.attempts = 0;
        this.setStatus('open');
        const pending = this.queue;
        this.queue = [];
        pending.forEach((m) => ws.send(m));
      }
      this.messageHandlers.forEach((handler) => handler(data));
    };

    ws.onclose = async (event) => {
      if (this.ws !== ws) return; // superseded
      this.ws = null;
      this.setStatus('closed');
      if (!this.shouldReconnect) return;

      if (event.code === AUTH_FAILED) {
        // Token expired: an authed call triggers the axios refresh flow
        // (which redirects to /login if the refresh token is also dead).
        try {
          await client.get('/api/auth/me');
        } catch {
          return;
        }
      }
      const delay = Math.min(1000 * 2 ** this.attempts, 15000);
      this.attempts++;
      this.reconnectTimer = setTimeout(() => this.doConnect(), delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  /** Send now, or queue until the socket is (re)connected. */
  send(data: unknown): void {
    const msg = JSON.stringify(data);
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this._status === 'open') {
      this.ws.send(msg);
    } else {
      this.queue.push(msg);
      this.connect();
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.queue = [];
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setStatus('idle');
  }
}

export const wsManager = new WebSocketManager();
export default wsManager;
