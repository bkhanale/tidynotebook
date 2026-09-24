/**
 * The handles that a table carries (records 0097 and 0098).
 *
 * A handle stands at the start of the active row and above the active column:
 * the row and the column of the cell under the pointer, or of the caret. A
 * press on a handle opens the menu of its row or its column. A drag of a
 * handle moves its row or its column, and a line shows where it lands.
 *
 * The handles stand in one layer over the text, inside the scroller of the
 * editor, so they replace no text and the set of widget kinds of record 0002
 * stays closed. The layer is the way CodeMirror draws its own selection and
 * its tooltips: an element beside the content, placed from what the view
 * measures. A table keeps room for the handles beside its rows and above its
 * columns (`editor-theme.ts`), so a handle never covers a cell and a phone
 * shows the whole of it. A move is an edit of `table-grid.ts`. The menu is a
 * control of `packages/ui`, which the editor does not render, so a handle asks
 * the application for it through `tableMenuOpener`.
 *
 * A handle takes no focus from the editor. The keyboard reaches every action
 * of the menu, moves included, from the command palette.
 */
import { Facet, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { editingTransaction } from './commands.ts';
import { glyph, type GlyphPart } from './icon-mark.ts';
import {
  moveColumnEdit,
  moveRowEdit,
  tableContextAt,
  tableEditSpec,
  type FormatContext,
} from './table-grid.ts';

/** The names of the handles, which a person hears and reads. */
export const tableControlLabels = {
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

/** How far a pointer travels before a press on a handle becomes a drag. */
const dragDistance = 4;

/** The width of the line that shows where a row or a column lands. */
const dropLineWidth = 2;

/** Three dots in each of two lines: the grip of a handle. */
function grip(vertical: boolean): readonly GlyphPart[] {
  return [9, 15].flatMap((across) =>
    [6, 12, 18].map((along): GlyphPart => ({
      kind: 'circle',
      cx: vertical ? across : along,
      cy: vertical ? along : across,
      r: 1,
    })),
  );
}

/** One handle element. */
function handle(kind: 'row' | 'column'): HTMLButtonElement {
  const button = document.createElement('button');
  const label =
    kind === 'row' ? tableControlLabels.rowMenu : tableControlLabels.columnMenu;
  button.type = 'button';
  button.className = `cm-np-table-handle cm-np-table-handle-${kind}`;
  button.tabIndex = -1;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(glyph('cm-np-table-control-mark', grip(kind === 'row')));
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

/** The rows of a table element that a person sees: every line but the delimiter. */
function gridLines(table: HTMLElement): readonly HTMLElement[] {
  return [
    ...table.querySelectorAll<HTMLElement>(
      '.cm-np-table-line:not(.cm-np-table-closed)',
    ),
  ];
}

/** The cells of one row element. */
function rowCells(line: Element): readonly HTMLElement[] {
  return [
    ...line.querySelectorAll<HTMLElement>(
      '.cm-np-table-cell, .cm-np-table-head',
    ),
  ];
}

/** A place in the coordinates of the scroller. */
type Place = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
};

/** Where the handles and the drop line stand. */
type ControlPlaces = {
  readonly rowHandle: Place | null;
  readonly columnHandle: Place | null;
  readonly dropLine: Place | null;
};

/** A press on a handle, which becomes a drag once the pointer travels. */
type Drag = {
  readonly kind: 'row' | 'column';
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  /** A position in the cell of the handle, which names what moves. */
  readonly pos: number;
  /** The row or the column that moves, as the grid counts them. */
  readonly from: number;
  readonly table: HTMLElement;
  /** True once the pointer travelled far enough to be a drag. */
  moving: boolean;
  /** Where the row or the column lands, as the grid counts them. */
  to: number;
};

/** Builds the layer of the handles and keeps it on the active table. */
class TableControls {
  private readonly layer: HTMLElement;
  private readonly rowHandle: HTMLButtonElement;
  private readonly columnHandle: HTMLButtonElement;
  private readonly dropLine: HTMLElement;
  /** The table and the cell under the pointer, which win over the caret. */
  private hovered: HTMLElement | null = null;
  private hoveredCell: HTMLElement | null = null;
  /** The cell the handles stand on now. */
  private activeCell: HTMLElement | null = null;
  private drag: Drag | null = null;
  private readonly onPointer: (event: PointerEvent) => void;
  private readonly onLeave: () => void;
  private readonly onScroll: () => void;

  constructor(private readonly view: EditorView) {
    this.layer = document.createElement('div');
    this.layer.className = 'cm-np-table-controls';
    this.rowHandle = handle('row');
    this.columnHandle = handle('column');
    this.dropLine = document.createElement('div');
    this.dropLine.className = 'cm-np-table-drop';
    this.layer.append(this.rowHandle, this.columnHandle, this.dropLine);
    view.scrollDOM.append(this.layer);

    for (const [button, kind] of [
      [this.rowHandle, 'row'],
      [this.columnHandle, 'column'],
    ] as const) {
      // A press keeps the focus and the selection in the editor.
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });
      button.addEventListener('pointerdown', (event) => {
        this.startDrag(kind, event, button);
      });
      button.addEventListener('pointermove', (event) => {
        this.moveDrag(event);
      });
      button.addEventListener('pointerup', (event) => {
        this.endDrag(event, button);
      });
      button.addEventListener('pointercancel', () => {
        this.drag = null;
        this.schedule();
      });
      // Assistive software and a keyboard press a button with a click that
      // no pointer made, which carries no count of presses. It opens the menu,
      // as a press of the pointer that does not drag does.
      button.addEventListener('click', (event) => {
        const cell = this.activeCell;
        if (event.detail !== 0 || cell === null) return;
        this.openMenu(kind, this.view.posAtDOM(cell, 0), button);
      });
    }

    this.onPointer = (event: PointerEvent): void => {
      if (this.drag !== null) return;
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
      if (this.drag !== null) return;
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

  /** A press on a handle: it becomes a drag or, if it stays, the menu. */
  private startDrag(
    kind: 'row' | 'column',
    event: PointerEvent,
    button: HTMLElement,
  ): void {
    const cell = this.activeCell;
    const table = cell?.closest<HTMLElement>('.cm-np-table') ?? null;
    if (cell === null || table === null || this.view.state.readOnly) return;
    event.preventDefault();
    const pos = this.view.posAtDOM(cell, 0);
    const context = tableContextAt(this.view.state, pos);
    const from = kind === 'row' ? context.row : context.column;
    // The pointer stays with the handle while it drags, wherever it goes.
    button.setPointerCapture(event.pointerId);
    this.drag = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pos,
      from,
      table,
      moving: false,
      to: from,
    };
  }

  /** Follows the pointer and finds where the row or the column lands. */
  private moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const travelled = Math.hypot(
      event.clientX - drag.startX,
      event.clientY - drag.startY,
    );
    if (!drag.moving && travelled < dragDistance) return;
    // The header row stays first, so it does not move.
    if (drag.kind === 'row' && drag.from === 0) return;
    drag.moving = true;
    drag.to = dropIndex(drag, event.clientX, event.clientY);
    this.schedule();
  }

  /** Ends a press: a drag moves its row or its column, a press opens the menu. */
  private endDrag(event: PointerEvent, button: HTMLElement): void {
    const drag = this.drag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    if (!drag.moving) {
      this.openMenu(drag.kind, drag.pos, button);
      this.schedule();
      return;
    }
    if (drag.to !== drag.from) {
      const spec = tableEditSpec(
        this.view.state,
        drag.kind === 'row' ? moveRowEdit(drag.to) : moveColumnEdit(drag.to),
        drag.pos,
      );
      if (spec !== null)
        this.view.dispatch(this.view.state.update(editingTransaction(spec)));
    }
    this.view.focus();
    this.schedule();
  }

  /** Asks the application for the menu of the row or the column of a cell. */
  private openMenu(
    kind: 'row' | 'column',
    pos: number,
    button: HTMLElement,
  ): void {
    const open = this.view.state.facet(tableMenuOpener);
    if (open === null || this.view.state.readOnly) return;
    const box = button.getBoundingClientRect();
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

  /** Measures the active table and places the handles on it. */
  private schedule(): void {
    this.view.requestMeasure({
      key: this,
      read: (view): ControlPlaces | null => {
        if (view.state.readOnly) return null;
        const scroller = view.scrollDOM.getBoundingClientRect();
        const x = (left: number): number =>
          left - scroller.left + view.scrollDOM.scrollLeft;
        const y = (top: number): number =>
          top - scroller.top + view.scrollDOM.scrollTop;
        const drag = this.drag;
        if (drag !== null) return this.dragPlaces(drag, x, y);

        this.activeCell = null;
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
        this.activeCell = cell;
        if (cell === null) return null;

        const box = table.getBoundingClientRect();
        const first = gridLines(table)[0]?.getBoundingClientRect() ?? box;
        const cellBox = cell.getBoundingClientRect();
        const rowBox =
          cell.closest('.cm-np-table-line')?.getBoundingClientRect() ?? cellBox;
        // A handle stands wholly outside the table, in the room the table
        // keeps beside its rows and above its columns, so it covers no cell.
        const handleWidth = this.rowHandle.offsetWidth;
        const handleHeight = this.columnHandle.offsetHeight;
        // Only the part of a column that the table shows takes a handle, so
        // the handle of a column scrolled out of view does not float beside
        // the table.
        const from = Math.max(cellBox.left, box.left);
        const to = Math.min(cellBox.right, box.right);
        return {
          rowHandle: {
            top: y(rowBox.top),
            left: x(box.left) - handleWidth,
            width: handleWidth,
            height: rowBox.height,
          },
          columnHandle:
            to > from
              ? {
                  top: y(first.top) - handleHeight,
                  left: x(from),
                  width: to - from,
                  height: handleHeight,
                }
              : null,
          dropLine: null,
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
        const put = (element: HTMLElement, place: Place | null): void => {
          element.classList.toggle('cm-np-table-control-off', place === null);
          if (place === null) return;
          element.style.top = `${String(place.top)}px`;
          element.style.left = `${String(place.left)}px`;
          element.style.width = `${String(place.width)}px`;
          element.style.height = `${String(place.height)}px`;
        };
        put(this.rowHandle, places.rowHandle);
        put(this.columnHandle, places.columnHandle);
        put(this.dropLine, places.dropLine);
      },
    });
  }

  /**
   * Where the handle and the drop line stand during a drag.
   *
   * The handle of the moving row or column stays where it was, and a line on
   * the edge of the place where it lands shows where it goes.
   */
  private dragPlaces(
    drag: Drag,
    x: (left: number) => number,
    y: (top: number) => number,
  ): ControlPlaces | null {
    if (!drag.table.isConnected) return null;
    const box = drag.table.getBoundingClientRect();
    const lines = gridLines(drag.table);
    const first = lines[0]?.getBoundingClientRect() ?? box;
    const moved = drag.moving && drag.to !== drag.from;
    if (drag.kind === 'row') {
      const source = lines[drag.from]?.getBoundingClientRect() ?? first;
      const target = lines[drag.to]?.getBoundingClientRect() ?? source;
      const edge = drag.to > drag.from ? target.bottom : target.top;
      return {
        rowHandle: {
          top: y(source.top),
          left: x(box.left) - this.rowHandle.offsetWidth,
          width: this.rowHandle.offsetWidth,
          height: source.height,
        },
        columnHandle: null,
        dropLine: moved
          ? {
              top: y(edge) - dropLineWidth / 2,
              left: x(box.left),
              width: Math.min(box.right, first.right) - box.left,
              height: dropLineWidth,
            }
          : null,
      };
    }
    const cells = lines[0] === undefined ? [] : rowCells(lines[0]);
    const source = cells[drag.from]?.getBoundingClientRect() ?? first;
    const target = cells[drag.to]?.getBoundingClientRect() ?? source;
    const edge = drag.to > drag.from ? target.right : target.left;
    const last = lines[lines.length - 1]?.getBoundingClientRect() ?? first;
    return {
      rowHandle: null,
      columnHandle: {
        top: y(first.top) - this.columnHandle.offsetHeight,
        left: x(source.left),
        width: source.width,
        height: this.columnHandle.offsetHeight,
      },
      dropLine: moved
        ? {
            top: y(first.top),
            left: x(edge) - dropLineWidth / 2,
            width: dropLineWidth,
            height: last.bottom - first.top,
          }
        : null,
    };
  }
}

/**
 * The row or the column under the pointer, as the grid counts them.
 *
 * A row lands on the body row whose top the pointer passed, and never on the
 * header row, which stays first. A column lands on the column whose left edge
 * the pointer passed.
 */
function dropIndex(drag: Drag, pointerX: number, pointerY: number): number {
  const lines = gridLines(drag.table);
  if (drag.kind === 'row') {
    let to = 1;
    lines.forEach((line, index) => {
      if (index > 0 && pointerY >= line.getBoundingClientRect().top) to = index;
    });
    return Math.min(Math.max(to, 1), lines.length - 1);
  }
  const cells = lines[0] === undefined ? [] : rowCells(lines[0]);
  let to = 0;
  cells.forEach((cell, index) => {
    if (pointerX >= cell.getBoundingClientRect().left) to = index;
  });
  return to;
}

/** The handles of every table (records 0097 and 0098). */
export function tableControls(): Extension {
  return ViewPlugin.fromClass(TableControls);
}
