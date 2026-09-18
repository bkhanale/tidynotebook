/**
 * The one glyph of every action of the application.
 *
 * An action carries the same icon wherever a person meets it: on a sidebar
 * row, on a menu row and on a row of the command palette. That is one fact,
 * so it is written once here and read everywhere, and a new surface for an
 * action cannot draw a second mark for it (decision 0065).
 *
 * `lib/palette-items.ts` names the glyphs, because a palette action is data
 * and a name is not JSX. This module turns one name into the element, and the
 * record is total by its type, so a new name fails the typecheck until it has
 * a glyph.
 */
import type { ReactNode } from 'react';
import {
  ComputerIcon,
  CopyIcon,
  DownloadIcon,
  FolderPlusIcon,
  HistoryIcon,
  KeyboardIcon,
  LinkIcon,
  MoonIcon,
  MoveIcon,
  PanelLeftIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  SignOutIcon,
  SunIcon,
  TrashIcon,
  UploadIcon,
  WorkspaceIcon,
} from '@notesapp/ui';
import type { ActionIconName } from '../lib/palette-items.ts';

/** The glyph of each action name. */
const actionIcons: Readonly<Record<ActionIconName, ReactNode>> = {
  delete: <TrashIcon />,
  duplicate: <CopyIcon />,
  export: <DownloadIcon />,
  history: <HistoryIcon />,
  image: <UploadIcon />,
  keyboard: <KeyboardIcon />,
  move: <MoveIcon />,
  'new-folder': <FolderPlusIcon />,
  'new-note': <PlusIcon />,
  'new-workspace': <PlusIcon />,
  publish: <LinkIcon />,
  'published-links': <LinkIcon />,
  rename: <PencilIcon />,
  settings: <SettingsIcon />,
  sidebar: <PanelLeftIcon />,
  'sign-out': <SignOutIcon />,
  'theme-dark': <MoonIcon />,
  'theme-light': <SunIcon />,
  'theme-system': <ComputerIcon />,
  trash: <TrashIcon />,
  workspace: <WorkspaceIcon />,
};

/** The glyph of one action. */
export function actionIcon(name: ActionIconName): ReactNode {
  return actionIcons[name];
}
