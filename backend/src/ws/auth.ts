import { IncomingMessage } from 'http';
import url from 'url';
import { verifyToken, AccessTokenPayload } from '../services/auth';

export interface WsUser {
  id: number;
  username: string;
  role: string;
}

export function authenticateWs(request: IncomingMessage): WsUser | null {
  try {
    const parsed = url.parse(request.url || '', true);
    const token = parsed.query.token as string;

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
