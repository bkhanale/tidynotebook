/**
 * The live document of the note screen and its life over the mounts of the
 * screen (records 0081, 0082).
 *
 * The note is built once for the working copy. The editor binds to it, so
 * the text on the screen and the text of the note are one value. A stored
 * draft that the document does not hold yet becomes local work of this
 * device, so nothing is lost while a device moves from a text draft to a
 * document.
 *
 * The clean up of the effects of the screen releases the note. React mounts
 * the effects twice in development, so each mount takes the note through
 * `mountNote`, which opens it again with every change after a release.
 */
import { useMemo, useRef } from 'react';
import { openBoundNote, type BoundNote } from '@notesapp/editor';
import type { NoteDocument } from '@notesapp/sync';

/** The note that the mounted effects of one screen use. */
export type ScreenNote = {
  /** The note now. A render never replaces it. */
  readonly noteRef: { readonly current: BoundNote };
  /** The note of this mount, opened again after a clean up released it. */
  readonly mountNote: () => BoundNote;
};

/** Opens the note of one screen from the document and text the loader read. */
export function useScreenNote(
  document: NoteDocument | null,
  text: string,
): ScreenNote {
  const opened = useMemo(
    () => openBoundNote(document?.bytes ?? null, text),
    [document, text],
  );
  const noteRef = useRef(opened);
  const mountNote = useRef((): BoundNote => {
    noteRef.current = noteRef.current.reopen();
    return noteRef.current;
  }).current;
  return { noteRef, mountNote };
}
