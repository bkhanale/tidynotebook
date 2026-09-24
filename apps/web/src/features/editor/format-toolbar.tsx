/**
 * The row of formatting tools above the note text (record 0094).
 *
 * `lib/format-toolbar.ts` decides the tools, their order, their groups and
 * the classes of the row. This file turns one
 * tool into its control. A tool runs a format action of `@notesapp/editor`
 * through `onFormat`, which the note screen points at its one editor view, so
 * a tool runs the command of its key on the same document, with the same undo
 * and the same selection.
 *
 * The row is one `toolbar` with one tab stop. The arrow keys, Home and End
 * move inside it, and the tab stop follows the focus, so Tab and Shift and
 * Tab leave the row from the tool a person is on. When the focus leaves, the
 * stop goes back to the first tool. Every tool is a button of the row, and a
 * row wider than the screen scrolls sideways, so no menu covers the text.
 *
 * A tool takes the focus when it is pressed. That ends an IME composition in
 * the editor before the action runs, and the action then gives the focus back
 * to the editor.
 */
import { useRef, useState, type ReactNode } from 'react';
import { formatActionOf, type FormatActionId } from '@notesapp/editor';
import { Button } from '@notesapp/ui';
import {
  formatToolbar,
  formatToolbarClassName,
  formatToolbarColumnClassName,
  formatToolbarFrameClassName,
  formatToolbarLabel,
  formatToolGroupClassName,
  formatToolTitle,
  toolbarFocusTarget,
} from '../../lib/format-toolbar.ts';
import { actionIcon } from '../../shell/action-icons.tsx';
import { appleKeyboard, keyHintParts } from '../../shell/modifier-key.ts';

/** The tooltip of one action, with the keys of this device. */
function titleOf(id: FormatActionId): string {
  const action = formatActionOf(id);
  const signs =
    action.keys === null
      ? []
      : keyHintParts(action.keys).flatMap((part) =>
          part.kind === 'key' ? [part.cap.sign] : [],
        );
  return formatToolTitle(action.label, signs, appleKeyboard);
}

/** The row of formatting tools of one open note. */
export function FormatToolbar({
  onFormat,
}: {
  /** Runs one format action on the editor of the open note. */
  readonly onFormat: (id: FormatActionId) => void;
}): ReactNode {
  const rowRef = useRef<HTMLDivElement | null>(null);
  // The place, in the order of the row, of the one tool in the tab order.
  const [stop, setStop] = useState(0);

  /** Every tool of the row, in the order of the document. */
  const tools = (): HTMLButtonElement[] =>
    Array.from(rowRef.current?.querySelectorAll('button') ?? []);

  let place = 0;
  return (
    <div className={formatToolbarFrameClassName()}>
      <div className={formatToolbarColumnClassName()}>
        <div
          ref={rowRef}
          role="toolbar"
          aria-label={formatToolbarLabel}
          aria-orientation="horizontal"
          className={formatToolbarClassName()}
          onFocus={(event): void => {
            // React types the target of a focus event as the row itself, but
            // a focus event bubbles up from the tool that took the focus.
            const focused: EventTarget = event.target;
            const at = tools().findIndex((tool) => tool === focused);
            if (at !== -1) setStop(at);
          }}
          onBlur={(event): void => {
            const next = event.relatedTarget;
            if (next instanceof Node && rowRef.current?.contains(next) === true)
              return;
            setStop(0);
          }}
          onKeyDown={(event): void => {
            const all = tools();
            const at = all.findIndex((tool) => tool === event.target);
            if (at === -1) return;
            const target = toolbarFocusTarget(event.key, at, all.length);
            if (target === null) return;
            event.preventDefault();
            // The browser scrolls the row to a tool that takes the focus, so
            // the keyboard reaches a tool past the edge of a phone.
            all[target]?.focus();
          }}
        >
          {formatToolbar.map((group) => (
            <div
              key={group.map((tool) => tool.id).join(' ')}
              className={formatToolGroupClassName()}
            >
              {group.map((tool) => {
                const at = place;
                place += 1;
                return (
                  <Button
                    key={tool.id}
                    variant="ghost"
                    size="sm"
                    compact
                    label={formatActionOf(tool.id).label}
                    title={titleOf(tool.id)}
                    icon={actionIcon(tool.icon)}
                    tabIndex={at === stop ? 0 : -1}
                    onClick={() => onFormat(tool.id)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
