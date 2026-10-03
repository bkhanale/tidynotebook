/**
 * What a rename in place of one row of the tree does (record 0164).
 *
 * F2 and the Rename row turn the name of a row into a field. A note keeps its
 * folder and takes the new name, under the rules of the name field of the
 * note (`note-name-commit.ts`). A folder keeps its parent and renames the path
 * of every note inside it, as a move of the folder does. Nothing is written
 * unless every new path is free, and a refusal states one cause.
 *
 * The rules are pure, so `tree-rename.test.ts` states each one.
 */
import {
  folderMoves,
  moveProblem,
  type MoveArea,
  type PathMove,
} from './folder-moves.ts';
import {
  baseNameOf,
  cleanNoteBaseName,
  displayNoteName,
  duplicateNameProblem,
  folderOf,
  joinNotePath,
  noteBaseNameProblem,
  noteNameProblem,
  storageNotePath,
} from './note-name.ts';

/** The row a person renames. */
export type RenameTarget =
  | { readonly kind: 'note'; readonly fileId: string; readonly path: string }
  | { readonly kind: 'folder'; readonly path: string };

/** The outcome of one rename in place. */
export type RenameOutcome =
  /** The row keeps its name. */
  | { readonly kind: 'unchanged' }
  /** The notes take these paths, and a folder moves from one path to one. */
  | {
      readonly kind: 'rename';
      readonly moves: readonly PathMove[];
      readonly folder: {
        readonly from: string;
        readonly to: string;
      } | null;
    }
  /** The name is refused for this reason. */
  | { readonly kind: 'refused'; readonly problem: string };

/** The name a row shows in its field when a rename starts. */
export function renameStartName(target: RenameTarget): string {
  return target.kind === 'note'
    ? displayNoteName(baseNameOf(target.path))
    : (target.path.split('/').at(-1) ?? target.path);
}

/** Decides what the typed name of one row does. */
export function renamePlan(
  target: RenameTarget,
  typed: string,
  area: MoveArea,
  folders: readonly string[],
): RenameOutcome {
  const name = cleanNoteBaseName(typed);
  if (target.kind === 'note') {
    const folder = folderOf(target.path);
    const problem =
      noteBaseNameProblem(name) ?? noteNameProblem(joinNotePath(folder, name));
    if (problem !== null) return { kind: 'refused', problem };
    const path = joinNotePath(folder, storageNotePath(name));
    if (path === target.path) return { kind: 'unchanged' };
    const clash = duplicateNameProblem(path, area.namesInUse, target.fileId);
    if (clash !== null) return { kind: 'refused', problem: clash };
    return {
      kind: 'rename',
      moves: [{ fileId: target.fileId, toPath: path }],
      folder: null,
    };
  }
  const problem = noteBaseNameProblem(name);
  if (problem !== null)
    return {
      kind: 'refused',
      problem: problem
        .replaceAll('note name', 'folder name')
        .replace('Use Move to folder.', 'Use Move to folder to nest it.'),
    };
  const toFolder = joinNotePath(folderOf(target.path), name);
  if (toFolder === target.path) return { kind: 'unchanged' };
  const pathProblem = noteNameProblem(toFolder);
  if (pathProblem !== null)
    return {
      kind: 'refused',
      problem: pathProblem.replaceAll('note name', 'folder name'),
    };
  if (
    folders.some(
      (folder) =>
        folder.toLowerCase() === toFolder.toLowerCase() &&
        folder.toLowerCase() !== target.path.toLowerCase(),
    )
  )
    return {
      kind: 'refused',
      problem: `A folder named ${name} already exists there. Choose a different name.`,
    };
  const moves = folderMoves(area.notes, target.path, toFolder);
  if (moves.length > 0) {
    const clash = moveProblem(moves, area.namesInUse);
    if (clash !== null) return { kind: 'refused', problem: clash };
  }
  return {
    kind: 'rename',
    moves,
    folder: { from: target.path, to: toFolder },
  };
}
