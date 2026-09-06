/**
 * Public entry point of the notesapp UI package.
 *
 * It owns the Tokyo Night tokens, theme choice helpers, accessible controls,
 * and lightweight SVG icons. It runs in the browser and imports nothing but
 * React, so it stays out of storage, sync, and network decisions.
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
export type { IconProps } from './icons.tsx';
export {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  CloudCheckIcon,
  CloudUploadIcon,
  ComputerIcon,
  CopyIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  HistoryIcon,
  MenuIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShareIcon,
  SunIcon,
  TrashIcon,
  UserIcon,
  WorkspaceIcon,
} from './icons.tsx';
