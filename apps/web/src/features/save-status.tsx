/**
 * Local save feedback of the note editor.
 *
 * Routine local persistence stays quiet. Storage full and Save failed keep
 * the recovery controls visible. The editor exposes its state as data for
 * automation without showing a routine saved notification.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { SaveState } from './save-state.ts';
export { resolveSaveState } from './save-state.ts';
export type { SaveState, SaveStateInput } from './save-state.ts';
import { Button, CheckIcon, CopyIcon } from '@notesapp/ui';
import { AttentionLink } from './attention-link.tsx';

/** Failure copy shown only when persistence needs user action. */
const failureCopy = {
  'storage-full': 'Storage full',
  'save-failed': 'Save failed',
} as const;

/**
 * Blocks an unsafe reload while unsaved work sits only in memory.
 *
 * The browser shows its own leave confirmation. The editor keeps its buffer
 * mounted, so after the user stays the text and the selection are intact.
 */
export function useBlockUnsafeReload(blocked: boolean): void {
  useEffect(() => {
    if (!blocked) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [blocked]);
}

/**
 * The save status line with failure recovery.
 *
 * On a storage failure the editor keeps its in-memory buffer mounted and this
 * component offers clipboard access to it through `bufferText` and
 * `onCopyBuffer`. It never reloads the page and never discards the text.
 */
export function SaveStatus({
  state,
  detail,
  bufferText,
  onCopyBuffer,
  workspaceId,
  attentionCount = 0,
}: {
  readonly state: SaveState;
  readonly detail?: string | undefined;
  readonly bufferText?: string | undefined;
  readonly onCopyBuffer?: ((text: string) => Promise<boolean>) | undefined;
  /** The workspace the Needs attention link points into. */
  readonly workspaceId?: string | undefined;
  /** How many saves wait in the Needs attention list. */
  readonly attentionCount?: number | undefined;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const failed = state === 'save-failed' || state === 'storage-full';
  const canCopy =
    failed && bufferText !== undefined && onCopyBuffer !== undefined;

  if (!failed) return null;
  const label =
    state === 'storage-full'
      ? failureCopy['storage-full']
      : failureCopy['save-failed'];

  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex items-center rounded-full border border-danger/30 bg-danger/15 px-2.5 py-1 text-control font-medium text-danger">
        <span role="status" aria-live="polite">
          [error] {label}
          {detail !== undefined && detail !== '' ? ` (${detail})` : null}
        </span>
      </div>
      {failed ? (
        <p className="m-0 text-control text-danger" role="alert">
          The note stays open with its text. Copy it before you close the tab.
        </p>
      ) : null}
      {workspaceId !== undefined ? (
        <AttentionLink
          workspaceId={workspaceId}
          count={attentionCount}
          className="text-control font-medium text-danger underline focus-visible:outline-2 focus-visible:outline-focus"
        />
      ) : null}
      {canCopy ? (
        <Button
          variant="secondary"
          size="sm"
          icon={copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          onClick={() => {
            const text = bufferText ?? '';
            const copy =
              onCopyBuffer ?? ((): Promise<boolean> => Promise.resolve(false));
            void copy(text).then((ok) => {
              setCopied(ok);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy note text'}
        </Button>
      ) : null}
    </div>
  );
}
