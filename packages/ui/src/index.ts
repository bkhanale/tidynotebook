/**
 * Public entry point of the notesapp UI package.
 *
 * It owns the theme registry, appearance helpers, layout primitives,
 * accessible controls, and lightweight SVG icons. It runs in the browser and
 * imports nothing but React, so it stays out of storage, sync, and network
 * decisions.
 */
export type {
  Appearance,
  AppearanceChoice,
  DerivedPropertyName,
  SyntaxPropertyName,
  SyntaxTokens,
  Theme,
  ThemeFamily,
  ThemePropertyName,
  ThemeRoot,
  ThemeSource,
  ThemeTokens,
} from './themes/index.ts';
export {
  appearanceStorageKey,
  applyTheme,
  applyThemeToDocument,
  contrastRatio,
  defaultThemeFamilyId,
  defaultThemeFor,
  derivedPropertyName,
  derivedPropertyNames,
  derivedValue,
  dividerBlend,
  fillHoverShift,
  findTheme,
  findThemeFamily,
  mixHexColors,
  parseAppearanceChoice,
  parseHexColor,
  parseThemeFamilyId,
  relativeLuminance,
  resolveAppearance,
  shiftAwayFrom,
  syntaxPropertyName,
  syntaxPropertyNames,
  textContrastMinimum,
  themeFamilies,
  themeFamilyStorageKey,
  themeFor,
  themeOfFamily,
  themeProperties,
  themePropertyName,
  themePropertyNames,
  themes,
  toneSurfaceBlend,
  uiContrastMinimum,
} from './themes/index.ts';
export type {
  BadgeTone,
  ButtonName,
  ButtonSize,
  ButtonVariant,
} from './control-classes.ts';
export {
  badgeClassName,
  buttonClassName,
  buttonName,
} from './control-classes.ts';
export type { SelectOption } from './controls.tsx';
export {
  Badge,
  Button,
  CollapsibleSection,
  ReadOnlyField,
  SelectField,
  StatusRegion,
  TextField,
} from './controls.tsx';
export type { LoadingShape } from './loading.tsx';
export { LoadingState } from './loading.tsx';
export type { PageWidth } from './layout.tsx';
export {
  Card,
  EmptyState,
  ListRow,
  Page,
  pageGutter,
  PageHeader,
  Toolbar,
} from './layout.tsx';
export {
  transitionField,
  transitionPanel,
  transitionRaise,
  transitionSurface,
} from './motion.ts';
export type { DialogWidth } from './dialog.tsx';
export { Dialog, DialogBody, DialogFooter } from './dialog.tsx';
export type { MenuAlign, MenuItem } from './menu.tsx';
export { Menu } from './menu.tsx';
export type { NoticeTone } from './notice.tsx';
export { Notice } from './notice.tsx';
export type { IconProps } from './icons.tsx';
export {
  AlertCircleIcon,
  AppMarkIcon,
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
  LinkIcon,
  MenuIcon,
  MoonIcon,
  MoreIcon,
  PanelLeftIcon,
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
