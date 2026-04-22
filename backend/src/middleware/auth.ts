import { Request, Response, NextFunction } from 'express';
import { verifyToken, AccessTokenPayload } from '../services/auth';

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const payload = verifyToken<AccessTokenPayload>(token);
    req.user = {
      id: payload.userId,
      username: payload.username,
      role: payload.role,
    };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
