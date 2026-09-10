/**
 * Public entry point of the notesapp UI package.
 *
 * It owns the Tokyo Night tokens, theme choice helpers, layout primitives,
 * accessible controls, and lightweight SVG icons. It runs in the browser and
 * imports nothing but React, so it stays out of storage, sync, and network
 * decisions.
 */
export type {
  ResolvedTheme,
  ThemeChoice,
  ThemePropertyName,
  ThemeRoot,
  ThemeTokens,
} from './theme.ts';
export {
  applyTheme,
  applyThemeToDocument,
  contrastRatio,
  dayTokens,
  nightTokens,
  parseHexColor,
  parseThemeChoice,
  relativeLuminance,
  resolveTheme,
  themePropertyName,
  themePropertyNames,
  themeStorageKey,
  themeTokens,
  textContrastMinimum,
  uiContrastMinimum,
} from './theme.ts';
export type { SelectOption } from './controls.tsx';
export {
  Badge,
  Button,
  CollapsibleSection,
  SelectField,
  StatusRegion,
  TextField,
} from './controls.tsx';
export type { PageWidth } from './layout.tsx';
export {
  Card,
  EmptyState,
  ListRow,
  Page,
  PageHeader,
  Toolbar,
} from './layout.tsx';
export type { DialogWidth } from './dialog.tsx';
export { Dialog, DialogBody, DialogFooter } from './dialog.tsx';
export type { MenuAlign, MenuItem } from './menu.tsx';
export { Menu } from './menu.tsx';
export type { NoticeTone } from './notice.tsx';
export { Notice } from './notice.tsx';
export type { IconProps } from './icons.tsx';
export {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CloudCheckIcon,
  CloudOffIcon,
  CloudUploadIcon,
  ComputerIcon,
  CopyIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  HistoryIcon,
  ImageIcon,
  MenuIcon,
  MoonIcon,
  MoreIcon,
  PanelRightIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  TrashIcon,
  UserIcon,
  WorkspaceIcon,
} from './icons.tsx';
