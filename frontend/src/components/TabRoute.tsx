// Shows a page only to users who have its section; otherwise explains and
// links to the sections they can use. The server enforces the same rule.

import type { ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { TABS, canUse, homePath, type TabId } from '../tabs';
import { EmptyState } from './ui';

export function TabRoute({ tab, children }: { tab: TabId; children: ReactNode }) {
  const { user } = useAuth();
  if (canUse(user, tab)) return <>{children}</>;
  const mine = TABS.filter((t) => canUse(user, t.id));
  return (
    <div className="center-fill">
      <EmptyState title={`You don’t have access to ${TABS.find((t) => t.id === tab)!.label}`}>
        {mine.length ? (
          <>
            You can use:{' '}
            {mine.map((t, i) => (
              <span key={t.id}>
                {i > 0 && ' · '}
                <Link to={t.path}>{t.label}</Link>
              </span>
            ))}
            . Ask an admin if you need more.
          </>
        ) : (
          'No sections are assigned to your account yet. Ask an admin.'
        )}
      </EmptyState>
    </div>
  );
}

/** "/" goes to the first section the user can use. */
export function Home() {
  const { user } = useAuth();
  const to = homePath(user);
  return to ? <Navigate to={to} replace /> : <TabRoute tab="chat">{null}</TabRoute>;
}
