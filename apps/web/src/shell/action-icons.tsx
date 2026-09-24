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
  BoldIcon,
  BulletListIcon,
  CodeIcon,
  CollapseAllIcon,
  ComputerIcon,
  CopyIcon,
  DownloadIcon,
  ExpandAllIcon,
  FolderPlusIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  HistoryIcon,
  ItalicIcon,
  KeyboardIcon,
  LinkIcon,
  MoonIcon,
  MoveIcon,
  OrderedListIcon,
  PanelLeftIcon,
  PencilIcon,
  PlusIcon,
  QuoteIcon,
  SettingsIcon,
  SignOutIcon,
  SortIcon,
  StrikethroughIcon,
  SunIcon,
  TableIcon,
  TaskListIcon,
  TrashIcon,
  UploadIcon,
  WorkspaceIcon,
} from '@notesapp/ui';
import type { ActionIconName } from '../lib/palette-items.ts';

/** The glyph of each action name. */
const actionIcons: Readonly<Record<ActionIconName, ReactNode>> = {
  bold: <BoldIcon />,
  'bullet-list': <BulletListIcon />,
  'collapse-all': <CollapseAllIcon />,
  delete: <TrashIcon />,
  duplicate: <CopyIcon />,
  'expand-all': <ExpandAllIcon />,
  export: <DownloadIcon />,
  'heading-one': <Heading1Icon />,
  'heading-three': <Heading3Icon />,
  'heading-two': <Heading2Icon />,
  history: <HistoryIcon />,
  image: <UploadIcon />,
  'inline-code': <CodeIcon />,
  'insert-link': <LinkIcon />,
  italic: <ItalicIcon />,
  keyboard: <KeyboardIcon />,
  move: <MoveIcon />,
  'new-folder': <FolderPlusIcon />,
  'new-note': <PlusIcon />,
  'new-workspace': <PlusIcon />,
  'ordered-list': <OrderedListIcon />,
  publish: <LinkIcon />,
  'published-links': <LinkIcon />,
  quote: <QuoteIcon />,
  rename: <PencilIcon />,
  settings: <SettingsIcon />,
  sidebar: <PanelLeftIcon />,
  'sign-out': <SignOutIcon />,
  sort: <SortIcon />,
  strikethrough: <StrikethroughIcon />,
  table: <TableIcon />,
  'task-list': <TaskListIcon />,
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
