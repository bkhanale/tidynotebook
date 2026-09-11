/**
 * Authenticated attachment bytes as local object URLs.
 *
 * A note stores an immutable attachment revision ID in its Markdown, for
 * example `/attachments/<revision-uuid>`. This module resolves that ID to
 * bytes the editor can show: it calls the generated `getAttachmentRevision`
 * operation, wraps the returned binary in a local blob URL, and revokes that
 * URL when the widget closes. An old revision ID loads its own bytes, so
 * replacing a file never changes an image in historic content.
 *
 * What this module never does:
 *
 * - It never builds a request URL or calls a transport by hand. The generated
 *   client owns serialization, and cancellation travels through its `signal`
 *   option.
 * - It never proxies an external image through the server and never fetches
 *   an arbitrary external URL. External images stay placeholders until an
 *   explicit user action, and importing one means the user supplies the bytes
 *   (paste or file picker) through the upload operation instead.
 * - It never leaks object URLs. Every successful load returns `dispose`, and
 *   the editor calls it when the widget unmounts or its revision changes.
 */
import { getAttachmentRevision } from '@notesapp/api-client';

/** One loaded attachment with its revocation action. */
export type LoadedAttachment = {
  /** The local blob URL an `<img>` element can show. */
  readonly url: string;
  /** Revokes the URL. Safe to call more than once. */
  readonly dispose: () => void;
};

/** Loads one immutable attachment revision of the bound workspace. */
export type AttachmentLoader = {
  readonly loadAttachment: (
    revisionId: string,
    signal: AbortSignal,
  ) => Promise<LoadedAttachment>;
};

/** Reads the stable application error code of a failed generated call. */
function problemCode(error: unknown): string {
  if (error === null || typeof error !== 'object') return '';
  const code: unknown = Object.fromEntries(Object.entries(error))['code'];
  return typeof code === 'string' ? code : '';
}

/**
 * Loads one binary attachment revision through the generated operation.
 *
 * The workspace travels explicitly because attachment revision IDs are only
 * unique inside their workspace. Rejects with the server problem code when
 * the revision is unknown, purged, or outside this workspace.
 */
export async function loadAttachmentBinary(
  workspaceId: string,
  revisionId: string,
  signal: AbortSignal,
): Promise<LoadedAttachment> {
  const result = await getAttachmentRevision({
    path: { workspaceId, revisionId },
    signal,
  });
  if (result.error !== undefined || result.data === undefined)
    throw new Error(
      `notesapp attachment ${problemCode(result.error) === '' ? 'unavailable' : problemCode(result.error)}: revision ${revisionId} did not load`,
    );
  const body: Blob = result.data;
  const url = URL.createObjectURL(body);
  let revoked = false;
  return {
    url,
    dispose: (): void => {
      if (!revoked) {
        revoked = true;
        URL.revokeObjectURL(url);
      }
    },
  };
}

/**
 * Binds one workspace to the loader signature the editor uses.
 *
 * The returned `loadAttachment` takes only the revision ID and the signal,
 * so widgets can resolve old revision selections without knowing the
 * workspace plumbing. Each call creates its own object URL with its own
 * `dispose`.
 */
export function createAttachmentLoader(workspaceId: string): AttachmentLoader {
  return {
    loadAttachment: (revisionId: string, signal: AbortSignal) =>
      loadAttachmentBinary(workspaceId, revisionId, signal),
  };
}
