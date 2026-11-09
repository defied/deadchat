// Per-user access to app sections ("tabs"). Admins have every tab. A user
// with no assignment (NULL) has every tab, so existing accounts keep working;
// an assignment is a list of the tabs they may use. Checked on every request
// from the database, so a change applies at once without signing out.

import type { Request, Response, NextFunction } from 'express';
import db from '../db/connection';
import { authenticate } from '../middleware/auth';

export const TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'agents', label: 'Agents' },
  { id: 'generate', label: 'Generate' },
  { id: 'studio', label: 'Studio' },
  { id: 'social', label: 'Social Media' },
  { id: 'screenplays', label: 'Screenplay' },
  { id: 'cases', label: 'Medical cases' },
  { id: 'api', label: 'API access' },
] as const;

export type TabId = (typeof TABS)[number]['id'];
export const ALL_TABS: TabId[] = TABS.map((t) => t.id);
const isTab = (v: unknown): v is TabId => typeof v === 'string' && (ALL_TABS as string[]).includes(v);

/** Stored value → list of tabs, or null for "all". */
export function parseTabs(raw: string | null | undefined): TabId[] | null {
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? ALL_TABS.filter((t) => v.includes(t)) : null;
  } catch {
    return null;
  }
}

/** Request body → value to store: null for "all", else a JSON list. Throws on junk. */
export function cleanTabs(v: unknown): string | null {
  if (v === null || v === 'all') return null;
  if (!Array.isArray(v) || !v.every(isTab)) throw new Error(`tabs must be "all" or a list of: ${ALL_TABS.join(', ')}`);
  return JSON.stringify(ALL_TABS.filter((t) => v.includes(t)));
}

/** The tabs a user may use right now. */
export function userTabs(userId: number): TabId[] {
  const row = db.prepare('SELECT role, tabs FROM users WHERE id = ?').get(userId) as { role: string; tabs: string | null } | undefined;
  if (!row) return [];
  if (row.role === 'admin') return [...ALL_TABS];
  return parseTabs(row.tabs) ?? [...ALL_TABS];
}

export function hasTab(userId: number, ...any: TabId[]): boolean {
  const mine = userTabs(userId);
  return any.some((t) => mine.includes(t));
}

/** Signed-in users who have at least one of `tabs`. */
export function requireTab(...tabs: TabId[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    authenticate(req, res, () => {
      if (hasTab(req.user!.id, ...tabs)) {
        next();
        return;
      }
      const names = tabs.map((t) => TABS.find((x) => x.id === t)!.label).join(' or ');
      res.status(403).json({ error: `You don’t have access to ${names}. Ask an admin.`, code: 'tab_forbidden', tabs });
    });
  };
}
