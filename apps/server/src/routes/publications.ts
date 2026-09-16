/**
 * The owner operations of a published link.
 *
 * These operations keep the session security of the document, so the identity
 * hook runs before a handler here and an anonymous call is refused at the
 * boundary.
 *
 * The publication store of plan 007 items 14 to 19 is not part of this build,
 * so this deployment cannot make, list or revoke a link. Each handler says so
 * in the way that every other area of this server says it: the store is
 * missing, so the call fails. See `missingStore` in `handlers.ts`.
 */
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';

/** The publication store that the storage wave supplies. */
function missingPublicationStore(): Promise<HandlerResult> {
  return Promise.reject(
    new Error('notesapp: the server was built without a publication store.'),
  );
}

/** Builds the owner handlers of a published link. */
export function createPublicationHandlers(): HandlerMap {
  return {
    createPublishedLink: missingPublicationStore,
    listPublishedLinks: missingPublicationStore,
    revokePublishedLink: missingPublicationStore,
  };
}
