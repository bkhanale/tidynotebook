/**
 * The name that the open note takes from its first heading (record 0163).
 *
 * `lib/note-auto-name.ts` holds the rule. This hook holds what the rule needs
 * of the open editor across versions: the name that the heading gave when
 * the editor last read the name, and the layout of the daily notes, because a
 * daily note keeps the name of its date (record 0099). The editor asks it for
 * a new path at the boundary of a version, so one version holds the new
 * heading and the new name.
 */
import { useRef, useState, type RefObject } from 'react';
import { dailyNoteDate } from '@notesapp/core';
import { previewStructureOf } from '@notesapp/editor';
import {
  automaticPath,
  firstBlockOf,
  nameFromHeading,
} from '../../lib/note-auto-name.ts';
import { useDailyNotes } from '../daily-notes/daily-notes.tsx';

/**
 * The name that the first line of a text gives, when that line is a heading.
 * The one grammar reads the first block alone, so a version of a long note
 * does not parse the whole note for its name.
 */
export function headingNameOf(text: string): string | null {
  const first = previewStructureOf(firstBlockOf(text))[0];
  return first?.kind === 'heading' ? nameFromHeading(first.text) : null;
}

/** What the editor asks of the heading of the open note. */
export type HeadingName = {
  /** The path the note takes at this version, or `null` to keep its path. */
  readonly next: (
    notes: readonly { readonly fileId: string; readonly path: string }[],
    fileId: string,
  ) => string | null;
  /** Reads the heading again after the editor took a name from the store. */
  readonly adopt: (text: string) => void;
};

/**
 * The heading name rule of one open note, which reads the path and the text
 * of the editor from its references at the boundary of a version.
 */
export function useHeadingName(
  initialText: string,
  pathRef: RefObject<string>,
  textRef: RefObject<string>,
): HeadingName {
  const [opened] = useState(() => headingNameOf(initialText));
  const lastHeading = useRef(opened);
  // Until the settings answer, no note follows its heading, because the note
  // could be the note of a date.
  const daily = useDailyNotes();
  const layout = useRef(
    daily.settings.status === 'ready' ? daily.settings.settings : null,
  );
  layout.current =
    daily.settings.status === 'ready' ? daily.settings.settings : null;
  const rule = useRef<HeadingName>({
    next: (notes, fileId) => {
      const currentPath = pathRef.current;
      const days = layout.current;
      if (days === null || dailyNoteDate(currentPath, days) !== null)
        return null;
      const heading = headingNameOf(textRef.current);
      const path = automaticPath({
        currentPath,
        lastHeading: lastHeading.current,
        heading,
        notes,
        fileId,
      });
      if (path !== null) lastHeading.current = heading;
      return path;
    },
    adopt: (text) => {
      lastHeading.current = headingNameOf(text);
    },
  });
  return rule.current;
}
