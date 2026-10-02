/**
 * The sentence that an import of a workspace answers with (record 0172).
 *
 * An import writes the notes and the pictures of an archive and leaves out
 * every other file: the settings of a tool, such as the `.obsidian` folder,
 * and every other kind of file. The sentence counts what came in and names
 * what stayed out, so nothing is left out in silence.
 */

/** What one import answered, as the contract states it. */
export type ImportResult = {
  readonly notes: number;
  readonly attachments: number;
  readonly skipped: {
    readonly files: number;
    readonly kinds: readonly string[];
  };
};

/** A count with its noun, for example `1 note` and `3 notes`. */
function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** The words of one kind of a file that an import left out. */
function kindWords(kind: string): string {
  if (kind === 'settings') return 'settings of an app';
  if (kind === 'file') return 'files with no type';
  return `.${kind}`;
}

/** The sentence of one import. */
export function importResultSentence(result: ImportResult): string {
  const written = `Imported ${counted(result.notes, 'note', 'notes')} and ${counted(result.attachments, 'image', 'images')}.`;
  if (result.skipped.files === 0) return written;
  const kinds = result.skipped.kinds.map(kindWords).join(', ');
  return `${written} Left out ${counted(result.skipped.files, 'file', 'files')} that a note cannot hold: ${kinds}.`;
}
