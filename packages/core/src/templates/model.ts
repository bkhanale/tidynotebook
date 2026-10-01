/**
 * The template folder of a member, and which notes are templates (record
 * 0149).
 *
 * A template is a live note below the template folder, also in a subfolder.
 * The folder is a setting of one member of one workspace, as the daily note
 * settings are (record 0099), and the palette lists the notes below it. The
 * template of a daily note is any note and does not read this folder.
 */
import { isBelowFolder, isStoredFolderPath } from '../files/path.ts';

/** The template settings that one member keeps in one workspace. */
export type TemplateSettings = {
  /** The folder whose notes are the templates, in its stored spelling. */
  readonly folder: string;
};

/** What a member reads before they store a setting. */
export const defaultTemplateSettings: TemplateSettings = {
  folder: 'Templates',
};

/** Why a folder cannot be the template folder, or `null` when it can. */
export type TemplateFolderProblem = 'empty' | 'folder';

/**
 * Whether a folder can hold the templates.
 *
 * The folder must name a folder: the top of the workspace would make every
 * note a template, which is the list that the setting exists to narrow. It
 * must also pass the folder rules of `files/path.ts` in its stored spelling.
 */
export function templateFolderProblem(
  folder: string,
): TemplateFolderProblem | null {
  if (folder === '') return 'empty';
  return isStoredFolderPath(folder) ? null : 'folder';
}

/** Whether the note at a path is a template of a template folder. */
export function isTemplatePath(path: string, folder: string): boolean {
  return folder !== '' && isBelowFolder(folder.split('/'), path.split('/'));
}
