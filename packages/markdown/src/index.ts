/**
 * Public entry point of the shared Markdown package.
 *
 * The editor, the server, and the public share page all read a note through
 * these functions, so one document renders the same way everywhere and one
 * policy decides what a reader can reach.
 *
 * `parseMarkdown` gives the tree with source offsets. `extractLinks` and
 * `extractAttachmentRefs` give the references a caller resolves through the
 * generated API operations. `renderMarkdown` gives sanitized HTML. Nothing in
 * this package performs input or output of any kind.
 */
export type { Root } from 'mdast';
export { parseMarkdown } from './parse.ts';
export type {
  AttachmentRef,
  NoteLink,
  SourceRange,
  WikiLink,
} from './links.ts';
export { extractAttachmentRefs, extractLinks, parseWikiLink } from './links.ts';
export type { ContentUrl } from './policy.ts';
export { classifyUrl, isIdentifier } from './policy.ts';
export type { MarkdownLimitReason } from './render.ts';
export {
  markdownLimits,
  MarkdownLimitError,
  renderMarkdown,
} from './render.ts';
