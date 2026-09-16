/**
 * The single workspace of the signed-in account.
 *
 * v0.1 is a one person application. The server keeps the workspace in its
 * API paths, but the interface never shows the concept: there is no switcher,
 * no create screen, no settings screen, and no role. The provider in
 * `app.tsx` resolves the one workspace once; this module only redirects the
 * root address onto it.
 */
import { useEffect, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Button, LoadingState, Page, PageHeader } from '@notesapp/ui';
import { useWorkspace } from '../app.tsx';

/**
 * Sends the root address to the note list.
 *
 * This screen has no sidebar and no rail: it is only the step between sign-in
 * and the notes of the one workspace.
 */
export function WorkspaceHome(): ReactNode {
  const { state, reload } = useWorkspace();
  const navigate = useNavigate();

  useEffect(() => {
    if (state.status === 'ready')
      void navigate(`/w/${state.workspaceId}`, { replace: true });
  }, [state, navigate]);

  if (state.status === 'error')
    return (
      <Page>
        <PageHeader title="Your notes did not open" />
        <p className="text-control text-danger" role="alert">
          {state.message}
        </p>
        <Button variant="secondary" onClick={() => reload()}>
          Try again
        </Button>
      </Page>
    );

  return (
    <Page>
      <LoadingState label="Your notes are opening." />
    </Page>
  );
}

/**
 * Keeps the shell on the one workspace of this account.
 *
 * An address that names another workspace, for example an old bookmark, goes
 * to the current one instead of showing an error the person cannot act on.
 */
export function RequireCurrentWorkspace({
  workspaceId,
  children,
}: {
  readonly workspaceId: string;
  readonly children: ReactNode;
}): ReactNode {
  const { state } = useWorkspace();
  if (state.status === 'ready' && state.workspaceId !== workspaceId)
    return <Navigate to={`/w/${state.workspaceId}`} replace />;
  return children;
}
