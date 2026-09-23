/** The identity of the note that one loader result describes. */
export type NoteLoadIdentity = {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly fileId: string;
};

/** The loading states of one note before its editor mounts. */
export type NoteLoadStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'purged' }
  | { readonly kind: 'deleted'; readonly path: string }
  | { readonly kind: 'unavailable'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly path: string;
      readonly text: string;
      readonly headRevisionId: string | null;
      readonly workingCopyId?: string | undefined;
      readonly sequence: number;
      /**
       * The document of the note on this device, or `null` when this device
       * holds none yet (record 0081). The editor binds to it.
       */
      readonly document?: Uint8Array | null | undefined;
    };

/** A loader result and the note that owns it. */
export type NoteLoadState = {
  readonly identity: NoteLoadIdentity;
  readonly status: NoteLoadStatus;
};

/** Whether two loader identities name the same note in the same scope. */
function isSameNote(
  first: NoteLoadIdentity,
  second: NoteLoadIdentity,
): boolean {
  return (
    first.accountId === second.accountId &&
    first.workspaceId === second.workspaceId &&
    first.fileId === second.fileId
  );
}

/** Gives a loader result only to the note that owns it. */
export function noteLoadStatusFor(
  state: NoteLoadState,
  identity: NoteLoadIdentity,
): NoteLoadStatus {
  if (isSameNote(state.identity, identity)) return state.status;
  return { kind: 'loading' };
}

/**
 * Whether a note that this device holds can open from the device alone.
 *
 * The editor binds to the document of the note. A note that the server holds
 * and whose document this device lacks opens from the server read instead,
 * which brings the document, because an editor bound to a document of its own
 * would start that note from Markdown on this device (records 0084, 0088). A
 * note with no accepted head is one that only this device holds, even when it
 * has a local version, and it starts its own document.
 */
export function opensFromDevice(
  document: Uint8Array | null,
  acceptedHeadRevisionId: string | null,
): boolean {
  return document !== null || acceptedHeadRevisionId === null;
}
