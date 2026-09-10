/**
 * Web application routes.
 *
 * The one workspace of the account keeps its identifier in the address, so a
 * note link stays stable, but no screen names the workspace. Session
 * protection wraps every private route. Login and first-run setup use the
 * only public page. The root address redirects to the note list, and that
 * redirect has no sidebar.
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
const NotesHomeView = lazy(async () => ({
  default: (await import('./features/shell.tsx')).NotesHomeView,
}));
const WorkspaceHome = lazy(async () => ({
  default: (await import('./features/workspaces.tsx')).WorkspaceHome,
}));
const HistoryView = lazy(async () => ({
  default: (await import('./features/history.tsx')).HistoryView,
}));
const TrashView = lazy(async () => ({
  default: (await import('./features/trash.tsx')).TrashView,
}));
const AttentionRoute = lazy(async () => ({
  default: (await import('./features/attention.tsx')).AttentionRoute,
}));

/** Holds a route while its deferred module loads. */
function deferred(element: ReactNode): ReactNode {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
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
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
        Page not found
      </h1>
      <p>The address names no page of this application.</p>
      <p>
        <Link to="/">Back to your notes.</Link>
      </p>
    </main>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <RequireSession>{deferred(<WorkspaceHome />)}</RequireSession>,
  },
  {
    path: '/settings',
    element: (
      <RequireSession>
        <AccountSettingsPage />
      </RequireSession>
    ),
  },
  {
    path: '/w/:workspaceId',
    element: <RequireSession>{deferred(<Shell />)}</RequireSession>,
    children: [
      { index: true, element: deferred(<NotesHomeView />) },
      { path: 'notes/:fileId', element: deferred(<NoteView />) },
      {
        path: 'notes/:fileId/history',
        element: deferred(<HistoryView />),
      },
      { path: 'trash', element: deferred(<TrashView />) },
      { path: 'attention', element: deferred(<AttentionRoute />) },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

/** The routed application. */
export function AppRouter(): ReactNode {
  return <RouterProvider router={router} />;
}
