/**
 * The row of formatting tools above the note text, and its palette rows.
 *
 * A person who does not know Markdown formats a note from this row (record
 * 0094). Each tool names a format action of `@notesapp/editor`, and the
 * command of that action is the one its key runs, so a tool never holds a
 * formatting rule of its own. The label and the key of a tool come from the
 * same action.
 *
 * The command palette offers every tool of this row as well, and
 * {@link formatPaletteRows} derives those rows from {@link formatToolbar}. A
 * tool that joins or leaves the row therefore joins or leaves the palette in
 * the same change, and no second list can drift from the first.
 *
 * The row holds four groups that space separates: the heading, the marks of
 * a word, the shapes of a block, and the table. A phone shows the tools a
 * person uses most, and one More formatting menu holds the rest in the order
 * of the row.
 *
 * This module is pure, so a unit test holds the row, the palette rows, the
 * titles and the keyboard rule.
 */
import { formatActionOf, type FormatActionId } from '@notesapp/editor';
import type { ActionIconName } from './palette-items.ts';

/** One button of the row. */
export type FormatButton = {
  readonly kind: 'action';
  readonly id: FormatActionId;
  readonly icon: ActionIconName;
  /** True when a phone shows the tool in the row and not in More. */
  readonly narrow: boolean;
};

/** One menu of the row, whose rows are format actions. */
export type FormatMenu = {
  readonly kind: 'menu';
  readonly id: 'heading';
  readonly label: string;
  readonly icon: ActionIconName;
  readonly actions: readonly FormatActionId[];
  readonly narrow: boolean;
};

/** One tool of the row. */
export type FormatTool = FormatButton | FormatMenu;

/** A button of the row. */
function button(
  id: FormatActionId,
  icon: ActionIconName,
  narrow: boolean,
): FormatButton {
  return { kind: 'action', id, icon, narrow };
}

/**
 * The groups of the row, in the order a person reads them.
 *
 * Heading is a menu of three levels, because a note rarely goes deeper and
 * the keys still reach levels four to six.
 */
export const formatToolbar: readonly (readonly FormatTool[])[] = [
  [
    {
      kind: 'menu',
      id: 'heading',
      label: 'Heading',
      icon: 'heading',
      actions: ['heading-1', 'heading-2', 'heading-3'],
      narrow: true,
    },
  ],
  [
    button('bold', 'bold', true),
    button('italic', 'italic', true),
    button('strikethrough', 'strikethrough', false),
    button('inline-code', 'inline-code', false),
    button('link', 'insert-link', true),
  ],
  [
    button('bullet-list', 'bullet-list', true),
    button('ordered-list', 'ordered-list', false),
    button('task-list', 'task-list', true),
    button('quote', 'quote', false),
  ],
  [button('table', 'table', false)],
];

/** The accessible name of the menu that holds the rest on a phone. */
export const moreFormattingLabel = 'More formatting';

/** The accessible name of the row. */
export const formatToolbarLabel = 'Formatting';

/** The buttons that a phone moves into the More formatting menu. */
export function overflowTools(): readonly FormatButton[] {
  return formatToolbar
    .flat()
    .filter((tool): tool is FormatButton => tool.kind === 'action')
    .filter((tool) => !tool.narrow);
}

/** One row that the command palette offers for one format action. */
export type FormatPaletteRow = {
  readonly id: string;
  readonly action: FormatActionId;
  readonly label: string;
  readonly keywords: string;
  readonly icon: ActionIconName;
  readonly keys: string | undefined;
};

/** Words that also find a format action in the palette. */
const paletteWords: Readonly<Partial<Record<FormatActionId, string>>> = {
  'heading-1': 'title',
  'heading-2': 'title',
  'heading-3': 'title',
  bold: 'strong heavy',
  italic: 'emphasis slant',
  strikethrough: 'strike cross out',
  'inline-code': 'code span',
  link: 'url address',
  'bullet-list': 'unordered',
  'ordered-list': 'numbered',
  'task-list': 'checklist todo checkbox',
  quote: 'quotation',
  table: 'grid columns rows',
};

/**
 * The palette rows of every tool of the row, in the order of the row.
 *
 * A menu gives one row for each of its actions, with the glyph of the menu.
 */
export function formatPaletteRows(): readonly FormatPaletteRow[] {
  return formatToolbar.flat().flatMap((tool) =>
    (tool.kind === 'menu' ? tool.actions : [tool.id]).map((id) => {
      const action = formatActionOf(id);
      return {
        id: `format-${id}`,
        action: id,
        label: action.label,
        keywords: `format markdown ${paletteWords[id] ?? ''}`.trim(),
        icon: tool.icon,
        keys: action.keys ?? undefined,
      };
    }),
  );
}

/**
 * The tooltip of one tool: its name and the keys of this device.
 *
 * `signs` are the key caps that `shell/modifier-key.ts` reads for the key
 * line of the action. An Apple keyboard writes them together, as its menus
 * do, and every other keyboard joins them with a plus.
 */
export function formatToolTitle(
  label: string,
  signs: readonly string[],
  apple: boolean,
): string {
  if (signs.length === 0) return label;
  return `${label} (${signs.join(apple ? '' : ' + ')})`;
}

/**
 * The tool that one key moves the focus to, inside the row.
 *
 * The row is one tab stop, and the arrow keys move inside it, as a toolbar
 * does. The arrows wrap at both ends, and Home and End reach the first and
 * the last tool. Any other key answers null and keeps its meaning.
 */
export function toolbarFocusTarget(
  key: string,
  index: number,
  count: number,
): number | null {
  if (count === 0) return null;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * The classes of the band that holds the row, above the note text.
 *
 * The band draws `edge-line` under itself, because the note text below is a
 * region a person scrolls, as the footer does above itself
 * (`noteFooterClassName` in `./note-column.ts`). Its inline padding is the
 * one of the footer, so the row and the text start on one line.
 */
export function formatToolbarFrameClassName(): string {
  return 'shrink-0 border-b border-edge-line px-2 py-1';
}

/**
 * The classes of the row, on the measure of the note (record 0055).
 *
 * Under the medium width a compact control keeps a touch target of 44 px, so
 * the space inside that target separates two tools and the row adds one small
 * step between groups. From the medium width up a control is as small as its
 * mark, so the row spaces the groups by the named step of a group.
 */
export function formatToolbarClassName(): string {
  return 'mx-auto flex w-full max-w-note flex-wrap items-center gap-1 md:gap-group';
}

/**
 * The classes of one group of the row.
 *
 * A group whose tools all move into More on a phone takes no place there.
 */
export function formatToolGroupClassName(group: readonly FormatTool[]): string {
  const onPhone = group.some((tool) => tool.narrow);
  return `${onPhone ? 'flex' : 'hidden sm:flex'} items-center md:gap-1`;
}

/** The classes around a tool that a phone moves into More. */
export function formatToolClassName(tool: FormatTool): string {
  return tool.narrow ? 'contents' : 'hidden sm:contents';
}

/** The classes around the More formatting menu, which a phone alone shows. */
export const moreFormattingClassName = 'sm:hidden';
