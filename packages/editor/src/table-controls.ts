/**
 * The controls that a table carries (records 0096 and 0097).
 *
 * - A bar under the table adds a row at its end, and a bar at its right edge
 *   adds a column.
 * - A handle at the start of a row and a handle above a column open the menu
 *   of that row or that column: insert, delete, and the alignment of a column.
 *
 * The controls stand in one layer over the text, inside the scroller of the
 * editor, so they replace no text and the set of widget kinds of record 0002
 * stays closed. The layer is the way CodeMirror draws its own selection and
 * its tooltips: an element beside the content, placed from what the view
 * measures. A bar runs a table command of `table-grid.ts`. A handle asks the
 * application to open its menu through `tableMenuOpener`, because the menu is
 * a control of `packages/ui` and the editor renders no React.
 *
 * The controls show for one table at a time: the table under the pointer, or
 * the table that holds the caret, which is how a phone reaches them after a
 * tap in a cell. The handles follow the cell under the pointer, or the cell of
 * the caret. A control takes no focus from the editor. The keyboard reaches
 * every action of the menu from the command palette, and it adds a row with
 * Tab and Enter.
 */
import { Facet, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { editingTransaction } from './commands.ts';
import { glyph, type GlyphPart } from './icon-mark.ts';
import {
  addColumnAtEndEdit,
  addRowAtEndEdit,
  tableContextAt,
  tableEditSpec,
  type FormatContext,
} from './table-grid.ts';

/** The names of the controls, which a person hears and reads. */
export const tableControlLabels = {
  row: 'Add a row',
  column: 'Add a column',
  rowMenu: 'Row actions',
  columnMenu: 'Column actions',
} as const;

/** A place on the screen, in the coordinates of the viewport. */
export type ScreenRect = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
};

/** What a handle asks for: the menu of its row or its column. */
export type TableMenuRequest = {
  readonly kind: 'row' | 'column';
  /** A position in the cell of the handle, which the actions act on. */
  readonly pos: number;
  /** The handle, where the menu opens. */
  readonly anchor: ScreenRect;
  /** What the cell allows: a header row, one column, its alignment. */
  readonly context: FormatContext;
};

/** Opens the menu of one row or one column. The application renders it. */
export type TableMenuOpener = (request: TableMenuRequest) => void;

/** The opener of the menu of a table, which the application states. */
export const tableMenuOpener = Facet.define<
  TableMenuOpener,
  TableMenuOpener | null
>({ combine: (values) => values.at(-1) ?? null });

/** The plus of the icon set, on the one grid. */
const plus: readonly GlyphPart[] = [
  { kind: 'path', d: 'M12 5v14' },
  { kind: 'path', d: 'M5 12h14' },
];

/** Three dots in each of two lines: the grip of a handle. */
function grip(vertical: boolean): readonly GlyphPart[] {
  const across = [9, 15];
  const along = [6, 12, 18];
  return across.flatMap((a) =>
    along.map((b): GlyphPart => ({
      kind: 'circle',
      cx: vertical ? a : b,
      cy: vertical ? b : a,
      r: 1,
    })),
  );
}

/** One control element. */
function control(
  className: string,
  label: string,
  parts: readonly GlyphPart[],
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.tabIndex = -1;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(glyph('cm-np-table-control-mark', parts));
  return button;
}

/** The cell element that holds the caret, or null. */
function caretCell(view: EditorView): HTMLElement | null {
  const { node } = view.domAtPos(view.state.selection.main.head);
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return (
    element?.closest<HTMLElement>('.cm-np-table-cell, .cm-np-table-head') ??
    null
  );
}

/** A place in the coordinates of the scroller. */
type Place = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
};

/** Where every control stands. */
type ControlPlaces = {
  readonly addRow: Place;
  readonly addColumn: Place;
  readonly rowHandle: Place | null;
  readonly columnHandle: Place | null;
};

/** Builds the layer of the controls and keeps it on the active table. */
class TableControls {
  private readonly layer: HTMLElement;
  private readonly addRow: HTMLButtonElement;
  private readonly addColumn: HTMLButtonElement;
  private readonly rowHandle: HTMLButtonElement;
  private readonly columnHandle: HTMLButtonElement;
  /** The table and the cell under the pointer, which win over the caret. */
  private hovered: HTMLElement | null = null;
  private hoveredCell: HTMLElement | null = null;
  /** The table and the cell the controls stand on now. */
  private active: HTMLElement | null = null;
  private activeCell: HTMLElement | null = null;
  private readonly onPointer: (event: PointerEvent) => void;
  private readonly onLeave: () => void;
  private readonly onScroll: () => void;

  constructor(private readonly view: EditorView) {
    this.layer = document.createElement('div');
    this.layer.className = 'cm-np-table-controls';
    this.addRow = control(
      'cm-np-table-add cm-np-table-add-row',
      tableControlLabels.row,
      plus,
    );
    this.addColumn = control(
      'cm-np-table-add cm-np-table-add-column',
      tableControlLabels.column,
      plus,
    );
    this.rowHandle = control(
      'cm-np-table-handle cm-np-table-handle-row',
      tableControlLabels.rowMenu,
      grip(true),
    );
    this.columnHandle = control(
      'cm-np-table-handle cm-np-table-handle-column',
      tableControlLabels.columnMenu,
      grip(false),
    );
    const controls = [
      this.addRow,
      this.addColumn,
      this.rowHandle,
      this.columnHandle,
    ];
    this.layer.append(...controls);
    view.scrollDOM.append(this.layer);

    // A press keeps the focus and the selection in the editor, and the
    // click that follows runs the control.
    for (const button of controls)
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });
    this.addRow.addEventListener('click', () => {
      this.add('row');
    });
    this.addColumn.addEventListener('click', () => {
      this.add('column');
    });
    this.rowHandle.addEventListener('click', () => {
      this.openMenu('row', this.rowHandle);
    });
    this.columnHandle.addEventListener('click', () => {
      this.openMenu('column', this.columnHandle);
    });

    this.onPointer = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (this.layer.contains(target)) return;
      const table = target.closest<HTMLElement>('.cm-np-table');
      const cell =
        table === null
          ? null
          : target.closest<HTMLElement>('.cm-np-table-cell, .cm-np-table-head');
      // A pointer on the edge between two cells is over no cell, and the
      // handles stay on the cell it left.
      const nextCell = table === null ? null : (cell ?? this.hoveredCell);
      if (table === this.hovered && nextCell === this.hoveredCell) return;
      this.hovered = table;
      this.hoveredCell = nextCell;
      this.schedule();
    };
    this.onLeave = (): void => {
      this.hovered = null;
      this.hoveredCell = null;
      this.schedule();
    };
    // A table scrolls sideways on its own, and a scroll does not bubble, so
    // the layer hears it in the capture phase and follows it.
    this.onScroll = (): void => {
      this.schedule();
    };
    view.dom.addEventListener('pointermove', this.onPointer);
    view.dom.addEventListener('pointerleave', this.onLeave);
    view.scrollDOM.addEventListener('scroll', this.onScroll, true);
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.geometryChanged ||
      update.focusChanged
    )
      this.schedule();
  }

  destroy(): void {
    this.view.dom.removeEventListener('pointermove', this.onPointer);
    this.view.dom.removeEventListener('pointerleave', this.onLeave);
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll, true);
    this.layer.remove();
  }

  /** Adds a row or a column at the end of the active table. */
  private add(kind: 'row' | 'column'): void {
    const table = this.active;
    if (table === null || this.view.state.readOnly) return;
    const spec = tableEditSpec(
      this.view.state,
      kind === 'row' ? addRowAtEndEdit : addColumnAtEndEdit,
      this.view.posAtDOM(table, 0),
    );
    if (spec === null) return;
    this.view.dispatch(this.view.state.update(editingTransaction(spec)));
    this.view.focus();
  }

  /** Asks the application for the menu of the row or the column of a cell. */
  private openMenu(kind: 'row' | 'column', handle: HTMLElement): void {
    const cell = this.activeCell;
    const open = this.view.state.facet(tableMenuOpener);
    if (cell === null || open === null || this.view.state.readOnly) return;
    const pos = this.view.posAtDOM(cell, 0);
    const box = handle.getBoundingClientRect();
    open({
      kind,
      pos,
      anchor: {
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
      },
      context: tableContextAt(this.view.state, pos),
    });
  }

  /** Measures the active table and places the controls on it. */
  private schedule(): void {
    this.view.requestMeasure({
      key: this,
      read: (view): ControlPlaces | null => {
        this.active = null;
        this.activeCell = null;
        if (view.state.readOnly) return null;
        const pointed =
          this.hovered?.isConnected === true ? this.hovered : null;
        const caret = view.hasFocus ? caretCell(view) : null;
        const table =
          pointed ?? caret?.closest<HTMLElement>('.cm-np-table') ?? null;
        if (table === null) return null;
        const cell =
          this.hoveredCell?.isConnected === true &&
          table.contains(this.hoveredCell)
            ? this.hoveredCell
            : caret !== null && table.contains(caret)
              ? caret
              : null;
        this.active = table;
        this.activeCell = cell;

        const scroller = view.scrollDOM.getBoundingClientRect();
        const x = (left: number): number =>
          left - scroller.left + view.scrollDOM.scrollLeft;
        const y = (top: number): number =>
          top - scroller.top + view.scrollDOM.scrollTop;
        const box = table.getBoundingClientRect();
        // The rows form the table inside the wrapper: the first row is as
        // wide as the table, and the last row ends it. The wrapper clips a
        // wider table, so the controls stop at its edge.
        const lines = table.querySelectorAll('.cm-np-table-line');
        const first = lines.item(0)?.getBoundingClientRect() ?? box;
        const last =
          lines.item(lines.length - 1)?.getBoundingClientRect() ?? box;
        const right = Math.min(box.right, first.right);
        // The bar beside a table stays inside what the scroller shows. A
        // table as wide as a phone leaves no room beside it, so the bar then
        // stands over its edge, and the note never scrolls sideways for it.
        const room =
          scroller.left +
          view.scrollDOM.clientWidth -
          this.addColumn.offsetWidth;

        let rowHandle: Place | null = null;
        let columnHandle: Place | null = null;
        if (cell !== null) {
          const cellBox = cell.getBoundingClientRect();
          const rowBox =
            cell.closest('.cm-np-table-line')?.getBoundingClientRect() ??
            cellBox;
          // The handle of a row stands on the left edge of the table, half
          // outside it, because a phone leaves no more room beside a table;
          // it covers the padding of the first cell and none of its text.
          // The handle of a column stands wholly above the table, where the
          // margin of the table always leaves room, so it covers no cell.
          const handleWidth = this.rowHandle.offsetWidth;
          const handleHeight = this.columnHandle.offsetHeight;
          rowHandle = {
            top: y(rowBox.top),
            left: x(box.left) - handleWidth / 2,
            width: handleWidth,
            height: rowBox.height,
          };
          // Only the part of the column that the wrapper shows, so the handle
          // of a column scrolled out of view does not float beside the table.
          const from = Math.max(cellBox.left, box.left);
          const to = Math.min(cellBox.right, box.right);
          if (to > from)
            columnHandle = {
              top: y(first.top) - handleHeight,
              left: x(from),
              width: to - from,
              height: handleHeight,
            };
        }
        return {
          addRow: {
            top: y(last.bottom),
            left: x(box.left),
            width: right - box.left,
            height: this.addRow.offsetHeight,
          },
          addColumn: {
            top: y(box.top),
            left: x(Math.min(right, room)),
            width: this.addColumn.offsetWidth,
            height: last.bottom - box.top,
          },
          rowHandle,
          columnHandle,
        };
      },
      write: (places): void => {
        this.layer.classList.toggle(
          'cm-np-table-controls-shown',
          places !== null,
        );
        if (places === null) return;
        // A place on the screen is a measured number, which no class can
        // state, so the layer writes it, as a tooltip of CodeMirror does.
        const put = (
          element: HTMLElement,
          place: Place | null,
          sized: 'width' | 'height',
        ): void => {
          element.classList.toggle('cm-np-table-control-off', place === null);
          if (place === null) return;
          element.style.top = `${String(place.top)}px`;
          element.style.left = `${String(place.left)}px`;
          if (sized === 'width')
            element.style.width = `${String(place.width)}px`;
          else element.style.height = `${String(place.height)}px`;
        };
        put(this.addRow, places.addRow, 'width');
        put(this.addColumn, places.addColumn, 'height');
        put(this.rowHandle, places.rowHandle, 'height');
        put(this.columnHandle, places.columnHandle, 'width');
      },
    });
  }
}

/** The controls of every table (records 0096 and 0097). */
export function tableControls(): Extension {
  return ViewPlugin.fromClass(TableControls);
}
