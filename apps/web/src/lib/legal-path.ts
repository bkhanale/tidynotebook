/**
 * The one path under which the server shows a legal document (record 0140).
 *
 * The page of the terms and of the privacy notice is a document that the
 * server builds, not a screen of this application. The installed worker must
 * know that, so it stands aside for the address instead of answering it with
 * the application shell, as it does for the reader path of `reader-path.ts`.
 *
 * The server holds the matching value in `legalDocumentPath` of
 * `apps/server/src/config.ts`.
 */

/** The one path under which the server shows a legal document. */
export const legalPathPrefix = '/legal/';

/** Whether one path of this origin is a legal document and not the app. */
export function isLegalPath(pathname: string): boolean {
  return pathname.startsWith(legalPathPrefix);
}
