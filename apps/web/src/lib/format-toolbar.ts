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
 * The row holds four groups that space separates: the headings, the marks of
 * a word, the shapes of a block, and the table. Every tool is a button of the
 * row at every width. A row wider than the screen scrolls sideways, so a new
 * tool is one more entry here and never a menu that covers the text.
 *
 * This module is pure, so a unit test holds the row, the palette rows, the
 * titles and the keyboard rule.
 */
import {
  formatActionApplies,
  formatActionOf,
  type FormatActionId,
  type FormatContext,
} from '@notesapp/editor';
import { controlStripClassName } from '@notesapp/ui';
import type { ActionIconName } from './palette-items.ts';
import { tableActionRows } from './table-menu.ts';

/** One tool of the row: a format action and its glyph. */
export type FormatTool = {
  readonly id: FormatActionId;
  readonly icon: ActionIconName;
};

/** A tool of the row. */
function tool(id: FormatActionId, icon: ActionIconName): FormatTool {
  return { id, icon };
}

/**
 * The groups of the row, in the order a person reads them.
 *
 * Every tool is a button of the row, and no tool is a menu, so no list opens
 * over the text that a person selected (record 0094). The keys still reach
 * the heading levels four to six.
 */
export const formatToolbar: readonly (readonly FormatTool[])[] = [
  [
    tool('heading-1', 'heading-one'),
    tool('heading-2', 'heading-two'),
    tool('heading-3', 'heading-three'),
  ],
  [
    tool('bold', 'bold'),
    tool('italic', 'italic'),
    tool('strikethrough', 'strikethrough'),
    tool('inline-code', 'inline-code'),
    tool('link', 'insert-link'),
  ],
  [
    tool('bullet-list', 'bullet-list'),
    tool('ordered-list', 'ordered-list'),
    tool('task-list', 'task-list'),
    tool('quote', 'quote'),
  ],
  [tool('table', 'table')],
];

/**
 * The actions of a table, which the command palette offers while the caret is
 * in a table. They come from the one list of `./table-menu.ts`, which the menu
 * of a row or a column reads as well (record 0097), and they are not tools of
 * the row: a table carries its own controls.
 */
export const tableActions: readonly FormatTool[] = tableActionRows.map((row) =>
  tool(row.id, row.icon),
);

/**
 * Whether one tool applies where the caret stands.
 *
 * A block tool does nothing inside a table, because a table line is a row, so
 * the row shows it disabled and keeps its place. The same holds for the
 * removal of the header row and of the last column.
 */
export function toolApplies(tool: FormatTool, context: FormatContext): boolean {
  return formatActionApplies(formatActionOf(tool.id), context);
}

/** The accessible name of the row. */
export const formatToolbarLabel = 'Formatting';

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
  'table-row-above': 'table add insert',
  'table-row-below': 'table add insert',
  'table-column-left': 'table add insert',
  'table-column-right': 'table add insert',
  'table-move-row-up': 'table reorder drag',
  'table-move-row-down': 'table reorder drag',
  'table-move-column-left': 'table reorder drag',
  'table-move-column-right': 'table reorder drag',
  'table-delete-row': 'table remove',
  'table-delete-column': 'table remove',
  'table-delete': 'table remove clear whole',
  'table-align-left': 'table column',
  'table-align-center': 'table column middle',
  'table-align-right': 'table column',
};

/**
 * The palette rows of every tool of the row and every table action that
 * applies where the caret stands, in that order.
 */
export function formatPaletteRows(
  context: FormatContext,
): readonly FormatPaletteRow[] {
  return [...formatToolbar.flat(), ...tableActions]
    .filter((tool) => toolApplies(tool, context))
    .map(({ id, icon }) => {
      const action = formatActionOf(id);
      return {
        id: `format-${id}`,
        action: id,
        label: action.label,
        keywords: `format markdown ${paletteWords[id] ?? ''}`.trim(),
        icon,
        keys: action.keys ?? undefined,
      };
    });
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
  return 'shrink-0 border-b border-edge-line px-2';
}

/** The classes of the column that holds the row, on the note measure (0055). */
export function formatToolbarColumnClassName(): string {
  return 'mx-auto w-full max-w-note';
}

/**
 * The classes of the row itself.
 *
 * The row is a strip that scrolls sideways when it holds more tools than the
 * width of the screen (`controlStripClassName`), so a phone reaches every tool
 * in the row and a new tool never needs a menu. Under the medium width the
 * touch target of a control separates two tools and the row adds one small
 * step between groups. From the medium width up a control is as small as its
 * mark, so the row spaces the groups by the named step of a group.
 */
export function formatToolbarClassName(): string {
  return `${controlStripClassName()} gap-1 md:gap-group`;
}

/** The classes of one group of the row, which never shrinks in the strip. */
export function formatToolGroupClassName(): string {
  return 'flex shrink-0 items-center md:gap-1';
}
