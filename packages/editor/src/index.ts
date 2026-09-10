/**
 * Public entry point of the live Markdown editor package.
 *
 * The package knows Markdown and local editor commands only. It never
 * imports endpoints, database tables, token storage, or the generated API
 * client; navigation leaves through injected callbacks.
 */
export type {
  AlignedLine,
  DiffHunk,
  DiffResult,
  HunkDecision,
} from './unified-diff.ts';
export {
  alignLines,
  compareLines,
  diffContextLines,
  maxDiffEdits,
  mergeHunks,
} from './unified-diff.ts';
export type { CreateEditorOptions } from './create-editor.ts';
export {
  applyHeading,
  createEditor,
  setEditorReadOnly,
  setEditorRich,
  setEditorTheme,
} from './create-editor.ts';
export type { EditorNavigation, LinkTarget, TaskBox } from './commands.ts';
export type { NoteChoice, NoteLinkSource } from './completion.ts';
export { noteLinkText, relativeNotePath } from './completion.ts';
export { openFindAndReplace, setNoteLinkSource } from './extensions.ts';
export type { EditorShortcut } from './keymaps.ts';
export { shortcuts } from './keymaps.ts';
export { htmlToMarkdown } from './paste.ts';
export type { EditorView } from '@codemirror/view';
export {
  findTaskBox,
  headingSpec,
  linkTargetAt,
  toggleTaskSpec,
} from './commands.ts';
export type {
  Marker,
  MarkerKind,
  MarkerScan,
  StyledSpan,
} from './live-preview.ts';
export type {
  RichWidget,
  RichWidgetKind,
  RichWidgetResolvers,
} from './widgets.ts';
export {
  buildRichWidgetDecorations,
  findRichWidgets,
  parseTableSource,
  richLimits,
  richWidgets,
  shouldPreserveAsSource,
} from './widgets.ts';
export {
  buildLivePreviewDecorations,
  isRevealed,
  livePreview,
  partitionMarkers,
  scanBlockMarkers,
  scanTextMarkers,
} from './live-preview.ts';
