/**
 * Local save feedback of the note editor.
 *
 * The design fixes the wording: Saving on this device shows until the draft
 * transaction commits, Saved on this device shows after it, and Saved to
 * server shows only for acknowledged content. Storage full and Save failed
 * cover the failure paths. Labels use words and symbols, never
 * color alone, so the state survives themes and contrast limits.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { SaveState } from './save-state.ts';
export { resolveSaveState } from './save-state.ts';
export type { SaveState, SaveStateInput } from './save-state.ts';
import {
  AlertCircleIcon,
  Button,
  CheckIcon,
  CloudCheckIcon,
  CloudUploadIcon,
  CopyIcon,
} from '@notesapp/ui';

/** The human readable label of one save state. */
export const saveStateLabels: Record<SaveState, string> = {
  'saving-local': 'Saving on this device',
  'saved-local': 'Saved on this device',
  syncing: 'Syncing',
  'saved-server': 'Saved to server',
  'storage-full': 'Storage full',
  'save-failed': 'Save failed',
};

/** A text symbol of one save state, so color is never the only signal. */
export const saveStateSymbols: Record<SaveState, string> = {
  'saving-local': '...',
  'saved-local': '[saved]',
  syncing: '[syncing]',
  'saved-server': '[synced]',
  'storage-full': '[full]',
  'save-failed': '[error]',
};

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
}: {
  readonly state: SaveState;
  readonly detail?: string | undefined;
  readonly bufferText?: string | undefined;
  readonly onCopyBuffer?: ((text: string) => Promise<boolean>) | undefined;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const failed = state === 'save-failed' || state === 'storage-full';
  const canCopy =
    failed && bufferText !== undefined && onCopyBuffer !== undefined;

  const pillClass =
    state === 'saving-local' || state === 'syncing'
      ? 'notes-save-pill-saving'
      : state === 'saved-local' || state === 'saved-server'
        ? 'notes-save-pill-saved'
        : 'notes-save-pill-error';

  const icon =
    state === 'saving-local' || state === 'syncing' ? (
      <CloudUploadIcon size={14} />
    ) : state === 'saved-local' || state === 'saved-server' ? (
      <CloudCheckIcon size={14} />
    ) : (
      <AlertCircleIcon size={14} />
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div className={`notes-save-pill ${pillClass}`}>
        <span aria-hidden="true">{icon}</span>
        <span role="status" aria-live="polite">
          {saveStateSymbols[state]} {saveStateLabels[state]}
          {detail !== undefined && detail !== '' ? ` (${detail})` : null}
        </span>
      </div>
      {failed ? (
        <p className="notes-status-error" role="alert">
          The note stays open with its text. Copy it before you close the tab.
        </p>
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
