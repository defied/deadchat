import { IncomingMessage } from 'http';
import { verifyToken, AccessTokenPayload } from '../services/auth';

export interface WsUser {
  id: number;
  username: string;
  role: string;
}

export function authenticateWs(request: IncomingMessage): WsUser | null {
  try {
    const token = new URL(request.url || '', 'http://localhost').searchParams.get('token');

    if (!token) {
      return null;
    }

    const payload = verifyToken<AccessTokenPayload>(token);
    return {
      id: payload.userId,
      username: payload.username,
      role: payload.role,
    };
  } catch {
    return null;
  }
}
