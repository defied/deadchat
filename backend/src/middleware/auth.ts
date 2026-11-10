import db from '../db/connection';
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
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  // A user with a temporary password can only reach their own auth routes
  // (who am I, change password, refresh, sign out) until they pick a new one.
  if (!req.originalUrl.startsWith('/api/auth/') && mustChangePassword(req.user.id)) {
    res.status(403).json({ error: 'Choose a new password first', code: 'password_change_required' });
    return;
  }
  next();
}

export function mustChangePassword(userId: number): boolean {
  const row = db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(userId) as { must_change_password: number } | undefined;
  return !!row?.must_change_password;
}
