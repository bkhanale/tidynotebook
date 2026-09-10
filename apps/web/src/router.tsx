/**
 * Web application routes.
 *
 * Routes compose the shell with the account and workspace screens. Session
 * protection wraps every private route. Login and first-run setup use the
 * only public page.
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { Link, RouterProvider, createBrowserRouter } from 'react-router';
import {
  AccountSettingsPage,
  LoginPage,
  RequireSession,
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
const WorkspaceCreateView = lazy(async () => ({
  default: (await import('./features/workspaces.tsx')).WorkspaceCreateView,
}));
const WorkspaceSettingsView = lazy(async () => ({
  default: (await import('./features/workspaces.tsx')).WorkspaceSettingsView,
}));
const HistoryView = lazy(async () => ({
  default: (await import('./features/history.tsx')).HistoryView,
}));
const PurgeView = lazy(async () => ({
  default: (await import('./features/purge.tsx')).PurgeView,
}));
const TrashView = lazy(async () => ({
  default: (await import('./features/trash.tsx')).TrashView,
}));
const OfflineStatusRoute = lazy(async () => ({
  default: (await import('./features/offline-status.tsx')).OfflineStatusRoute,
}));
const RecoveryRoute = lazy(async () => ({
  default: (await import('./features/recovery.tsx')).RecoveryRoute,
}));
const AttentionRoute = lazy(async () => ({
  default: (await import('./features/attention.tsx')).AttentionRoute,
}));

/** Holds a route while its deferred module loads. */
function deferred(element: ReactNode): ReactNode {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
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
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
        Page not found
      </h1>
      <p>The address names no page of this application.</p>
      <p>
        <Link to="/">Back to workspaces.</Link>
      </p>
    </main>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
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
      {
        path: 'workspaces/new',
        element: deferred(<WorkspaceCreateView />),
      },
      { path: 'w/:workspaceId', element: deferred(<WorkspaceView />) },
      {
        path: 'w/:workspaceId/settings',
        element: deferred(<WorkspaceSettingsView />),
      },
      {
        path: 'w/:workspaceId/notes/:fileId',
        element: deferred(<NoteView />),
      },
      {
        path: 'w/:workspaceId/notes/:fileId/history',
        element: deferred(<HistoryView />),
      },
      { path: 'w/:workspaceId/trash', element: deferred(<TrashView />) },
      { path: 'w/:workspaceId/purge', element: deferred(<PurgeView />) },
      {
        path: 'w/:workspaceId/offline',
        element: deferred(<OfflineStatusRoute />),
      },
      {
        path: 'w/:workspaceId/recovery',
        element: deferred(<RecoveryRoute />),
      },
      {
        path: 'w/:workspaceId/attention',
        element: deferred(<AttentionRoute />),
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

/** The routed application. */
export function AppRouter(): ReactNode {
  return <RouterProvider router={router} />;
}
