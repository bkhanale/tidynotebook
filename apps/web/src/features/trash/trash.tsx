/**
 * The trash: the deleted notes of one workspace, with Restore and Delete.
 *
 * Deleting a note writes a tombstone revision, so the note leaves the file
 * tree but keeps its identifier, its content and its history. This screen is
 * the way back. Restore writes one revision on top of that tombstone. Delete
 * Delete calls the purge operation for that one note, after which nothing can
 * bring it back.
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
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  listDeletedFiles,
  purgeFiles,
  restoreFile,
  type WorkspaceDeletedFileSummary,
} from '@notesapp/api-client';
import { generateUUID } from '@notesapp/core';
import type { LocalStore } from '@notesapp/sync';
import {
  Button,
  CheckIcon,
  CloseIcon,
  EmptyState,
  ListRow,
  LoadingState,
  Notice,
  Page,
  pageGroupLabelClassName,
  PageHeader,
  Toast,
  TrashIcon,
  transitionAction,
} from '@notesapp/ui';
import {
  problemMessage,
  useLocalStore,
  useRequestSync,
  useSession,
} from '../../app.tsx';
import { useLocalQuery } from '../../local-state.ts';
import { displayNoteName } from '../../lib/note-name.ts';
import { folderOf, relativeTime } from '../../lib/relative-time.ts';
import {
  mergeTrash,
  trashActionLayerClassName,
  trashActionSlotClassName,
  trashListClassName,
  type TrashItem,
} from '../../lib/trash-view.ts';
import { useNow } from '../../shell/now.ts';

/** How long the notice after a deletion stays on screen. */
export const undoNoticeMs = 8000;

/** How long a restore waits for a queued deletion to reach the server. */
const restoreWaitMs = 15_000;

/** How long a restore waits between two attempts. */
const restoreStepMs = 250;

/** The largest file set the purge operation accepts in one request. */
const purgeBatchSize = 1000;

/** The permanent deletion that waits for confirmation. */
type TrashConfirmation =
  | { readonly kind: 'one'; readonly fileId: string }
  | { readonly kind: 'all' }
  | null;

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

/** One note that the last deletion removed. */
export type DeleteNoticeItem = {
  readonly fileId: string;
  /** The name of the note, without its storage suffix. */
  readonly name: string;
};

/** The notes that the last deletion removed, while its notice is on screen. */
export type DeleteNotice = {
  readonly workspaceId: string;
  readonly items: readonly DeleteNoticeItem[];
};

/** What the notice after a deletion offers to the screens below. */
type DeleteNoticeValue = {
  readonly notice: DeleteNotice | null;
  /** Announces that notes went to the trash. */
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
 * The notice that one note went to the trash, with one chance to restore it.
 *
 * It is the one `Toast` of the package: a raised surface at the foot of the
 * window that owns the live region, the measure and the arrival, so this
 * screen writes no width and no plane of its own. The button is an ordinary
 * button in the document order, so the offer is there for a reader and for
 * the keyboard. It goes away by itself after a few seconds; the note stays in
 * the trash.
 */
export function DeleteNoticeBar(): ReactNode {
  const { notice, dismiss } = useDeleteNotice();
  const store = useLocalStore();
  const navigate = useNavigate();
  const requestSync = useRequestSync();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const restoredRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (notice === null) return;
    setFailure(null);
    restoredRef.current.clear();
    const timer = window.setTimeout(dismiss, undoNoticeMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice, dismiss]);

  if (notice === null) return null;
  const count = notice.items.length;
  const only = count === 1 ? notice.items[0] : undefined;
  const message =
    only === undefined
      ? `${String(count)} notes moved to Trash.`
      : `${only.name} moved to Trash.`;
  const restoreLabel =
    only === undefined
      ? `Restore ${String(count)} deleted notes`
      : `Restore ${only.name}`;
  const restore = (): void => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    void (async (): Promise<void> => {
      for (const item of notice.items) {
        if (restoredRef.current.has(item.fileId)) continue;
        const outcome = await restoreNote(
          notice.workspaceId,
          item.fileId,
          store.store?.deviceId ?? 'web-device',
        );
        if (!outcome.ok) {
          setBusy(false);
          if (restoredRef.current.size > 0)
            setFailure(
              `${String(restoredRef.current.size)} of ${String(count)} notes are back. Try Restore again for the other notes.`,
            );
          else setFailure(outcome.message);
          return;
        }
        restoredRef.current.add(item.fileId);
      }
      setBusy(false);
      requestSync();
      dismiss();
      if (only === undefined) {
        void navigate(`/w/${notice.workspaceId}`);
        return;
      }
      void navigate(`/w/${notice.workspaceId}/notes/${only.fileId}`);
    })();
  };

  return (
    // One message for one cause: a restore that did not work replaces the
    // sentence of the deletion, so the toast never stacks a general message
    // and a detailed one, and Restore stays on offer.
    <Toast message={failure ?? message}>
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        title={restoreLabel}
        onClick={restore}
      >
        {busy ? 'Restoring' : 'Restore'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        label="Close this notice"
        icon={<CloseIcon />}
        onClick={dismiss}
      />
    </Toast>
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
      <Page>
        <PageHeader title="Trash" />
        <EmptyState
          icon={<TrashIcon size={20} />}
          title="This address names no trash"
          description="Open your notes and choose Trash in the sidebar."
        />
      </Page>
    );
  if (accountId === null)
    return (
      <Page>
        <PageHeader title="Trash" />
        <LoadingState shape="list" rows={4} label="The trash is loading." />
      </Page>
    );

  return (
    <TrashList
      store={store.store}
      accountId={accountId}
      workspaceId={workspaceId}
    />
  );
}

/**
 * The two compact choices that replace a Delete action.
 *
 * The safe choice takes focus and sits at the right edge. A second press at
 * the place of the Delete action therefore cancels instead of confirming.
 */
function DeleteConfirmation({
  active,
  confirmLabel,
  cancelLabel,
  disabled,
  onConfirm,
  onCancel,
}: {
  /** The confirmation shows. An inactive one only holds its size. */
  readonly active: boolean;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly disabled: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (active) cancelRef.current?.focus();
  }, [active]);
  return (
    <div
      className={`flex items-center gap-cluster ${transitionAction}`}
      role="group"
      aria-label="Confirm delete"
    >
      <Button
        variant="danger"
        size="sm"
        disabled={disabled}
        icon={<CheckIcon />}
        label={confirmLabel}
        compact
        onClick={onConfirm}
      />
      <Button
        buttonRef={cancelRef}
        variant="ghost"
        size="sm"
        disabled={disabled}
        icon={<CloseIcon />}
        label={cancelLabel}
        compact
        onClick={onCancel}
      />
    </div>
  );
}

/**
 * The place of one destructive action and the confirmation that replaces it.
 *
 * Both stay in one cell, and the one not in use is unseen and out of the tab
 * order, so the slot always has the width of the wider of the two and nothing
 * beside it moves when a person starts or ends a confirmation.
 */
function ActionSlot({
  place,
  confirming,
  action,
  confirmation,
}: {
  readonly place: 'row' | 'header';
  readonly confirming: boolean;
  readonly action: ReactNode;
  readonly confirmation: ReactNode;
}): ReactNode {
  return (
    <div className={trashActionSlotClassName(place)}>
      <div className={trashActionLayerClassName(confirming)}>{action}</div>
      <div className={trashActionLayerClassName(!confirming)}>
        {confirmation}
      </div>
    </div>
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
  const [confirming, setConfirming] = useState<TrashConfirmation>(null);
  const [busy, setBusy] = useState(false);
  const [removedFileIds, setRemovedFileIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [generation, setGeneration] = useState(0);
  const loadedWorkspace = useRef<string | null>(null);
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
      change.kind === 'purge' ||
      change.kind === 'reset',
  );

  // A remote delete, restore, or purge changes which accepted rows belong in
  // Trash. Refresh that server list after the matching local transition. A
  // focus or reconnect also repairs a missed invalidation.
  useEffect(() => {
    if (store === null) return;
    const unsubscribe = store.subscribe((change) => {
      if (
        change.accountId === accountId &&
        change.workspaceId === workspaceId &&
        (change.kind === 'file' || change.kind === 'purge')
      )
        setGeneration((value) => value + 1);
    });
    const refresh = (): void => setGeneration((value) => value + 1);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [store, accountId, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    const firstRead = loadedWorkspace.current !== workspaceId;
    if (firstRead) {
      setLoading(true);
      setRemote([]);
      setRemovedFileIds(new Set());
      setConfirming(null);
    }
    void loadDeletedFiles(workspaceId)
      .then((files) => {
        if (cancelled) return;
        setRemote(files);
        loadedWorkspace.current = workspaceId;
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
    () => mergeTrash(remote, localFiles.value, removedFileIds),
    [remote, localFiles.value, removedFileIds],
  );
  const now = useNow();

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

  const deleteForever = (targets: readonly TrashItem[]): void => {
    if (busy) return;
    setConfirming(null);
    setBusy(true);
    setFailure(null);
    setOutcome(null);
    const targetIds = targets.map((item) => item.fileId);
    setRemovedFileIds((current) => new Set([...current, ...targetIds]));
    void (async (): Promise<void> => {
      const purgedIds: string[] = [];
      let purgeFailure: string | null = null;
      for (let index = 0; index < targetIds.length; index += purgeBatchSize) {
        const batch = targetIds.slice(index, index + purgeBatchSize);
        const purged = await purgeFiles({
          path: { workspaceId },
          body: { mutationId: generateUUID(), fileIds: batch },
        });
        if (purged.error !== undefined || purged.data === undefined) {
          purgeFailure = problemMessage(purged.error);
          break;
        }
        purgedIds.push(...purged.data.purgedFileIds);
      }
      const purgedSet = new Set(purgedIds);
      setRemote((current) =>
        current.filter((file) => !purgedSet.has(file.fileId)),
      );
      let localFailure = false;
      if (purgedIds.length > 0) {
        try {
          if (store === null)
            throw new Error('The local store is not available.');
          await store.forgetPurgedFiles(accountId, workspaceId, purgedIds);
        } catch {
          localFailure = true;
        }
      }
      // A target that the server did not purge returns to the list. A purged
      // target stays hidden for this mount, even if an older read finishes
      // after this operation and still contains it.
      setRemovedFileIds((current) => {
        const next = new Set(current);
        for (const fileId of targetIds)
          if (!purgedSet.has(fileId)) next.delete(fileId);
        return next;
      });
      if (localFailure)
        setFailure(
          purgedIds.length === 1
            ? 'The server deleted the note. Reload this page to update this device.'
            : 'The server deleted the notes. Reload this page to update this device.',
        );
      else if (purgeFailure !== null) setFailure(purgeFailure);
      else if (purgedIds.length !== targetIds.length)
        setFailure(
          'Some notes are not ready to delete. Wait for sync and try again.',
        );
      else
        setOutcome(
          targets.length === 1
            ? `${displayNoteName(targets[0]?.path ?? '')} is deleted.`
            : `${String(targets.length)} notes are deleted.`,
        );
      requestSync();
      setBusy(false);
    })();
  };

  return (
    <Page>
      <PageHeader
        title="Trash"
        description="Restore puts a note back with your notes. Delete removes the note and its versions for good."
        actions={
          items.length === 0 ? undefined : (
            <ActionSlot
              place="header"
              confirming={confirming?.kind === 'all'}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  tone="danger"
                  compact
                  disabled={busy || items.some((item) => item.pending)}
                  onClick={() => setConfirming({ kind: 'all' })}
                >
                  Clear all
                </Button>
              }
              confirmation={
                <DeleteConfirmation
                  active={confirming?.kind === 'all'}
                  confirmLabel={`Delete all ${String(items.length)} notes for good`}
                  cancelLabel="Keep all notes in Trash"
                  disabled={busy || items.some((item) => item.pending)}
                  onConfirm={() => deleteForever(items)}
                  onCancel={() => setConfirming(null)}
                />
              }
            />
          )
        }
      />
      <div className="space-y-4">
        {outcome === null ? null : (
          <p className="sr-only" role="status" aria-live="polite">
            {outcome}
          </p>
        )}
        {failure === null ? null : <Notice tone="problem" message={failure} />}
        {loading ? (
          <LoadingState shape="list" rows={4} label="The trash is loading." />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<TrashIcon size={20} />}
            title="The trash is empty"
            description="A note you delete waits here until you restore it or select Delete."
          />
        ) : (
          <section aria-labelledby="trash-heading">
            <h2 className={pageGroupLabelClassName()} id="trash-heading">
              Deleted notes
            </h2>
            <ul className={trashListClassName}>
              {items.map((item) => {
                const name = displayNoteName(item.path);
                const folder = folderOf(item.path);
                const when =
                  item.deletedAt === null
                    ? ''
                    : relativeTime(item.deletedAt, now);
                const where = folder === null ? 'Top level' : folder;
                const parts = [where];
                if (when !== '') parts.push(`deleted ${when}`);
                if (item.pending) parts.push('waiting to go up');
                return (
                  <ListRow key={item.fileId} className="flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-ui text-strong">
                        {folder === null ? name : name.slice(folder.length + 1)}
                      </p>
                      <p className="m-0 truncate text-control text-muted">
                        {parts.join(' \u00b7 ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-cluster">
                      <Button
                        variant="secondary"
                        size="sm"
                        compact
                        disabled={busy}
                        label={`Restore ${name}`}
                        onClick={() => restore(item)}
                      >
                        Restore
                      </Button>
                      <ActionSlot
                        place="row"
                        confirming={
                          confirming?.kind === 'one' &&
                          confirming.fileId === item.fileId
                        }
                        action={
                          <Button
                            variant="ghost"
                            size="sm"
                            tone="danger"
                            disabled={busy || item.pending}
                            icon={<TrashIcon />}
                            label={`Delete ${name}`}
                            onClick={() =>
                              setConfirming({
                                kind: 'one',
                                fileId: item.fileId,
                              })
                            }
                          >
                            Delete
                          </Button>
                        }
                        confirmation={
                          <DeleteConfirmation
                            active={
                              confirming?.kind === 'one' &&
                              confirming.fileId === item.fileId
                            }
                            confirmLabel={`Delete ${name} for good`}
                            cancelLabel={`Keep ${name} in Trash`}
                            disabled={busy}
                            onConfirm={() => deleteForever([item])}
                            onCancel={() => setConfirming(null)}
                          />
                        }
                      />
                    </div>
                  </ListRow>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </Page>
  );
}
