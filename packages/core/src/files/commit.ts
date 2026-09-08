/**
 * The one use case that accepts a change of workspace content.
 *
 * Every write of a file goes through this function: a create, an edit, a
 * rename, a delete, a named checkpoint, and a folder change. The single file
 * HTTP operations build a one file changeset and call it, so there is one
 * place that decides whether a change is accepted and one place that keeps the
 * transaction order.
 *
 * The order below is the design's order, and no check is skipped when an
 * earlier one passed:
 *
 * ```text
 * take the workspace lock                                    (store.transact)
 * check current role and grants
 * read the actor bound receipt
 *   same digest    -> return the stored outcome
 *   other digest   -> mutation_reused
 * check purge markers                                       (one query)
 * check paths and rebase each stale update on its current head
 * check every Markdown text and its digest
 * accept: lock the affected files in identifier order, then write content,
 *   revisions, heads, indexes, cursor, and receipt            (one write)
 * remove the side records of every deleted file
 * ```
 *
 * The workspace lock serializes every write of one workspace, so the checks
 * above cannot be overtaken between the read and the write. The row locks of
 * the affected files are taken inside `accept`, in identifier order, which is
 * what keeps two changesets that share files free of a deadlock.
 *
 * The receipt is read before the heads and before the quota, because a first
 * attempt that the client never saw may already have changed both. A replay
 * still passes the role and grant check first, so a replay never grants access
 * that the actor has since lost.
 */
import { authorize, type Actor } from '../identity/actor.ts';
import { contentDigest } from './digest.ts';
import { validateGraph } from './graph.ts';
import {
  fail,
  ok,
  type AcceptedChangeset,
  type ChangesetInput,
  type Result,
  type RevisionInput,
} from './model.ts';
import { normalizePath, type PathKind } from './path.ts';
import type { WorkspaceStore, WorkspaceTransaction } from './ports.ts';

/**
 * The largest number of files that one changeset may touch.
 *
 * The design states this limit for a folder operation. It applies to every
 * changeset, because the server has no way to tell a folder rename from any
 * other batch and the cost is the same.
 */
export const maxFilesPerChangeset = 1000;

/** The path rule that the content kind of a revision selects. */
function pathKind(revision: RevisionInput): PathKind {
  return revision.content.kind === 'markdown' ? 'note' : 'attachment';
}

/** The files that a changeset changes, sorted, without repetition. */
function changedFiles(input: ChangesetInput): readonly string[] {
  return [
    ...new Set(input.revisions.map((revision) => revision.fileId)),
  ].sort();
}

/**
 * Normalizes every submitted path.
 *
 * The accepted path is the NFC form, so the composed and the decomposed
 * spelling of one name cannot become two files. The client keeps its own
 * spelling in the request, and the digest of that request stays what the
 * client sent; only the stored path is normalized.
 */
function normalizeRevisions(
  input: ChangesetInput,
): Result<readonly RevisionInput[]> {
  const revisions: RevisionInput[] = [];
  for (const revision of input.revisions) {
    const path = normalizePath(revision.path, pathKind(revision));
    if (!path.ok) return fail('invalid_path', [revision.fileId]);
    revisions.push(
      path.value === revision.path
        ? revision
        : { ...revision, path: path.value },
    );
  }
  return ok(revisions);
}

/**
 * Reads the stored revisions that the submission refers to.
 *
 * A parent that the submission itself creates needs no lookup. Every other
 * parent, and every expected head, is resolved to the file that owns it, so
 * `validateGraph` can reject a parent of another file and can see that a file
 * already has stored history.
 */
async function knownRevisions(
  tx: WorkspaceTransaction,
  input: ChangesetInput,
): Promise<ReadonlyMap<string, string>> {
  const submitted = new Set(input.revisions.map((revision) => revision.id));
  const wanted = new Set<string>();
  for (const revision of input.revisions)
    for (const parent of revision.parents)
      if (!submitted.has(parent)) wanted.add(parent);
  for (const head of Object.values(input.expectedHeads))
    if (head !== null && !submitted.has(head)) wanted.add(head);
  if (wanted.size === 0) return new Map();
  return tx.parents([...wanted]);
}

/**
 * Rebases each stale update chain on the accepted head.
 *
 * The changeset must state a precondition for every file it changes: either
 * the head the client saw, or `null` for a file that must not exist yet. A
 * missing precondition is a defect of the caller rather than a conflict, so it
 * is `invalid_graph`. The HTTP adapter answers 428 before it reaches this
 * function, because there a missing `If-Match` is a request that has to be
 * repeated with a precondition.
 *
 * A precondition for a file that the changeset does not change is rejected as
 * well. Such a file is not locked by this transaction, so the answer would not
 * mean anything by the time the changeset commits.
 *
 * A create and an update are different operations. A create that finds an
 * existing head, or an update that finds no head, fails instead of changing
 * operation type during a rebase.
 */
async function rebaseHeads(
  tx: WorkspaceTransaction,
  input: ChangesetInput,
  fileIds: readonly string[],
): Promise<Result<ChangesetInput>> {
  const expected = input.expectedHeads;
  const changed = new Set(fileIds);
  for (const fileId of Object.keys(expected))
    if (!changed.has(fileId)) return fail('invalid_graph', [fileId]);
  const missing = fileIds.filter((fileId) => !Object.hasOwn(expected, fileId));
  if (missing.length > 0) return fail('invalid_graph', missing);
  const heads = await tx.heads(fileIds);
  const changedOperation = fileIds.filter((fileId) => {
    const current = heads.get(fileId) ?? null;
    const submitted = expected[fileId] ?? null;
    return current !== submitted && (current === null || submitted === null);
  });
  if (changedOperation.length > 0) return fail('stale_head', changedOperation);
  const seen = new Set<string>();
  const revisions = input.revisions.map((revision) => {
    if (seen.has(revision.fileId)) return revision;
    seen.add(revision.fileId);
    const current = heads.get(revision.fileId) ?? null;
    const submitted = expected[revision.fileId] ?? null;
    if (current === submitted) return revision;
    return { ...revision, parents: current === null ? [] : [current] };
  });
  return ok({
    ...input,
    expectedHeads: Object.fromEntries(
      fileIds.map((fileId) => [fileId, heads.get(fileId) ?? null]),
    ),
    revisions,
  });
}

/**
 * Checks the submitted Markdown of every revision.
 *
 * Three rules apply, and all three answer `invalid_content`:
 *
 * - The text must be well formed. A lone surrogate becomes U+FFFD when the
 *   value is encoded as UTF-8, so the stored bytes would differ from the
 *   submitted string and the digest would never match again.
 * - A note tombstone carries no text. A deletion that carried Markdown would
 *   add content while it claims to remove a file, and the quota rule that
 *   keeps a full workspace manageable reserves capacity for operations that
 *   add nothing. The revision before the tombstone still holds the content.
 * - The text must match its declared digest. Content is addressed by digest
 *   and deduplicated inside a workspace, so a revision that declared the
 *   digest of other stored bytes would resolve to those bytes instead of the
 *   submitted text. Storage checks this as well; this check keeps the wrong
 *   content out of storage in the first place.
 */
async function checkContent(
  revisions: readonly RevisionInput[],
): Promise<Result<void>> {
  const wrong: string[] = [];
  for (const revision of revisions) {
    const content = revision.content;
    if (content.kind !== 'markdown') continue;
    if (
      !content.text.isWellFormed() ||
      (revision.deleted && content.text !== '')
    ) {
      wrong.push(revision.fileId);
      continue;
    }
    const digest = await contentDigest(content.text);
    if (digest !== content.digest.toLowerCase()) wrong.push(revision.fileId);
  }
  if (wrong.length > 0) return fail('invalid_content', wrong);
  return ok(undefined);
}

/**
 * Accepts one changeset, or reports why it cannot be accepted.
 *
 * `digest` is the request digest of the operation that produced this
 * changeset. It decides whether a retry of the same mutation identity is the
 * same operation.
 */
export async function commitChangeset(
  store: WorkspaceStore,
  actor: Actor,
  input: ChangesetInput,
  digest: string,
): Promise<Result<AcceptedChangeset>> {
  // A changeset with no revision changes nothing, and a changeset over the
  // file limit is refused before any query, so an oversized request cannot
  // make the server do unbounded work.
  if (input.revisions.length === 0) return fail('invalid_graph');
  const fileIds = changedFiles(input);
  if (fileIds.length > maxFilesPerChangeset)
    return fail('invalid_graph', fileIds);

  return store.transact<Result<AcceptedChangeset>>(
    actor,
    input.workspaceId,
    async (tx) => {
      const role = await tx.role(actor.accountId);
      if (role === null) return fail<AcceptedChangeset>('forbidden');
      // Every changeset writes, including a deletion, so one action decides.
      const permitted = authorize(actor, input.workspaceId, role, 'write');
      if (!permitted.ok) return fail<AcceptedChangeset>('forbidden');

      const receipt = await tx.receipt(input.mutationId, actor.accountId);
      if (receipt !== null) {
        // The stored outcome is returned even when the heads have moved on, so a
        // client that lost the answer can retry without a conflict.
        if (receipt.digest === digest) return ok(receipt.outcome);
        return fail<AcceptedChangeset>('mutation_reused', fileIds);
      }

      const purged = await tx.purgedFiles(fileIds);
      if (purged.length > 0) return fail<AcceptedChangeset>('purged', purged);

      const normalized = normalizeRevisions(input);
      if (!normalized.ok) return normalized;

      const rebased = await rebaseHeads(
        tx,
        { ...input, revisions: normalized.value },
        fileIds,
      );
      if (!rebased.ok) return rebased;

      const graph = validateGraph(
        rebased.value.revisions,
        await knownRevisions(tx, rebased.value),
      );
      if (!graph.ok) return graph;

      const content = await checkContent(rebased.value.revisions);
      if (!content.ok) return content;

      const outcome = await tx.accept(actor, rebased.value, digest);
      if (!outcome.ok) return outcome;

      // The last revision of a file in the submission is its new head, so a file
      // is deleted when that revision is a tombstone.
      const tips = new Map<string, boolean>();
      for (const revision of rebased.value.revisions)
        tips.set(revision.fileId, revision.deleted);
      const deleted = [...tips.entries()]
        .filter(([, gone]) => gone)
        .map(([fileId]) => fileId);
      if (deleted.length > 0) await tx.onFilesDeleted(deleted);
      return outcome;
    },
  );
}
