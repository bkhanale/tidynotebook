/**
 * The trash: the deleted notes of one workspace, with Restore and Delete
 * permanently.
 *
 * Deleting a note writes a tombstone revision, so the note leaves the file
 * tree but keeps its identifier, its content and its history. This screen is
 * the way back. Restore writes one revision on top of that tombstone. Delete
 * permanently calls the purge operation for that one note, after which nothing
 * can bring it back.
 *
 * A deletion that this device has not sent yet is listed as well. The local
 * store holds it as a tombstone of its own, and merging the two lists means a
 * person sees one trash whether or not the connection is up.
 *
 * Every server action uses a generated operation. There is no handwritten
 * request, URL, or response shape here.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  listDeletedFiles,
  purgeFiles,
  restoreFile,
  type WorkspaceDeletedFileSummary,
} from '@notesapp/api-client';
import { generateUUID } from '@notesapp/core';
import type { LocalStore } from '@notesapp/sync';
import { Button, StatusRegion, TrashIcon } from '@notesapp/ui';
import {
  problemMessage,
  useLocalStore,
  useRequestSync,
  useSession,
} from '../app.tsx';
import { useLocalQuery } from '../local-state.ts';
import { displayNoteName } from './note-name.ts';
import { folderOf, relativeTime } from './relative-time.ts';

/** How long the notice after a deletion stays on screen. */
export const undoNoticeMs = 8000;

/** How long a restore waits for a queued deletion to reach the server. */
const restoreWaitMs = 15_000;

/** How long a restore waits between two attempts. */
const restoreStepMs = 250;

/** One deleted note as the trash shows it. */
export type TrashItem = {
  readonly fileId: string;
  readonly path: string;
  /** The instant of the deletion, or `null` when only this device knows it. */
  readonly deletedAt: string | null;
  /** True while the deletion has not reached the server. */
  readonly pending: boolean;
};

/**
 * Merges the deleted notes of the server with the ones only this device knows.
 *
 * A note that this device deleted while offline holds no place in the listing
 * of the server yet, and a note that another device deleted is not in the
 * local cache. Both belong in the trash, so the two lists are joined on the
 * file identifier and the server entry wins where both hold one.
 */
export function mergeTrash(
  remote: readonly WorkspaceDeletedFileSummary[],
  local: readonly {
    readonly fileId: string;
    readonly path: string;
    readonly deleted: boolean;
    readonly updatedAt: string;
  }[],
): readonly TrashItem[] {
  const merged = new Map<string, TrashItem>();
  for (const file of local) {
    if (!file.deleted) continue;
    merged.set(file.fileId, {
      fileId: file.fileId,
      path: file.path,
      deletedAt: file.updatedAt,
      pending: true,
    });
  }
  for (const file of remote)
    merged.set(file.fileId, {
      fileId: file.fileId,
      path: file.path,
      deletedAt: file.deletedAt,
      pending: false,
    });
  return [...merged.values()].sort((left, right) => {
    const leftAt = Date.parse(left.deletedAt ?? '');
    const rightAt = Date.parse(right.deletedAt ?? '');
    if (
      Number.isFinite(leftAt) &&
      Number.isFinite(rightAt) &&
      leftAt !== rightAt
    )
      return rightAt - leftAt;
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
  });
}

/** Reads every page of the deleted notes of one workspace. */
async function loadDeletedFiles(
  workspaceId: string,
): Promise<readonly WorkspaceDeletedFileSummary[]> {
  const files: WorkspaceDeletedFileSummary[] = [];
  let cursor: string | null = null;
  for (;;) {
    const query: { readonly cursor?: string; readonly limit: number } =
      cursor === null ? { limit: 100 } : { cursor, limit: 100 };
    const page = await listDeletedFiles({
      path: { workspaceId },
      query: { ...query },
    });
    if (page.error !== undefined || page.data === undefined)
      throw new Error(problemMessage(page.error));
    files.push(...page.data.files);
    const next: string | null = page.data.nextCursor;
    if (next === null) break;
    cursor = next;
  }
  return files;
}

/** The path that a restore gave the note, or `null` when it failed. */
export type RestoreOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly message: string };

/**
 * Restores one note, waiting for a deletion that is still on its way.
 *
 * Deleting a note writes a local tombstone first and the sync engine sends it
 * a moment later, so a restore right after a deletion can arrive before the
 * deletion does. The server answers 404 for a note it does not hold as
 * deleted, which is the one answer worth waiting on. Every other answer is
 * final and is reported as it is.
 */
export async function restoreNote(
  workspaceId: string,
  fileId: string,
  deviceId: string,
  options: {
    readonly now?: () => number;
    readonly wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<RestoreOutcome> {
  const now = options.now ?? Date.now;
  const wait =
    options.wait ??
    ((ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }));
  const deadline = now() + restoreWaitMs;
  for (;;) {
    const result = await restoreFile({
      path: { workspaceId, fileId },
      body: {
        mutationId: generateUUID(),
        deviceId,
        clientTime: new Date().toISOString(),
        revisionId: generateUUID(),
      },
    });
    if (result.data !== undefined)
      return { ok: true, path: result.data.revision.path };
    const status = result.response?.status ?? 0;
    if (status !== 404 || now() >= deadline)
      return { ok: false, message: problemMessage(result.error) };
    await wait(restoreStepMs);
  }
}

/** The note that the last deletion removed, while its notice is on screen. */
export type DeleteNotice = {
  readonly workspaceId: string;
  readonly fileId: string;
  /** The name of the note, without its storage suffix. */
  readonly name: string;
};

/** What the notice after a deletion offers to the screens below. */
type DeleteNoticeValue = {
  readonly notice: DeleteNotice | null;
  /** Announces that one note went to the trash. */
  readonly announce: (notice: DeleteNotice) => void;
  /** Takes the notice off the screen. */
  readonly dismiss: () => void;
};

const DeleteNoticeContext = createContext<DeleteNoticeValue>({
  notice: null,
  announce: () => {},
  dismiss: () => {},
});

/**
 * Holds the notice that follows a deletion.
 *
 * The editor announces the deletion and then leaves for the note list, so the
 * notice cannot live in the editor. It lives above both screens, which is what
 * lets the person undo the deletion from the list they land on.
 */
export function DeleteNoticeProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const [notice, setNotice] = useState<DeleteNotice | null>(null);
  const dismiss = useCallback((): void => {
    setNotice(null);
  }, []);
  const value = useMemo(
    () => ({ notice, announce: setNotice, dismiss }),
    [notice, dismiss],
  );
  return (
    <DeleteNoticeContext.Provider value={value}>
      {children}
    </DeleteNoticeContext.Provider>
  );
}

/** Reads the notice that follows a deletion. */
export function useDeleteNotice(): DeleteNoticeValue {
  return useContext(DeleteNoticeContext);
}

/**
 * The notice that one note went to the trash, with one chance to undo it.
 *
 * The region announces itself, and the button is an ordinary button in the
 * document order, so the offer is there for a reader and for the keyboard. It
 * goes away by itself after a few seconds; the note stays in the trash.
 */
export function DeleteNoticeBar(): ReactNode {
  const { notice, dismiss } = useDeleteNotice();
  const store = useLocalStore();
  const navigate = useNavigate();
  const requestSync = useRequestSync();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (notice === null) return;
    setFailure(null);
    const timer = window.setTimeout(dismiss, undoNoticeMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice, dismiss]);

  if (notice === null) return null;
  const undo = (): void => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    void (async (): Promise<void> => {
      const outcome = await restoreNote(
        notice.workspaceId,
        notice.fileId,
        store.store?.deviceId ?? 'web-device',
      );
      setBusy(false);
      if (!outcome.ok) {
        setFailure(outcome.message);
        return;
      }
      requestSync();
      dismiss();
      void navigate(`/w/${notice.workspaceId}/notes/${notice.fileId}`);
    })();
  };

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-edge-subtle bg-card p-3 shadow-md">
      <div
        className="flex flex-wrap items-center justify-between gap-3"
        role="status"
        aria-live="polite"
      >
        <p className="m-0 min-w-0 text-control text-ink">
          {notice.name} moved to Trash.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            label={`Undo the deletion of ${notice.name}`}
            onClick={undo}
          >
            {busy ? 'Undoing' : 'Undo'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            label="Hide this notice"
            onClick={dismiss}
          >
            Close
          </Button>
        </div>
      </div>
      {failure === null ? null : (
        <p className="mb-0 mt-2 text-control text-danger" role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}

/** The trash of one workspace. */
export function TrashView(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const session = useSession();
  const store = useLocalStore();
  const accountId = session.account?.accountId ?? null;

  if (workspaceId === null)
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">Trash</h1>
        <p>The address names no workspace.</p>
      </main>
    );
  if (accountId === null)
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <StatusRegion message="Loading the trash." />
      </main>
    );

  return (
    <TrashList
      store={store.store}
      accountId={accountId}
      workspaceId={workspaceId}
    />
  );
}

/** The listing and the two actions of the trash. */
function TrashList({
  store,
  accountId,
  workspaceId,
}: {
  readonly store: LocalStore | null;
  readonly accountId: string;
  readonly workspaceId: string;
}): ReactNode {
  const navigate = useNavigate();
  const requestSync = useRequestSync();
  const [remote, setRemote] = useState<readonly WorkspaceDeletedFileSummary[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const emptyLocalFiles = useMemo(() => [], []);
  const localFiles = useLocalQuery(
    store,
    accountId,
    workspaceId,
    (activeStore, activeAccount, activeWorkspace) =>
      activeStore.listLocalFiles(activeAccount, activeWorkspace),
    emptyLocalFiles,
    (change) =>
      change.kind === 'draft' ||
      change.kind === 'queue' ||
      change.kind === 'file' ||
      change.kind === 'reset',
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadDeletedFiles(workspaceId)
      .then((files) => {
        if (cancelled) return;
        setRemote(files);
        setFailure(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setFailure(
          reason instanceof Error
            ? reason.message
            : 'The trash could not be read.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, generation]);

  const items = useMemo(
    () => mergeTrash(remote, localFiles.value),
    [remote, localFiles.value],
  );
  const now = Date.now();

  const reload = (): void => {
    setGeneration((value) => value + 1);
  };

  const restore = (item: TrashItem): void => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setOutcome(null);
    void (async (): Promise<void> => {
      const done = await restoreNote(
        workspaceId,
        item.fileId,
        store?.deviceId ?? 'web-device',
      );
      setBusy(false);
      if (!done.ok) {
        setFailure(done.message);
        return;
      }
      requestSync();
      void navigate(`/w/${workspaceId}/notes/${item.fileId}`);
    })();
  };

  const deleteForever = (item: TrashItem): void => {
    if (busy) return;
    if (confirming !== item.fileId) {
      setConfirming(item.fileId);
      return;
    }
    setConfirming(null);
    setBusy(true);
    setFailure(null);
    setOutcome(null);
    void (async (): Promise<void> => {
      const purged = await purgeFiles({
        path: { workspaceId },
        body: { mutationId: generateUUID(), fileIds: [item.fileId] },
      });
      setBusy(false);
      if (purged.error !== undefined || purged.data === undefined) {
        setFailure(problemMessage(purged.error));
        return;
      }
      setOutcome(`${displayNoteName(item.path)} is deleted for good.`);
      requestSync();
      reload();
    })();
  };

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link
          to={`/w/${workspaceId}`}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-edge px-3 text-control text-strong no-underline hover:bg-hover"
        >
          <span>Back to notes</span>
        </Link>
        <h1 className="m-0 text-xl font-semibold text-strong">Trash</h1>
      </div>

      <section
        className="space-y-3 rounded-xl border border-edge-subtle bg-card p-5 shadow-sm"
        aria-labelledby="trash-heading"
      >
        <h2
          className="m-0 text-base font-semibold text-strong"
          id="trash-heading"
        >
          Deleted notes
        </h2>
        <p className="m-0 text-control text-muted">
          Restore puts a note back in your notes. Delete permanently removes it
          and its history for good.
        </p>
        {outcome === null ? null : <StatusRegion message={outcome} />}
        {failure === null ? null : (
          <p className="m-0 text-control text-danger" role="alert">
            {failure}
          </p>
        )}
        {loading ? (
          <StatusRegion message="Loading the trash." />
        ) : items.length === 0 ? (
          <p className="m-0 text-control text-muted">Trash is empty.</p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {items.map((item) => {
              const name = displayNoteName(item.path);
              const folder = folderOf(item.path);
              const when =
                item.deletedAt === null
                  ? ''
                  : relativeTime(item.deletedAt, now);
              return (
                <li
                  key={item.fileId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge-subtle bg-app p-3"
                >
                  <div className="min-w-0">
                    <p className="m-0 truncate text-ui font-medium text-strong">
                      {folder === null ? name : name.slice(folder.length + 1)}
                    </p>
                    <p className="m-0 text-control text-muted">
                      {folder === null ? 'Top level' : folder}
                      {when === '' ? '' : ` · deleted ${when}`}
                      {item.pending ? ' · waiting to sync' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      label={`Restore ${name}`}
                      onClick={() => restore(item)}
                    >
                      Restore
                    </Button>
                    {confirming === item.fileId ? (
                      <>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy}
                          icon={<TrashIcon size={14} />}
                          label={`Confirm the permanent deletion of ${name}`}
                          onClick={() => deleteForever(item)}
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          label={`Keep ${name} in the trash`}
                          onClick={() => setConfirming(null)}
                        >
                          Keep
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        icon={<TrashIcon size={14} />}
                        label={`Delete ${name} permanently`}
                        onClick={() => deleteForever(item)}
                      >
                        Delete permanently
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
