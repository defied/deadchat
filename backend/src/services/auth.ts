import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 12);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export interface AccessTokenPayload {
  userId: number;
  username: string;
  role: string;
}

export interface RefreshTokenPayload {
  userId: number;
  type: 'refresh';
}

export function signAccessToken(user: { id: number; username: string; role: string }): string {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role } satisfies AccessTokenPayload,
    config.jwtSecret,
    { expiresIn: config.jwtExpiry } as jwt.SignOptions
  );
}

export function signRefreshToken(user: { id: number }): string {
  return jwt.sign(
    { userId: user.id, type: 'refresh' } satisfies RefreshTokenPayload,
    config.jwtSecret,
    { expiresIn: config.refreshExpiry } as jwt.SignOptions
  );
}

export function verifyToken<T = AccessTokenPayload>(token: string): T {
  return jwt.verify(token, config.jwtSecret) as T;
}
