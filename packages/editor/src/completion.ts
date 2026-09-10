/**
 * Completion of links to other notes.
 *
 * v0.1 links notes with standard Markdown links (decision D4). This module
 * offers the note list when the person types `](`, and it accepts the
 * familiar `[[` trigger as well. Both insert the same standard link, so no
 * `[[` ever stays in the text and the stored file is plain Markdown that any
 * other editor reads.
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
import { Compartment, Facet, type Extension } from '@codemirror/state';

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
 * The path of `target` seen from the folder of `from`.
 *
 * Both inputs are stored note paths. The result keeps `../` steps out of the
 * common folder and never starts with `./`, because a bare relative path is
 * what a Markdown reader expects.
 */
export function relativeNotePath(from: string, target: string): string {
  const fromParts = from.split('/');
  fromParts.pop();
  const targetParts = target.split('/');
  const name = targetParts.pop() ?? '';
  let shared = 0;
  while (
    shared < fromParts.length &&
    shared < targetParts.length &&
    fromParts[shared] === targetParts[shared]
  )
    shared += 1;
  const up = fromParts.length - shared;
  const steps = [
    ...Array.from({ length: up }, () => '..'),
    ...targetParts.slice(shared),
    name,
  ];
  return steps.join('/');
}

/**
 * Escapes the characters that would end a Markdown link destination.
 *
 * Spaces and parentheses are the only ones a note path can hold, so the
 * escape stays small and the destination stays readable.
 */
export function markdownDestination(path: string): string {
  return path
    .replaceAll('%', '%25')
    .replaceAll(' ', '%20')
    .replaceAll('(', '%28')
    .replaceAll(')', '%29');
}

/** The Markdown link text for one note, seen from the open note. */
export function noteLinkText(source: NoteLinkSource, target: string): string {
  const relative = relativeNotePath(source.currentPath, target);
  return `[${noteDisplayName(target)}](${markdownDestination(relative)})`;
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
  const relative = relativeNotePath(source.currentPath, note.path);
  return {
    label: noteDisplayName(note.path),
    ...(folder === '' ? {} : { detail: folder }),
    type: 'text',
    apply: `${markdownDestination(relative)}${closing}`,
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
    return { from: wiki.from, to: context.pos, options, filter: false };
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
