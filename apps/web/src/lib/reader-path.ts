/**
 * The one path under which a reader opens a published link.
 *
 * Two parts of this application need it and neither may guess it. The owner
 * surface builds the address that a person copies, and the installed worker
 * has to know that the address is not this application, so it stands aside
 * for it. The worker cannot read the owner surface, because that module
 * carries the domain rules of a link and the worker must stay small, so the
 * value lives here on its own and neither side repeats it.
 *
 * The server holds the matching value in `apps/server/src/request-log.ts`.
 * Decision 0046 states that the token of a link is a path segment and that
 * `/published/` is the whole reader boundary.
 */

/** The one path under which a reader opens a published link. */
export const readerPathPrefix = '/published/';

/** Whether one path of this origin belongs to the reader and not the app. */
export function isReaderPath(pathname: string): boolean {
  return pathname.startsWith(readerPathPrefix);
}
