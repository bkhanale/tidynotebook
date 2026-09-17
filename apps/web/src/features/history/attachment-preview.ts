/**
 * What the History pane states about the picture of one version.
 *
 * A read that failed and a version that holds no picture are two different
 * things, and the pane said the same words for both: "This version has no
 * picture on this device." A version that does hold a picture therefore read
 * as a version without one, so the screen stated something false about the
 * saved work. Decision 0038 refuses that shape, and this module is the rule
 * that keeps the two apart.
 *
 * `history.tsx` holds the state and renders the answer. Nothing here touches
 * the network or the document, so `./attachment-preview.test.ts` holds every
 * rule.
 */

/** Where the picture of one version stands. */
export type AttachmentPreview =
  /** No version is open, so nothing was asked for. */
  | { readonly status: 'idle' }
  /** The picture of this version is on its way. */
  | { readonly status: 'loading'; readonly revisionId: string }
  /** The picture of this version is here. */
  | {
      readonly status: 'ready';
      readonly revisionId: string;
      readonly url: string;
    }
  /** The read of the picture of this version failed. */
  | { readonly status: 'failed'; readonly revisionId: string };

/** The first state, before any version opens. */
export const idleAttachmentPreview: AttachmentPreview = { status: 'idle' };

/** What the pane draws for one version. */
export type AttachmentPreviewView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'picture'; readonly url: string }
  | { readonly kind: 'failed' };

/**
 * What the pane draws for `revisionId`.
 *
 * A state that names another version belongs to a version the person left, so
 * this one is still on its way. A failed read is its own answer and never an
 * empty one.
 */
export function attachmentPreviewView(
  preview: AttachmentPreview,
  revisionId: string,
): AttachmentPreviewView {
  if (preview.status === 'idle') return { kind: 'loading' };
  if (preview.revisionId !== revisionId) return { kind: 'loading' };
  if (preview.status === 'ready') return { kind: 'picture', url: preview.url };
  if (preview.status === 'failed') return { kind: 'failed' };
  return { kind: 'loading' };
}

/** The sentence of a picture that did not load. */
export const attachmentPreviewFailedMessage =
  'The picture of this version did not load. Check your connection and open the version again.';
