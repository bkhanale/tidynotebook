/**
 * The settings of daily notes (records 0099 and 0101).
 *
 * The settings belong to one member of one workspace. A template is a note of
 * that workspace, so it is named by its file identifier: a rename or a move of
 * the template keeps the choice. The folder and the name format are the
 * layout of `path.ts`.
 */
import { defaultDailyNoteLayout, type DailyNoteLayout } from './path.ts';

/** The daily note settings that one member keeps in one workspace. */
export type DailyNoteSettings = DailyNoteLayout & {
  /** The note whose text a new daily note starts with, or `null`. */
  readonly templateFileId: string | null;
  /** True when the note of today opens when the application starts. */
  readonly openOnStart: boolean;
};

/** What a member reads before they store a setting. */
export const defaultDailyNoteSettings: DailyNoteSettings = {
  templateFileId: null,
  openOnStart: false,
  ...defaultDailyNoteLayout,
};
