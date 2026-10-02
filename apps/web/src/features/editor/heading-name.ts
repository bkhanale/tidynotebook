/**
 * The name that the open note takes from its first heading (record 0163).
 *
 * `headingStep` of `lib/note-auto-name.ts` decides each boundary. This hook
 * holds what the rule needs of the open editor across versions: the name
 * that the heading gave when the editor last read the name, and the daily
 * note layout of the member, which a daily note keeps its date by (record
 * 0099). The editor asks it for a new path at the boundary of a version, so
 * one version holds the new heading and the new name.
 */
import { useRef, useState, type RefObject } from 'react';
import { headingNameOf, headingStep } from '../../lib/note-auto-name.ts';
import { useDailyNotes } from '../daily-notes/daily-notes.tsx';

/** What the editor tells the rule at one boundary of a version. */
export type HeadingMoment = {
  readonly notes: readonly { readonly fileId: string; readonly path: string }[];
  readonly fileId: string;
  /** The name field holds words that a person is typing. */
  readonly typing: boolean;
  /** A person wrote in the note since its last version. */
  readonly edited: boolean;
};

/** What the editor asks of the heading of the open note. */
export type HeadingName = {
  /** The path the note takes at this version, or `null` to keep its path. */
  readonly next: (moment: HeadingMoment) => string | null;
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
  const daily = useDailyNotes();
  const layout = useRef(
    daily.settings.status === 'ready' ? daily.settings.settings : null,
  );
  layout.current =
    daily.settings.status === 'ready' ? daily.settings.settings : null;
  const rule = useRef<HeadingName>({
    next: (moment) => {
      const step = headingStep({
        ...moment,
        path: pathRef.current,
        text: textRef.current,
        lastHeading: lastHeading.current,
        dailyLayout: layout.current,
      });
      lastHeading.current = step.lastHeading;
      return step.path;
    },
    adopt: (text) => {
      lastHeading.current = headingNameOf(text);
    },
  });
  return rule.current;
}
