import { Request, Response, NextFunction } from 'express';
import db from '../db/connection';
import { verifyToken } from '../services/apiTokens';

export function authenticateApiToken(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization: Bearer <token> header' });
    return;
  }

  const token = header.substring(7).trim();
  const row = verifyToken(token);
  if (!row) {
    res.status(401).json({ error: 'Invalid or revoked API token' });
    return;
  }

  const user = db.prepare(
    'SELECT id, username, role FROM users WHERE id = ?'
  ).get(row.user_id) as { id: number; username: string; role: string } | undefined;
  if (!user) {
    res.status(401).json({ error: 'Token owner no longer exists' });
    return;
  }

  req.user = user;
  req.apiTokenId = row.id;
  next();
}
