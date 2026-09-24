/**
 * The row of formatting tools above the note text (record 0094).
 *
 * `lib/format-toolbar.ts` decides the tools, their order, their groups, what
 * a phone moves into More, and the classes of the row. This file turns one
 * tool into its control. A tool runs a format action of `@notesapp/editor`
 * through `onFormat`, which the note screen points at its one editor view, so
 * a tool runs the command of its key on the same document, with the same undo
 * and the same selection.
 *
 * The row is one `toolbar` with one tab stop. The arrow keys, Home and End
 * move inside it, and the tab stop follows the focus, so Tab and Shift and
 * Tab leave the row from the tool a person is on. When the focus leaves, the
 * stop goes back to the first tool, which every width shows.
 *
 * A tool takes the focus when it is pressed. That ends an IME composition in
 * the editor before the action runs, and the action then gives the focus back
 * to the editor.
 */
import { useRef, useState, type ReactNode } from 'react';
import { formatActionOf, type FormatActionId } from '@notesapp/editor';
import {
  Button,
  buttonClassName,
  edgeControlClassName,
  Menu,
  MoreIcon,
  type MenuItem,
} from '@notesapp/ui';
import {
  formatToolbar,
  formatToolbarClassName,
  formatToolbarFrameClassName,
  formatToolbarLabel,
  formatToolClassName,
  formatToolGroupClassName,
  formatToolTitle,
  moreFormattingClassName,
  moreFormattingLabel,
  overflowTools,
  toolbarFocusTarget,
  type FormatTool,
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

/**
 * The trigger of the first tool of the row.
 *
 * It takes the pull of a control at the edge of a frame, so its mark stands
 * on the line where the note text starts.
 */
const firstToolClassName = buttonClassName({
  variant: 'ghost',
  size: 'sm',
  iconOnly: true,
  compact: true,
  className: edgeControlClassName({ edge: 'start', mark: 'icon' }),
});

/** The row of formatting tools of one open note. */
export function FormatToolbar({
  onFormat,
}: {
  /** Runs one format action on the editor of the open note. */
  readonly onFormat: (id: FormatActionId) => void;
}): ReactNode {
  const rowRef = useRef<HTMLDivElement | null>(null);
  // The place, in the order of the document, of the one tool in the tab
  // order.
  const [stop, setStop] = useState(0);

  /** Every tool of the row, in the order of the document. */
  const tools = (): HTMLButtonElement[] =>
    Array.from(rowRef.current?.querySelectorAll('button') ?? []);

  const renderTool = (tool: FormatTool, place: number): ReactNode => {
    const tabIndex = place === stop ? 0 : -1;
    if (tool.kind === 'menu')
      return (
        <Menu
          label={tool.label}
          icon={actionIcon(tool.icon)}
          align="start"
          compact
          triggerTabIndex={tabIndex}
          triggerClassName={place === 0 ? firstToolClassName : undefined}
          items={tool.actions.map((id): MenuItem => ({
            id,
            label: formatActionOf(id).label,
            onSelect: () => onFormat(id),
          }))}
        />
      );
    return (
      <Button
        variant="ghost"
        size="sm"
        compact
        label={formatActionOf(tool.id).label}
        title={titleOf(tool.id)}
        icon={actionIcon(tool.icon)}
        tabIndex={tabIndex}
        onClick={() => onFormat(tool.id)}
      />
    );
  };

  let place = 0;
  return (
    <div className={formatToolbarFrameClassName()}>
      <div
        ref={rowRef}
        role="toolbar"
        aria-label={formatToolbarLabel}
        aria-orientation="horizontal"
        className={formatToolbarClassName()}
        onFocus={(event): void => {
          // React types the target of a focus event as the row itself, but a
          // focus event bubbles up from the tool that took the focus.
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
          // An open menu handles its own keys, and its rows are not tools.
          if (event.defaultPrevented) return;
          const shown = tools().filter(
            (tool) => tool.getClientRects().length > 0,
          );
          const at = shown.findIndex((tool) => tool === event.target);
          if (at === -1) return;
          const target = toolbarFocusTarget(event.key, at, shown.length);
          if (target === null) return;
          event.preventDefault();
          shown[target]?.focus();
        }}
      >
        {formatToolbar.map((group) => (
          <div
            key={group.map((tool) => tool.id).join(' ')}
            className={formatToolGroupClassName(group)}
          >
            {group.map((tool) => {
              const at = place;
              place += 1;
              return (
                <span key={tool.id} className={formatToolClassName(tool)}>
                  {renderTool(tool, at)}
                </span>
              );
            })}
          </div>
        ))}
        <div className={moreFormattingClassName}>
          <Menu
            label={moreFormattingLabel}
            icon={<MoreIcon />}
            align="end"
            compact
            triggerTabIndex={place === stop ? 0 : -1}
            items={overflowTools().map((tool): MenuItem => ({
              id: tool.id,
              label: formatActionOf(tool.id).label,
              icon: actionIcon(tool.icon),
              onSelect: () => onFormat(tool.id),
            }))}
          />
        </div>
      </div>
    </div>
  );
}
