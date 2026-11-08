import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { Home, TabRoute } from './components/TabRoute';
import { Loading } from './components/ui';

// Route-level code splitting: the admin dashboards, generator and their chart
// libraries are only downloaded when visited.
const ChatPage = lazy(() => import('./pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const AgentsPage = lazy(() => import('./pages/AgentsPage').then((m) => ({ default: m.AgentsPage })));
const GeneratePage = lazy(() => import('./pages/GeneratePage').then((m) => ({ default: m.GeneratePage })));
const StudioPage = lazy(() => import('./pages/StudioPage').then((m) => ({ default: m.StudioPage })));
const SocialPage = lazy(() => import('./pages/SocialPage').then((m) => ({ default: m.SocialPage })));
const InfluencerPage = lazy(() => import('./pages/InfluencerPage').then((m) => ({ default: m.InfluencerPage })));
const ScreenplaysPage = lazy(() => import('./pages/ScreenplaysPage').then((m) => ({ default: m.ScreenplaysPage })));
const ScreenplayPage = lazy(() => import('./pages/ScreenplayPage').then((m) => ({ default: m.ScreenplayPage })));
const CasesPage = lazy(() => import('./pages/CasesPage').then((m) => ({ default: m.CasesPage })));
const CasePage = lazy(() => import('./pages/CasePage').then((m) => ({ default: m.CasePage })));
const TokensPage = lazy(() => import('./pages/TokensPage').then((m) => ({ default: m.TokensPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('React Error Boundary caught:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <h2 style={{ color: 'var(--color-danger)' }}>Something broke on this page</h2>
          <p style={{ color: 'var(--color-text-secondary)', margin: '8px 0 16px' }}>{this.state.error.message}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--color-text-dim)' }}>Details</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--color-text-dim)' }}>{this.state.error.stack}</pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<Home />} />
            {/* One route for both so the page stays mounted when a new chat gets its id. */}
            <Route path="/chat/:sessionId?" element={<TabRoute tab="chat"><Page><ChatPage /></Page></TabRoute>} />
            <Route path="/agents" element={<TabRoute tab="agents"><Page><AgentsPage /></Page></TabRoute>} />
            <Route path="/generate" element={<Navigate to="/generate/create" replace />} />
            <Route path="/generate/:tab" element={<TabRoute tab="generate"><Page><GeneratePage /></Page></TabRoute>} />
            <Route path="/studio" element={<TabRoute tab="studio"><Page><StudioPage /></Page></TabRoute>} />
            <Route path="/social" element={<TabRoute tab="social"><Page><SocialPage /></Page></TabRoute>} />
            <Route path="/social/:id/:step?" element={<TabRoute tab="social"><Page><InfluencerPage /></Page></TabRoute>} />
            <Route path="/screenplays" element={<TabRoute tab="screenplays"><Page><ScreenplaysPage /></Page></TabRoute>} />
            <Route path="/screenplays/:id" element={<Navigate to="script" replace />} />
            <Route path="/screenplays/:id/:tab" element={<TabRoute tab="screenplays"><Page><ScreenplayPage /></Page></TabRoute>} />
            <Route path="/cases" element={<TabRoute tab="cases"><Page><CasesPage /></Page></TabRoute>} />
            <Route path="/cases/:id" element={<Navigate to="overview" replace />} />
            <Route path="/cases/:id/:tab" element={<TabRoute tab="cases"><Page><CasePage /></Page></TabRoute>} />
            <Route path="/tokens" element={<TabRoute tab="api"><Page><TokensPage /></Page></TabRoute>} />
            <Route
              path="/admin/:tab?"
              element={
                <ProtectedRoute adminOnly>
                  <Page><AdminPage /></Page>
                </ProtectedRoute>
              }
            />
            {/* Old paths */}
            <Route path="/assets" element={<Navigate to="/studio" replace />} />
            <Route path="*" element={<Page><NotFoundPage /></Page>} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

/** Per-page boundary + suspense so one broken page doesn't take down navigation. */
function Page({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>{children}</Suspense>
    </ErrorBoundary>
  );
}
