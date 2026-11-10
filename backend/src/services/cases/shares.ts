// Sharing medical cases with other members.

import db from '../../db/connection';
import { hasTab } from '../tabs';

export type ShareRole = 'viewer' | 'editor';
export type Access = 'owner' | ShareRole;
const RANK: Record<Access, number> = { viewer: 1, editor: 2, owner: 3 };

export const atLeast = (have: Access | null, need: Access): boolean => !!have && RANK[have] >= RANK[need];

/** What `user` may do with case `caseId` (owned by `ownerId`). Admins act as owners. */
export function accessTo(caseId: number, ownerId: number, user: { id: number; role: string }): Access | null {
  if (user.id === ownerId || user.role === 'admin') return 'owner';
  const r = db.prepare('SELECT role FROM case_shares WHERE case_id = ? AND user_id = ?').get(caseId, user.id) as { role: ShareRole } | undefined;
  return r?.role ?? null;
}

export interface Share {
  userId: number;
  username: string;
  role: ShareRole;
  createdAt: string;
  /** False when the member can't open Medical cases right now (section not assigned). */
  canOpen: boolean;
}

export function listShares(caseId: number): Share[] {
  const rows = db
    .prepare('SELECT s.user_id, u.username, s.role, s.created_at FROM case_shares s JOIN users u ON u.id = s.user_id WHERE s.case_id = ? ORDER BY u.username COLLATE NOCASE')
    .all(caseId) as Array<{ user_id: number; username: string; role: ShareRole; created_at: string }>;
  return rows.map((r) => ({ userId: r.user_id, username: r.username, role: r.role, createdAt: r.created_at, canOpen: hasTab(r.user_id, 'cases') }));
}

export function setShare(caseId: number, ownerId: number, userId: number, role: ShareRole, by: number): void {
  if (userId === ownerId) throw new Error('The owner already has full access');
  const u = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!u) throw new Error('No such member');
  if (role !== 'viewer' && role !== 'editor') throw new Error('Role must be viewer or editor');
  db.prepare(
    `INSERT INTO case_shares (case_id, user_id, role, shared_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(case_id, user_id) DO UPDATE SET role = excluded.role`,
  ).run(caseId, userId, role, by);
}

export function removeShare(caseId: number, userId: number): void {
  db.prepare('DELETE FROM case_shares WHERE case_id = ? AND user_id = ?').run(caseId, userId);
}

/** Cases shared with `userId`, with the owner's name and the role. */
export function sharedWith(userId: number): Array<{ caseId: number; role: ShareRole; owner: string }> {
  return (
    db
      .prepare('SELECT s.case_id, s.role, u.username AS owner FROM case_shares s JOIN medical_cases c ON c.id = s.case_id JOIN users u ON u.id = c.user_id WHERE s.user_id = ?')
      .all(userId) as Array<{ case_id: number; role: ShareRole; owner: string }>
  ).map((r) => ({ caseId: r.case_id, role: r.role, owner: r.owner }));
}

/** Members a case can be shared with: everyone else who can use Medical cases. */
export function shareableMembers(exceptUserId: number, q = ''): Array<{ id: number; username: string }> {
  const rows = db
    .prepare("SELECT id, username FROM users WHERE id != ? AND username LIKE ? ESCAPE '\\' ORDER BY username COLLATE NOCASE LIMIT 50")
    .all(exceptUserId, `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`) as Array<{ id: number; username: string }>;
  return rows.filter((u) => hasTab(u.id, 'cases'));
}
