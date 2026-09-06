/**
 * Web application routes.
 *
 * Routes compose the shell with the account and workspace screens. Session
 * protection wraps every private route; public routes are login, invitation
 * acceptance, and the post-provider landing page.
 */
import type { ReactNode } from 'react';
import { Link, RouterProvider, createBrowserRouter } from 'react-router';
import {
  AccountSettingsPage,
  InvitePage,
  LoginPage,
  RequireSession,
  SignedInLanding,
} from './features/accounts.tsx';
import { NoteView, Shell, WorkspaceView } from './features/shell.tsx';
import { WorkspaceHome } from './features/workspaces.tsx';
import { HistoryView } from './features/history.tsx';
import { ConflictsView } from './features/conflicts.tsx';
import { PurgeView } from './features/purge.tsx';
import { OfflineStatusRoute } from './features/offline-status.tsx';
import { RecoveryRoute } from './features/recovery.tsx';

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
    element: (
      <RequireSession>
        <Shell />
      </RequireSession>
    ),
    children: [
      { index: true, element: <WorkspaceHome /> },
      { path: 'w/:workspaceId', element: <WorkspaceView /> },
      { path: 'w/:workspaceId/notes/:fileId', element: <NoteView /> },
      {
        path: 'w/:workspaceId/notes/:fileId/history',
        element: <HistoryView />,
      },
      { path: 'w/:workspaceId/conflicts', element: <ConflictsView /> },
      { path: 'w/:workspaceId/purge', element: <PurgeView /> },
      { path: 'w/:workspaceId/offline', element: <OfflineStatusRoute /> },
      { path: 'w/:workspaceId/recovery', element: <RecoveryRoute /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

/** The routed application. */
export function AppRouter(): ReactNode {
  return <RouterProvider router={router} />;
}
