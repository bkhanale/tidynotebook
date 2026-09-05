/**
 * Revision graph rules for one submitted changeset.
 *
 * The check runs before any write and uses only the submission and the stored
 * parents that the caller looked up. It proves that the submitted revisions
 * form a valid extension of the stored history: identifiers are new, every
 * parent exists and belongs to the same file, and the revisions of one file
 * form a single chain in submission order.
 */
import { fail, ok, type Result, type RevisionInput } from './model.ts';

const maxParents = 2;

/**
 * Validates the revision graph of one submission.
 *
 * `known` associates each stored revision identifier that the caller resolved
 * with the file that owns it. A parent is valid when it is an earlier revision
 * in the same submission or an entry of `known`.
 *
 * Rules:
 *
 * - A revision identifier is new. It repeats neither inside the submission nor
 *   in stored history, because an accepted revision is immutable.
 * - Zero parents mark a root. A root is accepted only for a file that this
 *   submission introduces, which means no stored parent names that file and no
 *   earlier submitted revision names it. The commit use case also compares the
 *   expected head of the file, which is the check that sees a file whose
 *   stored revisions were not looked up here.
 * - One parent is a normal revision. Two different parents are an explicit
 *   merge. More parents, or the same parent twice, are rejected.
 * - A parent belongs to the same file. A revision cannot continue the history
 *   of another file.
 * - Several revisions of one file form a linear or merging chain: each later
 *   revision names the previous submitted revision of that file as a parent.
 *   One submission therefore cannot create two tips for one file.
 *
 * A cycle cannot pass these rules. A parent must already be resolved when its
 * child is inspected, so a revision cannot name itself, and a later revision
 * cannot be the parent of an earlier one.
 *
 * An empty submission has no graph to reject. The commit use case decides
 * whether an empty changeset is meaningful.
 */
export function validateGraph(
  revisions: readonly RevisionInput[],
  known: ReadonlyMap<string, string>,
): Result<void> {
  /** Submitted revision identifier to its file. */
  const submitted = new Map<string, string>();
  /** File to its most recent submitted revision. */
  const chainTip = new Map<string, string>();
  /** Files that already have a stored revision among the resolved parents. */
  const storedFiles = new Set(known.values());

  for (const revision of revisions) {
    const at = [revision.fileId];
    if (submitted.has(revision.id) || known.has(revision.id))
      return fail('invalid_graph', at);
    const parents = revision.parents;
    if (parents.length > maxParents) return fail('invalid_graph', at);
    if (new Set(parents).size !== parents.length)
      return fail('invalid_graph', at);
    for (const parent of parents) {
      const parentFile = submitted.get(parent) ?? known.get(parent);
      if (parentFile === undefined) return fail('invalid_graph', at);
      if (parentFile !== revision.fileId) return fail('invalid_graph', at);
    }
    const previous = chainTip.get(revision.fileId);
    if (previous === undefined) {
      if (parents.length === 0 && storedFiles.has(revision.fileId))
        return fail('invalid_graph', at);
    } else if (!parents.includes(previous)) {
      return fail('invalid_graph', at);
    }
    submitted.set(revision.id, revision.fileId);
    chainTip.set(revision.fileId, revision.id);
  }
  return ok(undefined);
}
