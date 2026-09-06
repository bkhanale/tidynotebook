/**
 * Public entry point of the live Markdown editor package.
 *
 * The package knows Markdown and local editor commands only. It never
 * imports endpoints, database tables, token storage, or the generated API
 * client; navigation leaves through injected callbacks.
 */
export type { CreateEditorOptions } from './create-editor.ts';
export { applyHeading, createEditor, setEditorTheme } from './create-editor.ts';
export type { EditorNavigation, LinkTarget, TaskBox } from './commands.ts';
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
export {
  buildLivePreviewDecorations,
  isRevealed,
  livePreview,
  partitionMarkers,
  scanBlockMarkers,
  scanTextMarkers,
} from './live-preview.ts';
