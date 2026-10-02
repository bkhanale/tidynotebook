/**
 * Completion of links to other notes, and the wiki form at the border.
 *
 * Notes link with standard Markdown links (records 0004 and 0172). This
 * module offers the note list when the person types `](`, and it accepts the
 * familiar `[[` trigger as well. Both insert the same standard link, so no
 * `[[` ever stays in the text and the stored file is plain Markdown that any
 * other editor reads.
 *
 * A person who types a whole `[[Note]]` instead of choosing from the list
 * gets the same link when they type its closing brackets and the note is
 * there, through `convertWikiLinks` of `@notesapp/markdown`, the one
 * converter that a paste and an import call too. A `[[` that names no note
 * stays the text the person typed.
 *
 * The note list arrives through a facet. The editor package never reads the
 * database, the local store, or the API client; the note screen injects what
 * it already holds and refreshes it through the compartment below.
 */
import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';
import {
  Compartment,
  EditorSelection,
  Facet,
  type EditorState,
  type Extension,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { insideLiteral } from './literal-context.ts';
import {
  convertWikiLinks,
  portableRelativePath,
  standardNoteLink,
  wikiLinkResolver,
  type WikiResolver,
} from '@notesapp/markdown';

/** One note the completion can link to. */
export type NoteChoice = {
  /** The stored path of the note, with one `.md` suffix. */
  readonly path: string;
};

/** Everything the completion source needs about the open workspace. */
export type NoteLinkSource = {
  /** Every linkable note, including the open one. */
  readonly notes: readonly NoteChoice[];
  /** The stored path of the open note, used to build relative links. */
  readonly currentPath: string;
};

/** The empty source, used until the note screen injects the real list. */
const emptySource: NoteLinkSource = { notes: [], currentPath: '' };

/**
 * The injected note list.
 *
 * The last injected value wins, so a reconfigured compartment replaces the
 * list instead of adding a second one.
 */
export const noteLinkSourceFacet = Facet.define<NoteLinkSource, NoteLinkSource>(
  {
    combine: (values) => values.at(-1) ?? emptySource,
  },
);

/** The compartment that carries the note list, so updates never rebuild. */
export const noteLinkCompartment = new Compartment();

/** The extension that publishes one note list to the completion source. */
export function noteLinkSource(source: NoteLinkSource): Extension {
  return noteLinkSourceFacet.of(source);
}

/** The largest number of notes one completion list shows. */
export const maxNoteCompletions = 50;

/** Drops one `.md` suffix from a stored path. */
function withoutSuffix(path: string): string {
  return path.replace(/\.md$/i, '');
}

/** The name a reader sees, without the folder and without `.md`. */
export function noteDisplayName(path: string): string {
  const withoutFolder = withoutSuffix(path).split('/').at(-1) ?? '';
  return withoutFolder;
}

/** The folder of a stored path, or the empty string at the top level. */
export function noteFolder(path: string): string {
  const parts = withoutSuffix(path).split('/');
  parts.pop();
  return parts.join('/');
}

/**
 * The Markdown link text for one note, seen from the open note.
 *
 * `standardNoteLink` of `@notesapp/markdown` writes it: the portable relative
 * path that every link between notes holds, and the name of the note as an
 * escaped label, so a name with brackets or a `#` still gives one link.
 */
export function noteLinkText(source: NoteLinkSource, target: string): string {
  return standardNoteLink(source.currentPath, target, noteDisplayName(target));
}

/** The resolver of the wiki links of one note list, built once per list. */
const resolvers = new WeakMap<NoteLinkSource, WikiResolver>();

/** The resolver of the wiki links of the notes that a state knows. */
export function noteResolverOf(source: NoteLinkSource): WikiResolver {
  const known = resolvers.get(source);
  if (known !== undefined) return known;
  const made = wikiLinkResolver(source.notes.map((note) => note.path));
  resolvers.set(source, made);
  return made;
}

/**
 * The text of a paste or of typed brackets with its wiki links converted.
 *
 * Only a target that is a note of the list becomes a link (record 0172), so
 * text that names no note reaches the document as the person wrote it.
 */
export function withNoteLinks(state: EditorState, text: string): string {
  const source = state.facet(noteLinkSourceFacet);
  if (source.notes.length === 0 || !text.includes('[[')) return text;
  try {
    return convertWikiLinks(text, source.currentPath, noteResolverOf(source))
      .text;
  } catch {
    // A text over the limits of the parser is never a short paste. It goes
    // in as it is, and the note shows its own refusal.
    return text;
  }
}

/** Ranks a note against the typed text; lower sorts first, null excludes. */
function rank(path: string, typed: string): number | null {
  if (typed === '') return path.length;
  const haystack = withoutSuffix(path).toLowerCase();
  const needle = typed.toLowerCase();
  const name = noteDisplayName(path).toLowerCase();
  if (name.startsWith(needle)) return path.length;
  if (haystack.startsWith(needle)) return 1000 + path.length;
  if (haystack.includes(needle)) return 2000 + path.length;
  return null;
}

/** The notes that match the typed text, best first. */
function matching(
  source: NoteLinkSource,
  typed: string,
): readonly NoteChoice[] {
  return source.notes
    .filter((note) => note.path !== source.currentPath)
    .map((note) => ({ note, score: rank(note.path, typed) }))
    .filter(
      (entry): entry is { note: NoteChoice; score: number } =>
        entry.score !== null,
    )
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.note.path.localeCompare(right.note.path),
    )
    .slice(0, maxNoteCompletions)
    .map((entry) => entry.note);
}

/** Builds one completion option for a destination-only insertion. */
function destinationOption(
  source: NoteLinkSource,
  note: NoteChoice,
  closing: string,
): Completion {
  const folder = noteFolder(note.path);
  return {
    label: noteDisplayName(note.path),
    ...(folder === '' ? {} : { detail: folder }),
    type: 'text',
    apply: `${portableRelativePath(source.currentPath, note.path)}${closing}`,
  };
}

/** Builds one completion option that inserts a whole Markdown link. */
function linkOption(source: NoteLinkSource, note: NoteChoice): Completion {
  const folder = noteFolder(note.path);
  return {
    label: noteDisplayName(note.path),
    ...(folder === '' ? {} : { detail: folder }),
    type: 'text',
    apply: noteLinkText(source, note.path),
  };
}

/**
 * Offers the note list after `](` and after `[[`.
 *
 * After `](` only the destination is inserted, and the closing parenthesis
 * is added when the text does not already have one. After `[[` the whole
 * `[[` trigger is replaced by a standard Markdown link, so the wiki syntax
 * never reaches the stored file.
 */
export const noteLinkCompletion: CompletionSource = (
  context: CompletionContext,
): CompletionResult | null => {
  const source = context.state.facet(noteLinkSourceFacet);
  if (source.notes.length === 0) return null;

  const wiki = context.matchBefore(/\[\[[^\]\n]*/);
  if (wiki !== null) {
    const typed = wiki.text.slice(2);
    const options = matching(source, typed).map((note) =>
      linkOption(source, note),
    );
    if (options.length === 0) return null;
    // Closing brackets that already stand after the caret belong to the wiki
    // form, so the link takes their place as well.
    const after = context.state.doc.sliceString(context.pos, context.pos + 2);
    const to =
      context.pos + (after === ']]' ? 2 : after.startsWith(']') ? 1 : 0);
    return { from: wiki.from, to, options, filter: false };
  }

  const inline = context.matchBefore(/\]\([^)\s\n]*/);
  if (inline === null) return null;
  const typed = inline.text.slice(2);
  const closing =
    context.state.doc.sliceString(context.pos, context.pos + 1) === ')'
      ? ''
      : ')';
  const options = matching(source, typed).map((note) =>
    destinationOption(source, note, closing),
  );
  if (options.length === 0) return null;
  return {
    from: inline.from + 2,
    to: context.pos,
    options,
    filter: false,
  };
};

/** The text before the caret of a wiki link that one `]` more closes. */
const openWikiLink = /(?:!)?\[\[[^[\]\n]+\]$/;

/**
 * The change that one typed `]` makes at `pos`, or `null` for none.
 *
 * When the bracket closes a `[[Note]]` and the note is there, the wiki form
 * becomes a standard link (record 0172). A backslash before the brackets
 * escapes them, and inside code, math, HTML or an address the bracket is
 * text.
 */
export function typedWikiLink(
  state: EditorState,
  pos: number,
): { readonly from: number; readonly insert: string } | null {
  const line = state.doc.lineAt(pos);
  const before = state.doc.sliceString(line.from, pos);
  const found = openWikiLink.exec(before);
  if (found === null) return null;
  const start = line.from + found.index;
  let slashes = 0;
  for (let at = start - 1; at >= line.from; at -= 1) {
    if (state.doc.sliceString(at, at + 1) !== '\\') break;
    slashes += 1;
  }
  if (slashes % 2 === 1 || insideLiteral(state, start)) return null;
  const written = `${found[0]}]`;
  const linked = withNoteLinks(state, written);
  return linked === written ? null : { from: start, insert: linked };
}

/**
 * Turns a typed `[[Note]]` into a standard link when its last bracket is
 * typed and the note is there (record 0172).
 *
 * The change replaces the wiki form in the same transaction as the bracket,
 * so one undo brings the typed text back.
 */
export const wikiLinkInput: Extension = EditorView.inputHandler.of(
  (view, from, to, text) => {
    if (text !== ']' || from !== to || view.state.readOnly) return false;
    const change = typedWikiLink(view.state, from);
    if (change === null) return false;
    view.dispatch({
      changes: { from: change.from, to: from, insert: change.insert },
      selection: EditorSelection.cursor(change.from + change.insert.length),
      userEvent: 'input.type',
      scrollIntoView: true,
    });
    return true;
  },
);
