// App sections that can be assigned to users (must match backend services/tabs.ts).

export const TABS = [
  { id: 'chat', label: 'Chat', path: '/chat' },
  { id: 'agents', label: 'Agents', path: '/agents' },
  { id: 'generate', label: 'Generate', path: '/generate' },
  { id: 'studio', label: 'Studio', path: '/studio' },
  { id: 'social', label: 'Social Media', path: '/social' },
  { id: 'screenplays', label: 'Screenplay', path: '/screenplays' },
  { id: 'cases', label: 'Medical cases', path: '/cases' },
  { id: 'api', label: 'API access', path: '/tokens' },
] as const;

export type TabId = (typeof TABS)[number]['id'];
export const ALL_TABS: TabId[] = TABS.map((t) => t.id);

/** The tab a path belongs to, if any. */
export const tabForPath = (pathname: string): TabId | undefined => TABS.find((t) => pathname === t.path || pathname.startsWith(`${t.path}/`))?.id;

export function canUse(user: { role: string; tabs?: TabId[] | null } | null, tab: TabId): boolean {
  if (!user) return false;
  if (user.role === 'admin' || !user.tabs) return true;
  return user.tabs.includes(tab);
}

/** Where to land after sign-in or on "/": the first section the user can use. */
export function homePath(user: { role: string; tabs?: TabId[] | null } | null): string | null {
  return TABS.find((t) => canUse(user, t.id))?.path ?? null;
}
