/**
 * The keyboard shortcuts dialog.
 *
 * The rows come from `shortcuts` in `packages/editor`, which is the same
 * table the key maps are built from, so a shortcut the code registers and a
 * shortcut the dialog shows cannot drift apart.
 *
 * That table names both platforms in one string. `KeyHint` shows the one key
 * of this device instead, so the person reads the key that is on the
 * keyboard in front of them.
 */
import type { ReactNode } from 'react';
import { shortcuts } from '@notesapp/editor';
import { Button, Dialog, DialogBody, DialogFooter } from '@notesapp/ui';
import { KeyHint } from './key-hint.tsx';

/** The dialog that lists every shortcut. */
export function ShortcutsDialog({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      titleId="keyboard-shortcuts-title"
      width="medium"
    >
      <DialogBody>
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-ui">
          {shortcuts.map((shortcut) => (
            <div className="contents" key={shortcut.keys}>
              <dt className="min-w-0 text-ink">{shortcut.description}</dt>
              <dd className="m-0 text-right">
                <kbd className="rounded border border-edge bg-hover px-1.5 py-0.5 text-control text-strong">
                  <KeyHint keys={shortcut.keys} />
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
