/**
 * The Needs attention screen: every save the server refused for good.
 *
 * A refused save is parked. It is never sent again, so without this screen
 * the text lives only in a browser row that nothing reads. Here the person
 * sees the note name, one sentence for the cause, and how long ago it
 * happened, and takes one of four actions.
 *
 * Retry writes the text again on top of the current accepted head, so a save
 * that a stale head or a taken name refused can now succeed. Save as new note
 * keeps the text in a separate note. Copy text puts it on the clipboard.
 * Discard needs a second click, because it is the only action that ends with
 * the text gone.
 *
 * The screen calls no network operation. Everything runs through the local
 * store, and the sync engine sends the requeued save.
 */
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { generateUUID } from '@notesapp/core';
import { isLocalStorageError, type Draft } from '@notesapp/sync';
import { Button, CopyIcon, StatusRegion, TrashIcon } from '@notesapp/ui';
import { attentionTitle, useParkedSaves } from './attention-link.tsx';
import { useLocalStore, useSession } from '../app.tsx';
import { copyText } from '../platform.ts';
import { storageNotePath } from './note-name.ts';
import {
  parkedSaveTime,
  recoveredNoteName,
  type ParkedSave,
} from './parked-saves.ts';

/** One row of the list with its four actions. */
function ParkedSaveRow({
  save,
  now,
  onRetry,
  onSaveAsNew,
  onDiscard,
}: {
  readonly save: ParkedSave;
  readonly now: Date;
  readonly onRetry: (save: ParkedSave) => void;
  readonly onSaveAsNew: (save: ParkedSave) => void;
  readonly onDiscard: (save: ParkedSave) => void;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="rounded-lg border border-edge-subtle bg-card p-3">
      <h3 className="m-0 text-ui font-semibold text-strong">{save.name}</h3>
      <p className="mb-1 mt-1 text-control text-muted">
        {save.reason} Kept on this device {parkedSaveTime(save.createdAt, now)}.
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-control text-muted">
          Kept text
        </summary>
        <pre
          className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-edge-subtle bg-surface p-2 text-control"
          aria-label={`Kept text of ${save.name}`}
        >
          {save.text}
        </pre>
      </details>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          label={`Retry the save of ${save.name}`}
          onClick={() => {
            onRetry(save);
          }}
        >
          Retry
        </Button>
        <Button
          variant="secondary"
          size="sm"
          label={`Keep the text of ${save.name} as a new note`}
          onClick={() => {
            onSaveAsNew(save);
          }}
        >
          Save as new note
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<CopyIcon size={14} />}
          label={`Copy the text of ${save.name}`}
          onClick={() => {
            void copyText(save.text).then((ok) => {
              setCopied(ok);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy text'}
        </Button>
        {confirming ? (
          <>
            <Button
              variant="danger"
              size="sm"
              icon={<TrashIcon size={14} />}
              label={`Confirm that the kept text of ${save.name} is discarded`}
              onClick={() => {
                setConfirming(false);
                onDiscard(save);
              }}
            >
              Confirm discard
            </Button>
            <Button
              variant="ghost"
              size="sm"
              label={`Keep the text of ${save.name}`}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            icon={<TrashIcon size={14} />}
            label={`Discard the kept text of ${save.name}`}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Discard
          </Button>
        )}
      </div>
    </li>
  );
}

/** The routed Needs attention screen of one workspace. */
export function AttentionRoute(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const session = useSession();
  const { store } = useLocalStore();
  const accountId = session.account?.accountId ?? null;
  const { saves, error, reload } = useParkedSaves(
    store,
    accountId,
    workspaceId,
  );
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const now = new Date();

  if (workspaceId === null || accountId === null || store === null)
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <h1 className="mb-4 mt-0 text-xl font-semibold text-strong">
          {attentionTitle}
        </h1>
        <StatusRegion message="Loading the saves that need attention." />
      </main>
    );

  const activeStore = store;
  const activeAccount = accountId;
  const activeWorkspace = workspaceId;

  /** Reports one local write failure without losing the kept text. */
  const reportFailure = (action: string, thrown: unknown): void => {
    setFailure(
      isLocalStorageError(thrown)
        ? `${action} did not work on this device (${thrown.kind}). The text is still kept.`
        : `${action} did not work on this device. The text is still kept.`,
    );
  };

  /** Writes one text as a checkpoint on top of the accepted head it names. */
  const queueText = async (
    fileId: string,
    path: string,
    text: string,
  ): Promise<void> => {
    const files = await activeStore.listAcceptedFiles(
      activeAccount,
      activeWorkspace,
    );
    const accepted =
      files.find((file) => file.fileId === fileId)?.acceptedHeadRevisionId ??
      null;
    const draft: Draft = {
      accountId: activeAccount,
      workspaceId: activeWorkspace,
      workingCopyId: generateUUID(),
      fileId,
      baseRevisionId: accepted,
      text,
      path,
      deleted: false,
      sequence: 1,
    };
    await activeStore.saveDraft(draft);
    await activeStore.checkpoint(draft, null);
    await activeStore.dropDraft(
      activeAccount,
      activeWorkspace,
      draft.workingCopyId,
    );
  };

  /** Removes the parked entry and its kept copy after an action settled it. */
  const settle = async (save: ParkedSave): Promise<void> => {
    if (save.mutationId !== null)
      await activeStore.discardParkedSave(
        activeAccount,
        activeWorkspace,
        save.mutationId,
      );
    await activeStore.removeRecovery(
      activeAccount,
      activeWorkspace,
      save.recoveryId,
    );
  };

  const onRetry = (save: ParkedSave): void => {
    void (async (): Promise<void> => {
      try {
        await queueText(save.fileId, save.path, save.text);
        await settle(save);
        setFailure(null);
        setNotice(`The save of ${save.name} is queued again.`);
        reload();
      } catch (thrown: unknown) {
        reportFailure('The retry', thrown);
      }
    })();
  };

  const onSaveAsNew = (save: ParkedSave): void => {
    void (async (): Promise<void> => {
      try {
        const files = await activeStore.listLocalFiles(
          activeAccount,
          activeWorkspace,
        );
        const name = recoveredNoteName(
          save.name,
          files.map((file) => file.path),
        );
        await queueText(generateUUID(), storageNotePath(name), save.text);
        await settle(save);
        setFailure(null);
        setNotice(`The text is kept as the note ${name}.`);
        reload();
      } catch (thrown: unknown) {
        reportFailure('The new note', thrown);
      }
    })();
  };

  const onDiscard = (save: ParkedSave): void => {
    void (async (): Promise<void> => {
      try {
        await settle(save);
        setFailure(null);
        setNotice(`The kept text of ${save.name} is discarded.`);
        reload();
      } catch (thrown: unknown) {
        reportFailure('The discard', thrown);
      }
    })();
  };

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <h1 className="mb-2 mt-0 text-xl font-semibold text-strong">
        {attentionTitle}
      </h1>
      <p className="m-0 text-ui text-muted">
        These texts did not become server versions, so they wait here. Retry one
        to save it again on the current version of its note, or keep it as a new
        note.
      </p>
      {error !== null ? (
        <p className="text-control text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {failure !== null ? (
        <p className="text-control text-danger" role="alert">
          {failure}
        </p>
      ) : null}
      {notice !== '' ? <StatusRegion message={notice} /> : null}
      {saves.length === 0 ? (
        <p className="m-0 text-ui">
          No save needs attention.{' '}
          <Link to={`/w/${activeWorkspace}`}>Back to the notes.</Link>
        </p>
      ) : (
        <ul className="m-0 list-none space-y-3 p-0">
          {saves.map((save) => (
            <ParkedSaveRow
              key={save.recoveryId}
              save={save}
              now={now}
              onRetry={onRetry}
              onSaveAsNew={onSaveAsNew}
              onDiscard={onDiscard}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
