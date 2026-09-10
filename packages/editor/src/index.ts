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
  emptyNoteHint,
  livePreviewExtensions,
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
export type { EditorState } from '@codemirror/state';
export type { EditorView } from '@codemirror/view';
export {
  findTaskBox,
  headingSpec,
  linkTargetAt,
  taskToggleAt,
  toggleTaskSpec,
} from './commands.ts';
export { editorTheme, editorThemeVariables } from './editor-theme.ts';
export {
  codeLanguages,
  noteMarkdown,
  noteMarkdownExtensions,
} from './language.ts';
export { mathMarkdownExtension } from './math-syntax.ts';
export type { OutlineHeading } from './outline.ts';
export { outlineOf } from './outline.ts';
export type {
  PreviewBuild,
  PreviewNode,
  PreviewRange,
} from './live-preview.ts';
export {
  buildPreview,
  contentText,
  headingLevel,
  livePreview,
  previewStructureOf,
  tableAlignments,
} from './live-preview.ts';
export type {
  RichWidget,
  RichWidgetKind,
  RichWidgetResolvers,
  RichWidgetSet,
} from './widgets.ts';
export {
  attachmentIdOf,
  buildRichWidgets,
  findRichRegions,
  richLimits,
  richWidgets,
  shouldPreserveAsSource,
} from './widgets.ts';
