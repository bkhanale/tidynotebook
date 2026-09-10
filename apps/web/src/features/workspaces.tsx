/**
 * The single workspace of the signed-in account.
 *
 * v0.1 is a one person application. The server keeps the workspace in its
 * API paths, but the interface never shows the concept: there is no switcher,
 * no create screen, no settings screen, and no role. The provider in
 * `app.tsx` resolves the one workspace once; this module only redirects the
 * root address onto it and validates a note name.
 */
import { useEffect, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { normalizePath } from '@notesapp/core';
import { Button, StatusRegion } from '@notesapp/ui';
import { useWorkspace } from '../app.tsx';

/** Validates a new note path with the shared domain rule. */
export function validateNotePath(input: string): string | null {
  const result = normalizePath(input);
  if (result.ok) return null;
  if (result.error.code === 'invalid_path')
    return 'Use a note name without empty folders, traversal, or edge spaces.';
  return `This note name is refused: ${result.error.code}.`;
}

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
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          Your notes did not open
        </h1>
        <p className="text-control text-danger" role="alert">
          {state.message}
        </p>
        <Button variant="secondary" onClick={() => reload()}>
          Try again
        </Button>
      </main>
    );

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <StatusRegion message="Opening your notes." />
    </main>
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
