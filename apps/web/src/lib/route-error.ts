/**
 * What a route boundary says when a render fails (record 0161).
 *
 * Two boundaries hold a failure. The page boundary holds every page of the
 * workspace frame, so the sidebar and the header stay and the person can open
 * another page. The application boundary holds the rest: a public page, the
 * session guard and the frame itself.
 *
 * This module decides the words, the actions and the log fields from the
 * error, the boundary and the address, so the screen renders a decision and
 * decides nothing. The words never carry the message of the error, a stack, a
 * status or a code: the message of an error can hold the text of a note, and
 * none of it helps the person. The log record names the boundary, the cause
 * and the name of the error, and nothing else.
 */
import { productName } from '@notesapp/core';

/** The boundary that held the failure. */
export type RouteErrorScope = 'application' | 'page';

/**
 * Why the screen stopped.
 *
 * `load` is a module of the screen that did not arrive, which a connection or
 * a reload answers. `stop` is every other failure.
 */
export type RouteErrorCause = 'load' | 'stop';

/** What the boundary shows. */
export type RouteErrorScreen = {
  readonly title: string;
  readonly description: string;
  /**
   * Where the second action goes: the notes of the workspace. `null` when the
   * address is already there, because a link to the page that failed helps
   * nobody. Reload is always the first action.
   */
  readonly notesPath: string | null;
};

/** The label of the first action, which every boundary shows. */
export const reloadLabel = 'Reload';

/** The label of the link to the notes of the workspace. */
export const openNotesLabel = 'Open all notes';

/**
 * The words that a browser writes when a deferred module does not load.
 *
 * Chrome, Safari and Firefox each write their own sentence, and the Vite
 * preload helper writes a fourth for a style sheet of the module.
 */
const loadFailure =
  /dynamically imported module|importing a module script failed|unable to preload/i;

/** Whether the failure is a module that did not load. */
export function routeErrorCause(error: unknown): RouteErrorCause {
  if (!(error instanceof Error)) return 'stop';
  if (error.name === 'ChunkLoadError') return 'load';
  return loadFailure.test(error.message) ? 'load' : 'stop';
}

/**
 * The name of the error, for the log.
 *
 * Only a name in the shape of a class name passes. A name is code and not
 * content, but an error can carry any string in it, so anything else is
 * written as `Error`, and a value that is not an error as `unknown`.
 */
export function routeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : 'Error';
}

/** The fields of the `web.render_failed` record. */
export function routeErrorLog(
  scope: RouteErrorScope,
  error: unknown,
): {
  readonly scope: RouteErrorScope;
  readonly cause: RouteErrorCause;
  readonly errorName: string;
} {
  return {
    scope,
    cause: routeErrorCause(error),
    errorName: routeErrorName(error),
  };
}

/** The address without a trailing slash, so `/w/a/` and `/w/a` are one. */
function trimmed(pathname: string): string {
  const path = pathname.replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

/**
 * The words and the second action of one boundary.
 *
 * `workspaceId` is the workspace of the address, or `null` outside one. The
 * notes of the workspace are its index page. Outside a workspace the root
 * address opens the notes of the chosen workspace.
 */
export function routeErrorScreen(input: {
  readonly scope: RouteErrorScope;
  readonly error: unknown;
  readonly pathname: string;
  readonly workspaceId: string | null;
}): RouteErrorScreen {
  const cause = routeErrorCause(input.error);
  const page = input.scope === 'page';
  const notes = input.workspaceId === null ? '/' : `/w/${input.workspaceId}`;
  const notesPath = trimmed(input.pathname) === notes ? null : notes;
  if (cause === 'load')
    return {
      title: page ? 'This page did not load' : `${productName} did not load`,
      description: `A part of ${page ? 'this page' : productName} did not load. Make sure that the device has a connection, then reload the page.`,
      notesPath,
    };
  return {
    title: page ? 'This page stopped' : `${productName} stopped`,
    description: `An error stopped ${page ? 'this page' : productName}. Your saved work did not change. Reload the page to try again.`,
    notesPath,
  };
}
