/**
 * Web application routes.
 *
 * Routes compose the shell with the account and workspace screens. Session
 * protection wraps every private route; public routes are login, invitation
 * acceptance, and the post-provider landing page.
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { Link, RouterProvider, createBrowserRouter } from 'react-router';
import {
  AccountSettingsPage,
  InvitePage,
  LoginPage,
  RequireSession,
  SignedInLanding,
} from './features/accounts.tsx';
const Shell = lazy(async () => ({
  default: (await import('./features/shell.tsx')).Shell,
}));
const NoteView = lazy(async () => ({
  default: (await import('./features/shell.tsx')).NoteView,
}));
const WorkspaceView = lazy(async () => ({
  default: (await import('./features/shell.tsx')).WorkspaceView,
}));
const WorkspaceHome = lazy(async () => ({
  default: (await import('./features/workspaces.tsx')).WorkspaceHome,
}));
const HistoryView = lazy(async () => ({
  default: (await import('./features/history.tsx')).HistoryView,
}));
const ConflictsView = lazy(async () => ({
  default: (await import('./features/conflicts.tsx')).ConflictsView,
}));
const PurgeView = lazy(async () => ({
  default: (await import('./features/purge.tsx')).PurgeView,
}));
const OfflineStatusRoute = lazy(async () => ({
  default: (await import('./features/offline-status.tsx')).OfflineStatusRoute,
}));
const RecoveryRoute = lazy(async () => ({
  default: (await import('./features/recovery.tsx')).RecoveryRoute,
}));

/** Holds a route while its deferred module loads. */
function deferred(element: ReactNode): ReactNode {
  return (
    <Suspense
      fallback={
        <main>
          <p role="status">Loading this screen.</p>
        </main>
      }
    >
      {element}
    </Suspense>
  );
}

/** Shown for an address that names no route. */
function NotFoundPage(): ReactNode {
  return (
    <main>
      <h1>Page not found</h1>
      <p>The address names no page of this application.</p>
      <p>
        <Link to="/">Back to workspaces.</Link>
      </p>
    </main>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/auth/signed-in', element: <SignedInLanding /> },
  { path: '/invite', element: <InvitePage /> },
  {
    path: '/settings',
    element: (
      <RequireSession>
        <AccountSettingsPage />
      </RequireSession>
    ),
  },
  {
    path: '/',
    element: <RequireSession>{deferred(<Shell />)}</RequireSession>,
    children: [
      { index: true, element: deferred(<WorkspaceHome />) },
      { path: 'w/:workspaceId', element: deferred(<WorkspaceView />) },
      {
        path: 'w/:workspaceId/notes/:fileId',
        element: deferred(<NoteView />),
      },
      {
        path: 'w/:workspaceId/notes/:fileId/history',
        element: deferred(<HistoryView />),
      },
      {
        path: 'w/:workspaceId/conflicts',
        element: deferred(<ConflictsView />),
      },
      { path: 'w/:workspaceId/purge', element: deferred(<PurgeView />) },
      {
        path: 'w/:workspaceId/offline',
        element: deferred(<OfflineStatusRoute />),
      },
      {
        path: 'w/:workspaceId/recovery',
        element: deferred(<RecoveryRoute />),
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

/** The routed application. */
export function AppRouter(): ReactNode {
  return <RouterProvider router={router} />;
}
