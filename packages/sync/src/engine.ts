/**
 * The foreground sync state machine.
 *
 * One run of the engine repeats the revision exchange of the design:
 *
 * 1. Hold the single worker lease, renewing it every cycle. Another tab with
 *    a live lease keeps this run from starting; an expired lease is taken
 *    over. Tab messages only announce these states.
 * 2. Verify the session and the workspace membership before touching data.
 *    An expired session pauses the run with drafts kept. A lost membership
 *    stops reads and writes. A downgrade to viewer suspends writes while
 *    permitted reads continue, and resumes them when the role is restored.
 * 3. Submit the queued mutations in parent order through `pushQueue`, which
 *    freezes each mutation on first send, batches unsent chains atomically,
 *    branches on stale heads, and preserves anything the server refuses.
 * 4. Pull the server state through `pullNew`: stage a snapshot, fetch its
 *    immutable revisions, activate only when complete, then consume ordered
 *    changes. A dirty working copy is never replaced.
 * 5. Wait for the poll interval and repeat until the abort signal fires.
 *
 * Every application HTTP call below is a direct import of a generated
 * operation function. There is no handwritten transport: this module only
 * maps domain records to generated bodies and generated answers back to
 * domain outcomes.
 */
import {
  commitChangeset,
  getAccount,
  getChanges,
  getRevision,
  getSnapshotPage,
  startSnapshot,
  submitBranch,
} from '@notesapp/api-client';
import {
  generateUUID,
  requestDigest,
  type AcceptedChangeset,
  type ChangesetInput,
  type ContentRef,
} from '@notesapp/core';
import type { LocalStore } from './local-port.ts';
import { acquireWorkerLease, releaseWorkerLease } from './lease.ts';
import { isLocalStorageError } from './local-port.ts';
import {
  SyncFailedError,
  pushQueue,
  type BranchInput,
  type Problem,
  type QueueNetwork,
  type ServiceOutcome,
  type SyncContext,
  type SyncNotice,
} from './queue.ts';
import { pullNew, type SnapshotNetwork } from './snapshot.ts';

/** Reading one unknown property without asserting its shape. */
function readProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value))[key];
}

/** The text list of a problem's file IDs, or an empty list. */
function readFileIds(value: unknown): readonly string[] {
  const fileIds = readProperty(value, 'fileIds');
  if (!Array.isArray(fileIds)) return [];
  return fileIds.filter(
    (entry: unknown): entry is string => typeof entry === 'string',
  );
}

/**
 * Maps a generated failure to a stable problem.
 *
 * The client interceptor normalizes failures to problem details, so the
 * code, the status, and the file IDs are read from the error first and from
 * the HTTP answer as a fallback.
 */
function toProblem(error: unknown, response: Response | undefined): Problem {
  const statusRaw = readProperty(error, 'status');
  const status =
    typeof statusRaw === 'number' ? statusRaw : (response?.status ?? 0);
  const codeRaw = readProperty(error, 'code');
  const code =
    typeof codeRaw === 'string' && codeRaw !== ''
      ? codeRaw
      : status === 401
        ? 'unauthorized'
        : status === 0
          ? 'transport_failed'
          : 'unexpected_response';
  return { status, code, fileIds: readFileIds(error) };
}

/** The generated body of one submitted revision. */
function toRevisionBody(revision: ChangesetInput['revisions'][number]): {
  readonly revisionId: string;
  readonly fileId: string;
  readonly parents: string[];
  readonly path: string;
  readonly deleted: boolean;
  readonly content: {
    readonly kind: 'markdown' | 'attachment';
    readonly digest: string;
    readonly text?: string;
    readonly attachmentObjectId?: string;
  };
  readonly clientTime: string;
  readonly message: string | null;
  readonly restoredFrom: string | null;
} {
  const content = toContentBody(revision.content);
  return {
    revisionId: revision.id,
    fileId: revision.fileId,
    parents: [...revision.parents],
    path: revision.path,
    deleted: revision.deleted,
    content,
    clientTime: revision.clientTime,
    message: revision.message,
    restoredFrom: revision.restoredFrom,
  };
}

/** The generated body of one content reference, without absent members. */
function toContentBody(content: ContentRef): {
  readonly kind: 'markdown' | 'attachment';
  readonly digest: string;
  readonly text?: string;
  readonly attachmentObjectId?: string;
} {
  if (content.kind === 'markdown')
    return { kind: 'markdown', digest: content.digest, text: content.text };
  return {
    kind: 'attachment',
    digest: content.digest,
    attachmentObjectId: content.objectId,
  };
}

/**
 * What the engine needs from the network besides queue and snapshot reads.
 *
 * The session check runs before every cycle. A failed write followed by a
 * working read means a viewer downgrade; a failed read means lost access.
 */
export type SessionNetwork = {
  verifySession(
    signal: AbortSignal,
  ): Promise<ServiceOutcome<{ readonly accountId: string }>>;
};

/** Every network operation the engine runs, for injection in tests. */
export type EngineOperations = QueueNetwork & SnapshotNetwork & SessionNetwork;

/** Options of one engine. Everything except the store has a default. */
export type EngineOptions = {
  /** The worker identity recorded in the lease. A fresh ID by default. */
  readonly ownerId?: string;
  /** Extra headers of every request, for example the session cookie. */
  readonly headers?: () => Record<string, string>;
  /** Milliseconds since the Unix epoch. Defaults to the system clock. */
  readonly clock?: () => number;
  /** Randomness for backoff jitter. Defaults to `Math.random`. */
  readonly random?: () => number;
  /** Client generated identifiers. Defaults to `generateUUID`. */
  readonly id?: () => string;
  /** Abortable wait. Defaults to a timer. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Idle time between cycles. The design's value is 15 seconds. */
  readonly pollIntervalMs?: number;
  /** How long one acquired lease lasts. Defaults to 30 seconds. */
  readonly leaseTtlMs?: number;
  /** Receives every state change announcement. Silent by default. */
  readonly announce?: (notice: SyncNotice) => void;
  /** Injected operations. The generated client by default. */
  readonly operations?: EngineOperations;
};

/** One foreground sync engine. */
export type SyncEngine = {
  /**
   * Runs sync cycles until the signal aborts.
   *
   * Returns quietly when another worker holds the lease, and always
   * releases an acquired lease before returning.
   */
  run(signal: AbortSignal): Promise<void>;
  /** Stops a running engine and releases its lease. */
  stop(): void;
};

/** Waits out a delay, or rejects with an abort failure when stopped. */
function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The sync run stopped.', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('The sync run stopped.', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Creates the foreground sync engine of one account and workspace.
 *
 * Local attachment bytes due for upload are handled by preservation: this
 * device has no local attachment creation flow yet, so a queued revision
 * that names an attachment submits like any other revision, and a missing
 * object answer preserves the entry instead of dropping it. Upload before
 * submit becomes possible once checkpoints can create attachment content.
 */
export function createSyncEngine(
  local: LocalStore,
  accountId: string,
  workspaceId: string,
  options: EngineOptions = {},
): SyncEngine {
  const clock = options.clock ?? Date.now;
  const random = options.random ?? Math.random;
  const newId = options.id ?? ((): string => generateUUID());
  const sleep = options.sleep ?? defaultSleep;
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;
  const leaseTtlMs = options.leaseTtlMs ?? 30_000;
  const announce = options.announce ?? ((): void => {});
  const extraHeaders = options.headers ?? ((): Record<string, string> => ({}));
  const operations =
    options.operations ?? createOperations(workspaceId, extraHeaders);
  const internal = new AbortController();

  /** One session verification: the signed-in account or why it failed. */
  async function verifyOnce(
    signal: AbortSignal,
  ): Promise<'ok' | 'paused' | 'access-lost' | 'deferred'> {
    let outcome: ServiceOutcome<{ readonly accountId: string }>;
    try {
      outcome = await operations.verifySession(signal);
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      return 'deferred';
    }
    if (outcome.ok) return 'ok';
    if (outcome.problem.status === 401) return 'paused';
    if (
      outcome.problem.status === 408 ||
      outcome.problem.status === 429 ||
      outcome.problem.status >= 500
    )
      return 'deferred';
    return 'access-lost';
  }

  /** Waits out a delay; returns `false` when the run stopped meanwhile. */
  async function rest(ms: number, signal: AbortSignal): Promise<boolean> {
    try {
      await sleep(ms, signal);
      return true;
    } catch (error: unknown) {
      if (signal.aborted) return false;
      throw error;
    }
  }

  async function loop(signal: AbortSignal): Promise<void> {
    const ownerId = options.ownerId ?? newId();
    const held = await acquireWorkerLease(local, {
      ownerId,
      ttlMs: leaseTtlMs,
      clock,
    });
    if (!held) {
      announce({ kind: 'lease-held' });
      return;
    }
    try {
      let lastSession: 'ok' | 'paused' | 'access-lost' = 'ok';
      const noteSession = (state: 'ok' | 'paused' | 'access-lost'): void => {
        if (state === lastSession) return;
        lastSession = state;
        announce(
          state === 'paused'
            ? { kind: 'paused', reason: 'session' }
            : { kind: 'access-lost' },
        );
      };
      let lastCycleError = '';
      const noteCycleError = (code: string): void => {
        if (code === lastCycleError) return;
        lastCycleError = code;
        announce({ kind: 'cycle-error', code });
      };
      let session = await verifyOnce(signal);
      while (session !== 'ok') {
        if (signal.aborted) return;
        noteSession(session === 'paused' ? 'paused' : 'access-lost');
        if (!(await rest(pollIntervalMs, signal))) return;
        session = await verifyOnce(signal);
      }
      let writesSuspended = false;
      for (;;) {
        if (signal.aborted) return;
        const renewed = await acquireWorkerLease(local, {
          ownerId,
          ttlMs: leaseTtlMs,
          clock,
        });
        if (!renewed) {
          announce({ kind: 'lease-lost' });
          return;
        }
        try {
          const check = await verifyOnce(signal);
          if (check === 'paused') {
            noteSession('paused');
            if (!(await rest(pollIntervalMs, signal))) return;
            continue;
          }
          if (check !== 'ok') {
            noteSession('access-lost');
            if (!(await rest(pollIntervalMs, signal))) return;
            continue;
          }
          noteSession('ok');
          const ctx: SyncContext = {
            signal,
            sleep,
            random,
            id: newId,
            announce,
          };
          const pushed = await pushQueue(
            local,
            accountId,
            workspaceId,
            operations,
            ctx,
          );
          if (pushed === 'paused') {
            noteSession('paused');
            if (!(await rest(pollIntervalMs, signal))) return;
            continue;
          }
          if (pushed === 'access-lost' && !writesSuspended) {
            // Reads may still be permitted: a viewer keeps read access while
            // losing writes. Pull once before deciding between a downgrade
            // and a lost membership.
            const probe = await pullNew(
              local,
              accountId,
              workspaceId,
              operations,
              ctx,
            );
            if (probe === 'paused') {
              noteSession('paused');
            } else if (probe === 'access-lost') {
              noteSession('access-lost');
            } else {
              // Deferred is a transport failure, not a denial: the probe
              // reached the service, so reads work and only writes wait.
              writesSuspended = true;
              announce({ kind: 'role-downgraded' });
            }
            if (!(await rest(pollIntervalMs, signal))) return;
            continue;
          }
          if (pushed === 'done' && writesSuspended) {
            writesSuspended = false;
            announce({ kind: 'writes-resumed' });
          }
          if (pushed === 'deferred') {
            if (!(await rest(pollIntervalMs, signal))) return;
            continue;
          }
          const pulled = await pullNew(
            local,
            accountId,
            workspaceId,
            operations,
            ctx,
          );
          if (pulled === 'paused') {
            noteSession('paused');
          } else if (pulled === 'access-lost') {
            noteSession('access-lost');
          } else {
            lastCycleError = '';
          }
          if (!(await rest(pollIntervalMs, signal))) return;
        } catch (error: unknown) {
          if (signal.aborted) return;
          if (error instanceof DOMException && error.name === 'AbortError')
            return;
          if (error instanceof SyncFailedError) noteCycleError(error.code);
          else if (isLocalStorageError(error))
            noteCycleError(`local-${error.kind}`);
          else throw error;
          if (!(await rest(pollIntervalMs, signal))) return;
        }
      }
    } finally {
      await releaseWorkerLease(local, ownerId);
    }
  }

  return {
    run(signal: AbortSignal): Promise<void> {
      if (signal.aborted || internal.signal.aborted) return Promise.resolve();
      const onExternalAbort = (): void => {
        internal.abort();
      };
      signal.addEventListener('abort', onExternalAbort, { once: true });
      return loop(internal.signal).finally(() => {
        signal.removeEventListener('abort', onExternalAbort);
      });
    },
    stop(): void {
      internal.abort();
    },
  };
}

/**
 * Builds the default operations from the generated client.
 *
 * Every function below calls one generated operation with the workspace it
 * was built for. Bodies are mapped from domain records to generated shapes;
 * request digests cover exactly the body that is sent, so a retry repeats
 * the same bytes the digest names.
 */
function createOperations(
  workspaceId: string,
  extraHeaders: () => Record<string, string>,
): EngineOperations {
  return {
    async prepareCommit(input: ChangesetInput): Promise<string> {
      return requestDigest(
        'commitChangeset',
        { workspaceId },
        toChangesetBody(input),
      );
    },
    async commit(
      input: ChangesetInput,
      signal: AbortSignal,
    ): Promise<ServiceOutcome<AcceptedChangeset>> {
      const body = toChangesetBody(input);
      const sent = await commitChangeset({
        headers: extraHeaders(),
        path: { workspaceId },
        body,
        signal,
      });
      if (sent.error !== undefined || sent.data === undefined)
        return { ok: false, problem: toProblem(sent.error, sent.response) };
      return {
        ok: true,
        value: {
          mutationId: sent.data.mutationId,
          revisionIds: [...sent.data.revisionIds],
          cursor: sent.data.cursor,
          revisions: sent.data.revisions.map((revision) => ({
            revisionId: revision.revisionId,
            fileId: revision.fileId,
            parents: [...revision.parents],
            path: revision.path,
            deleted: revision.deleted,
            digest: revision.digest,
            size: revision.size,
            actorAccountId: revision.actorAccountId,
            serverTime: revision.serverTime,
            message: revision.message,
          })),
        },
      };
    },
    async submitBranch(
      input: BranchInput,
      signal: AbortSignal,
    ): Promise<ServiceOutcome<{ readonly revisionIds: readonly string[] }>> {
      const body = {
        mutationId: input.mutationId,
        deviceId: input.deviceId,
        conflictGroupId: input.conflictGroupId,
        expectedHeads: { ...input.expectedHeads },
        revisions: input.revisions.map(toRevisionBody),
      };
      const sent = await submitBranch({
        headers: extraHeaders(),
        path: { workspaceId: input.workspaceId },
        body,
        signal,
      });
      if (sent.error !== undefined || sent.data === undefined)
        return { ok: false, problem: toProblem(sent.error, sent.response) };
      return { ok: true, value: { revisionIds: [...sent.data.revisionIds] } };
    },
    async start(signal: AbortSignal) {
      const sent = await startSnapshot({
        headers: extraHeaders(),
        path: { workspaceId },
        body: { syncVersion: 1 },
        signal,
      });
      if (sent.error !== undefined || sent.data === undefined)
        return {
          ok: false as const,
          problem: toProblem(sent.error, sent.response),
        };
      return {
        ok: true as const,
        value: {
          token: sent.data.token,
          cursor: sent.data.cursor,
          itemCount: sent.data.itemCount,
        },
      };
    },
    async page(token, position, signal) {
      const sent = await getSnapshotPage({
        headers: extraHeaders(),
        path: { workspaceId, token },
        query: { position },
        signal,
      });
      if (sent.error !== undefined || sent.data === undefined)
        return {
          ok: false as const,
          problem: toProblem(sent.error, sent.response),
        };
      return {
        ok: true as const,
        value: {
          token: sent.data.token,
          cursor: sent.data.cursor,
          items: sent.data.items.map((item) => ({
            fileId: item.fileId,
            revisionId: item.revisionId,
            path: item.path,
            fileKind: item.kind,
            deleted: item.deleted,
          })),
          nextPosition: sent.data.nextPosition,
        },
      };
    },
    async revision(revisionId, signal) {
      const sent = await getRevision({
        headers: extraHeaders(),
        path: { workspaceId, revisionId },
        signal,
      });
      if (sent.error !== undefined || sent.data === undefined)
        return {
          ok: false as const,
          problem: toProblem(sent.error, sent.response),
        };
      return {
        ok: true as const,
        value: {
          fileId: sent.data.fileId,
          revisionId: sent.data.revisionId,
          path: sent.data.path,
          fileKind: sent.data.kind,
          deleted: sent.data.deleted,
          digest: sent.data.digest,
          text: sent.data.text,
        },
      };
    },
    async changes(cursor, signal) {
      const sent = await getChanges({
        headers: extraHeaders(),
        path: { workspaceId },
        query: { cursor },
        signal,
      });
      if (sent.error !== undefined || sent.data === undefined)
        return {
          ok: false as const,
          problem: toProblem(sent.error, sent.response),
        };
      return {
        ok: true as const,
        value: {
          changes: sent.data.changes.map((change) => ({
            file:
              change.entityKind === 'file' && change.revisionId !== null
                ? {
                    fileId: change.entityId,
                    revisionId: change.revisionId,
                  }
                : null,
          })),
          nextCursor: sent.data.nextCursor,
        },
      };
    },
    async verifySession(signal: AbortSignal) {
      const sent = await getAccount({ headers: extraHeaders(), signal });
      if (sent.error !== undefined || sent.data === undefined)
        return {
          ok: false as const,
          problem: toProblem(sent.error, sent.response),
        };
      return { ok: true as const, value: { accountId: sent.data.accountId } };
    },
  };
}

/** The generated body of one atomic changeset. */
function toChangesetBody(input: ChangesetInput): {
  readonly mutationId: string;
  readonly deviceId: string;
  readonly expectedHeads: Record<string, string | null>;
  readonly revisions: ReturnType<typeof toRevisionBody>[];
} {
  return {
    mutationId: input.mutationId,
    deviceId: input.deviceId,
    expectedHeads: { ...input.expectedHeads },
    revisions: input.revisions.map(toRevisionBody),
  };
}
