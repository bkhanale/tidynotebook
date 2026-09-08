/**
 * Submission of queued mutations in parent order.
 *
 * The design fixes three rules that this module implements:
 *
 * - A mutation's identity and body freeze on first send. A retry after a lost
 *   answer repeats the same operation instead of writing a second one. The
 *   frozen request digest is recorded through `LocalStore.markSending`, which
 *   keeps the first value it sees.
 * - Checkpoints created offline form chains. The leading run of never-sent
 *   entries is submitted as one atomic changeset under the first mutation
 *   identity, so a file edited twice offline commits both revisions together
 *   instead of conflicting with itself. An entry that was already sent is
 *   always retried alone under its frozen identity.
 * - A permanent server failure is kept locally instead of being dropped or
 *   retried forever. The single-user server rebases a stale save itself.
 *
 * This module is transport agnostic: the caller injects `QueueNetwork`, and
 * the engine builds it from the generated client. Unit tests inject stubs.
 */
import type { AcceptedChangeset, ChangesetInput } from '@notesapp/core';
import type { LocalStore, QueueEntry } from './local-port.ts';

/** A stable service failure: HTTP status, application code, and file IDs. */
export type Problem = {
  readonly status: number;
  readonly code: string;
  readonly fileIds: readonly string[];
};

/** The outcome of one service call: a value or a stable problem. */
export type ServiceOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: Problem };

/** The outcome of one changeset submission. */
export type CommitResult = ServiceOutcome<AcceptedChangeset>;

/**
 * What submission needs from the network.
 *
 * `prepareCommit` computes the request digest of the exact body that `commit`
 * sends, so the queue can freeze it before the first send. Both functions
 * must build byte-identical bodies from the same input.
 */
export type QueueNetwork = {
  prepareCommit(input: ChangesetInput): Promise<string>;
  commit(input: ChangesetInput, signal: AbortSignal): Promise<CommitResult>;
};

/** A state change the sync run announces. Tab messages only announce. */
export type SyncNotice =
  | {
      readonly kind: 'pushed';
      readonly mutationIds: readonly string[];
      readonly fileIds: readonly string[];
    }
  | {
      readonly kind: 'preserved';
      readonly mutationId: string;
      readonly code: string;
      readonly fileIds: readonly string[];
    }
  | {
      readonly kind: 'retry';
      readonly attempt: number;
      readonly delayMs: number;
    }
  | { readonly kind: 'snapshot-restart'; readonly reason: string }
  | { readonly kind: 'snapshot-activated'; readonly count: number }
  | { readonly kind: 'changes-applied'; readonly count: number }
  | { readonly kind: 'paused'; readonly reason: 'session' }
  | { readonly kind: 'access-lost' }
  | { readonly kind: 'role-downgraded' }
  | { readonly kind: 'writes-resumed' }
  | { readonly kind: 'lease-held' }
  | { readonly kind: 'lease-lost' }
  | { readonly kind: 'cycle-error'; readonly code: string };

/** What submission and download need from their environment. */
export type SyncContext = {
  readonly signal: AbortSignal;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly random: () => number;
  readonly id: () => string;
  readonly announce: (notice: SyncNotice) => void;
};

/** How one push run ended. `deferred` means transport failed; retry later. */
export type PushOutcome = 'done' | 'deferred' | 'paused' | 'access-lost';

/**
 * A failure the engine must not swallow into a queue entry.
 *
 * Unexpected service answers and exhausted transports surface here. The
 * engine announces them and backs off; the queued work stays untouched.
 */
export class SyncFailedError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(`notesapp sync failed: ${code}`);
    this.name = 'SyncFailedError';
    this.code = code;
    this.status = status;
  }
}

/**
 * A download that must start over from a fresh snapshot.
 *
 * An expired snapshot token, a purged revision met mid-download, and an
 * expired change cursor all land here. Local work is never part of the
 * restart: staging and activation keep it intact.
 */
export class SnapshotRestartNeeded extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`notesapp snapshot restart: ${reason}`);
    this.name = 'SnapshotRestartNeeded';
    this.reason = reason;
  }
}

/** The base delay of the backoff schedule, in milliseconds. */
export const backoffBaseMs = 500;

/** The largest single backoff delay, in milliseconds. */
export const backoffCapMs = 8000;

/** How many times one service call is attempted before a cycle gives up. */
export const maxAttempts = 4;

/**
 * One bounded exponential backoff delay with jitter.
 *
 * `attempt` counts the failures so far, starting at zero. The delay doubles
 * per attempt from the base, never passes the cap, and carries up to 500 ms
 * of jitter so two devices do not retry in lockstep.
 */
export function backoffDelay(attempt: number, random: () => number): number {
  const grown = backoffBaseMs * 2 ** Math.max(0, attempt);
  return Math.min(backoffCapMs, grown) + Math.floor(random() * 500);
}

/** Whether an HTTP status is worth retrying within one run. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/** Whether a thrown failure is a caller cancellation. */
function isCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Runs one service call with bounded backoff for transport failures.
 *
 * A retryable HTTP status and a thrown transport failure both wait out a
 * bounded delay and try again. A cancellation propagates at once. Returns
 * `null` when every attempt failed without an answer the caller can act on,
 * so the cycle ends and a later cycle retries.
 */
export async function sendWithRetry<T>(
  ctx: SyncContext,
  run: (signal: AbortSignal) => Promise<ServiceOutcome<T>>,
): Promise<ServiceOutcome<T> | null> {
  for (let attempt = 0; ; attempt += 1) {
    let outcome: ServiceOutcome<T>;
    try {
      outcome = await run(ctx.signal);
    } catch (error: unknown) {
      if (ctx.signal.aborted || isCancellation(error)) throw error;
      if (attempt + 1 >= maxAttempts) return null;
      const delayMs = backoffDelay(attempt, ctx.random);
      ctx.announce({ kind: 'retry', attempt: attempt + 1, delayMs });
      await ctx.sleep(delayMs, ctx.signal);
      continue;
    }
    if (outcome.ok) return outcome;
    if (!isRetryableStatus(outcome.problem.status)) return outcome;
    if (attempt + 1 >= maxAttempts) return null;
    const delayMs = backoffDelay(attempt, ctx.random);
    ctx.announce({ kind: 'retry', attempt: attempt + 1, delayMs });
    await ctx.sleep(delayMs, ctx.signal);
  }
}

/** What one failed submission asks the queue to do next. */
type SubmissionAction = 'preserve' | 'leave' | 'paused' | 'access-lost';

/**
 * Classifies one failed submission.
 *
 * A quota failure stays queued for a later cycle because space may appear.
 * Anything else the server can never accept is preserved as a conflict so it
 * is neither dropped nor retried forever.
 */
function submissionAction(problem: Problem): SubmissionAction {
  if (problem.status === 401) return 'paused';
  if (problem.status === 403 || problem.status === 404) return 'access-lost';
  if (problem.status === 413) return 'leave';
  return 'preserve';
}

/** The most entries combined into one atomic changeset submission. */
const maxBatchEntries = 100;

/** The most files one combined changeset submission may change. */
const maxBatchFiles = 1000;

/**
 * The leading run of never-sent entries that one changeset can carry.
 *
 * Only `pending` entries combine: a `sending` entry already froze its
 * identity and must be retried alone. Entries after the first gap stay for
 * the next pass, so one poisoned entry cannot pin the whole queue.
 */
function takeBatchable(entries: readonly QueueEntry[]): QueueEntry[] {
  const batch: QueueEntry[] = [];
  let files = new Set<string>();
  for (const entry of entries) {
    if (entry.state !== 'pending' || batch.length >= maxBatchEntries) break;
    const next = new Set(files);
    for (const revision of entry.input.revisions) next.add(revision.fileId);
    if (next.size > maxBatchFiles) break;
    files = next;
    batch.push(entry);
  }
  return batch;
}

/**
 * Submits every queued mutation of one workspace, in parent order.
 *
 * Returns `paused` when the session expired and `access-lost` when the
 * workspace no longer accepts this account's writes. Both stop the cycle;
 * the engine decides whether reads may continue.
 */
export async function pushQueue(
  local: LocalStore,
  accountId: string,
  workspaceId: string,
  net: QueueNetwork,
  ctx: SyncContext,
): Promise<PushOutcome> {
  const entries = await local.pending(accountId, workspaceId);
  const work = entries.filter((entry) => entry.state !== 'conflict');
  if (work.length === 0) return 'done';
  const head = work[0];
  if (head === undefined) return 'done';
  if (head.state === 'sending')
    return submitSingle(local, accountId, net, ctx, head);
  const batch = takeBatchable(work);
  if (batch.length <= 1) return submitSingle(local, accountId, net, ctx, head);
  return submitBatch(local, accountId, workspaceId, net, ctx, batch);
}

/**
 * Submits the leading pending run as one atomic changeset.
 *
 * The combined body travels under the first mutation identity with the
 * first entry's preconditions per file, and the revisions stay in parent
 * order. When the server accepts, every entry is acknowledged with its exact
 * accepted revision IDs. When the combined write fails for a reason that
 * names no single entry, each entry is submitted alone so the healthy ones
 * still commit and only the true conflict branches.
 */
async function submitBatch(
  local: LocalStore,
  accountId: string,
  workspaceId: string,
  net: QueueNetwork,
  ctx: SyncContext,
  batch: readonly QueueEntry[],
): Promise<PushOutcome> {
  const first = batch[0];
  if (first === undefined) return 'done';
  const expectedHeads: Record<string, string | null> = {};
  for (const entry of batch) {
    for (const [fileId, head] of Object.entries(entry.input.expectedHeads)) {
      if (!(fileId in expectedHeads)) expectedHeads[fileId] = head;
    }
  }
  const body: ChangesetInput = {
    workspaceId,
    mutationId: first.input.mutationId,
    deviceId: first.input.deviceId,
    expectedHeads,
    revisions: batch.flatMap((entry) => entry.input.revisions),
  };
  const digest = await net.prepareCommit(body);
  await local.markSending(accountId, first.input.mutationId, digest);
  const outcome = await sendWithRetry(ctx, (signal) =>
    net.commit(body, signal),
  );
  if (outcome === null) return 'deferred';
  if (outcome.ok) {
    let offset = 0;
    for (const entry of batch) {
      const count = entry.input.revisions.length;
      const revisionIds = outcome.value.revisionIds.slice(
        offset,
        offset + count,
      );
      const revisions = outcome.value.revisions.slice(offset, offset + count);
      offset += count;
      await local.acknowledge(accountId, {
        mutationId: entry.input.mutationId,
        revisionIds,
        revisions,
        cursor: outcome.value.cursor,
      });
    }
    ctx.announce({
      kind: 'pushed',
      mutationIds: batch.map((entry) => entry.input.mutationId),
      fileIds: [
        ...new Set(
          batch.flatMap((entry) =>
            entry.input.revisions.map((revision) => revision.fileId),
          ),
        ),
      ],
    });
    return 'done';
  }
  const action = submissionAction(outcome.problem);
  if (action === 'paused') return 'paused';
  if (action === 'access-lost') return 'access-lost';
  if (action === 'leave') return 'done';
  for (const entry of batch) {
    const single = await submitSingle(local, accountId, net, ctx, entry);
    if (single !== 'done') return single;
  }
  return 'done';
}

/**
 * Submits one entry under its own identity and acknowledges it exactly.
 *
 * An entry that already froze its digest is retried with the same body, so a
 * lost answer replays the same operation and the server answers from its
 * stored receipt.
 */
async function submitSingle(
  local: LocalStore,
  accountId: string,
  net: QueueNetwork,
  ctx: SyncContext,
  entry: QueueEntry,
): Promise<PushOutcome> {
  const input = entry.input;
  const digest = entry.digest ?? (await net.prepareCommit(input));
  await local.markSending(accountId, input.mutationId, digest);
  const outcome = await sendWithRetry(ctx, (signal) =>
    net.commit(input, signal),
  );
  if (outcome === null) return 'deferred';
  if (outcome.ok) {
    await local.acknowledge(accountId, {
      mutationId: input.mutationId,
      revisionIds: [...outcome.value.revisionIds],
      revisions: [...outcome.value.revisions],
      cursor: outcome.value.cursor,
    });
    ctx.announce({
      kind: 'pushed',
      mutationIds: [input.mutationId],
      fileIds: [...new Set(input.revisions.map((revision) => revision.fileId))],
    });
    return 'done';
  }
  const action = submissionAction(outcome.problem);
  if (action === 'paused') return 'paused';
  if (action === 'access-lost') return 'access-lost';
  if (action === 'leave') return 'done';
  await local.markConflict(accountId, input.mutationId);
  ctx.announce({
    kind: 'preserved',
    mutationId: input.mutationId,
    code: outcome.problem.code,
    fileIds: [...new Set(input.revisions.map((revision) => revision.fileId))],
  });
  return 'done';
}
