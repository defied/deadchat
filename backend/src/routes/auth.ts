import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import db from '../db/connection';
import {
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyToken,
  hashPassword as hashPw,
  RefreshTokenPayload,
} from '../services/auth';
import { authenticate } from '../middleware/auth';
import type { User, RefreshToken } from '../types/models';

const router = Router();

// POST /api/auth/login
router.post('/login', (req: Request, res: Response): void => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  // Store refresh token hash
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
  ).run(user.id, tokenHash, expiresAt);

  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
  });
});

// POST /api/auth/refresh
router.post('/refresh', (req: Request, res: Response): void => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ error: 'Refresh token is required' });
    return;
  }

  let payload: RefreshTokenPayload;
  try {
    payload = verifyToken<RefreshTokenPayload>(refreshToken);
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
    return;
  }

  if (payload.type !== 'refresh') {
    res.status(401).json({ error: 'Invalid token type' });
    return;
  }

  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const stored = db.prepare(
    'SELECT * FROM refresh_tokens WHERE token_hash = ? AND user_id = ?'
  ).get(tokenHash, payload.userId) as RefreshToken | undefined;

  if (!stored) {
    res.status(401).json({ error: 'Refresh token not found or revoked' });
    return;
  }

  if (new Date(stored.expires_at) < new Date()) {
    db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(stored.id);
    res.status(401).json({ error: 'Refresh token expired' });
    return;
  }

  // Delete old refresh token
  db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(stored.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.userId) as User | undefined;

  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  const newAccessToken = signAccessToken(user);
  const newRefreshToken = signRefreshToken(user);

  const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
  ).run(user.id, newTokenHash, newExpiresAt);

  res.json({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  });
});

// POST /api/auth/logout
router.post('/logout', authenticate, (req: Request, res: Response): void => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ? AND user_id = ?')
      .run(tokenHash, req.user!.id);
  } else {
    // Delete all refresh tokens for user
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.user!.id);
  }

  res.json({ message: 'Logged out successfully' });
});

// GET /api/auth/me
router.get('/me', authenticate, (req: Request, res: Response): void => {
  const user = db.prepare(
    'SELECT id, username, email, role, created_at FROM users WHERE id = ?'
  ).get(req.user!.id);

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({ user });
});

export default router;
