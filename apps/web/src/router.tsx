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
  buttonClassName,
  ChevronLeftIcon,
  LoadingState,
  Page,
  PageHeader,
} from '@notesapp/ui';
import {
  AccountSettingsPage,
  LoginPage,
  RequireSession,
} from './features/accounts/accounts.tsx';
import { useDocumentTitle } from './shell/document-title.ts';
const Shell = lazy(async () => ({
  default: (await import('./shell/shell.tsx')).Shell,
}));
const NoteView = lazy(async () => ({
  default: (await import('./features/notes/note-view.tsx')).NoteView,
}));
const NotesHomeView = lazy(async () => ({
  default: (await import('./features/notes/notes-home.tsx')).NotesHomeView,
}));
const WorkspaceHome = lazy(async () => ({
  default: (await import('./shell/workspaces.tsx')).WorkspaceHome,
}));
const HistoryView = lazy(async () => ({
  default: (await import('./features/history/history.tsx')).HistoryView,
}));
const TrashView = lazy(async () => ({
  default: (await import('./features/trash/trash.tsx')).TrashView,
}));
const AttentionRoute = lazy(async () => ({
  default: (await import('./features/attention/attention.tsx')).AttentionRoute,
}));
const PublishedLinksView = lazy(async () => ({
  default: (await import('./features/publishing/published-links.tsx'))
    .PublishedLinksView,
}));

/** Holds a route while its deferred module loads. */
function deferred(element: ReactNode): ReactNode {
  return (
    <Suspense
      fallback={
        <Page>
          <LoadingState label="The screen is loading." />
        </Page>
      }
    >
      {element}
    </Suspense>
  );
}

/**
 * Shown for an address that names no route.
 *
 * It is a page of the application and not a bare sentence: the one page
 * frame, the one page title, one sentence and the one way out.
 */
function NotFoundPage(): ReactNode {
  useDocumentTitle('Page not found');
  return (
    <Page>
      <PageHeader title="Page not found" />
      <p className="mb-6 mt-0 text-control text-muted">
        The address names no page of this application.
      </p>
      <Link className={buttonClassName({ variant: 'secondary' })} to="/">
        <span className="inline-flex items-center" aria-hidden="true">
          <ChevronLeftIcon />
        </span>
        <span>Back to your notes</span>
      </Link>
    </Page>
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
      { path: 'published', element: deferred(<PublishedLinksView />) },
      { path: 'attention', element: deferred(<AttentionRoute />) },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

/** The routed application. */
export function AppRouter(): ReactNode {
  return <RouterProvider router={router} />;
}
