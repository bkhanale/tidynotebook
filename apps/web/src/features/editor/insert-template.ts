/**
 * Insert from template on the open note (record 0149).
 *
 * The palette lists the templates, and the open note does the rest, because
 * it owns the one editor view of its working copy. The text comes from this
 * device first and from the server second. The placeholders take the date
 * and the time of now and the name of this note, once, through the one
 * engine of `@notesapp/core`, and the result is one edit of the editor view
 * over the selection, so one undo takes it back and the save model of record
 * 0022 holds.
 */
import { useCallback, type RefObject } from 'react';
import { fillTemplate } from '@notesapp/core';
import { insertText, type EditorView } from '@notesapp/editor';
import type { LocalStore } from '@notesapp/sync';
import { readNoteText } from '../../shell/note-text.ts';
import { baseNameOf, displayNoteName } from '../../lib/note-name.ts';
import { templateContextAt, templateProblems } from '../../lib/templates.ts';

/** What the insert reads from the open note. */
export type InsertTemplateInput = {
  readonly store: LocalStore;
  readonly accountId: string;
  readonly workspaceId: string;
  /** The one editor view of the working copy, or `null` once it closed. */
  readonly viewRef: RefObject<EditorView | null>;
  /** The stored path of the open note, which names `{{title}}`. */
  readonly pathRef: RefObject<string>;
  /** Changes the one notice of the editor. */
  readonly setNotice: (update: (current: string) => string) => void;
};

/** The action that fills one template into the open note. */
export function useInsertTemplate({
  store,
  accountId,
  workspaceId,
  viewRef,
  pathRef,
  setNotice,
}: InsertTemplateInput): (templateFileId: string) => void {
  return useCallback(
    (templateFileId: string): void => {
      void (async (): Promise<void> => {
        const text = await readNoteText(
          store,
          accountId,
          workspaceId,
          templateFileId,
        );
        const view = viewRef.current;
        if (view === null) return;
        if (text === null) {
          setNotice(() => templateProblems.text);
          return;
        }
        // A notice of an earlier insert has no cause any more.
        setNotice((current) =>
          current === templateProblems.text ? '' : current,
        );
        const title = displayNoteName(baseNameOf(pathRef.current));
        insertText(
          view,
          fillTemplate(text, templateContextAt(new Date(), title)),
        );
      })();
    },
    [store, accountId, workspaceId, viewRef, pathRef, setNotice],
  );
}
