/**
 * The controls that a table carries: a bar under it that adds a row, and a
 * bar at its right edge that adds a column (record 0096).
 *
 * The controls stand in one layer over the text, inside the scroller of the
 * editor, so they replace no text and the set of widget kinds of record 0002
 * stays closed. The layer is the way CodeMirror draws its own selection and
 * its tooltips: an element beside the content, placed from what the view
 * measures. A control runs a table command of `table-grid.ts`, so it changes
 * the table through the model like every other table action.
 *
 * The controls show for one table at a time: the table under the pointer, or
 * the table that holds the caret, which is how a phone reaches them after a
 * tap in a cell. A control takes no focus from the editor, because a press on
 * it is a pointer action and the keyboard adds a row with Tab and Enter and a
 * column from the command palette.
 */
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { editingTransaction } from './commands.ts';
import { glyph } from './icon-mark.ts';
import {
  addColumnAtEndEdit,
  addRowAtEndEdit,
  tableEditSpec,
} from './table-grid.ts';

/** The names of the two controls, which a person hears and reads. */
export const tableControlLabels = {
  row: 'Add a row',
  column: 'Add a column',
} as const;

/** The plus of the icon set, on the one grid. */
const plus = [{ path: 'M12 5v14' }, { path: 'M5 12h14' }] as const;

/** Where the two controls stand, in the coordinates of the scroller. */
type ControlPlace = {
  readonly row: {
    readonly top: number;
    readonly left: number;
    readonly width: number;
  };
  readonly column: {
    readonly top: number;
    readonly left: number;
    readonly height: number;
  };
};

/** One control element. */
function control(kind: 'row' | 'column'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `cm-np-table-add cm-np-table-add-${kind}`;
  button.tabIndex = -1;
  button.setAttribute('aria-label', tableControlLabels[kind]);
  button.title = tableControlLabels[kind];
  button.append(glyph('cm-np-table-add-mark', plus));
  return button;
}

/** The table element that holds the caret, or null. */
function caretTable(view: EditorView): HTMLElement | null {
  const { node } = view.domAtPos(view.state.selection.main.head);
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return element?.closest<HTMLElement>('.cm-np-table') ?? null;
}

/** Builds the layer of the controls and keeps it on the active table. */
class TableControls {
  private readonly layer: HTMLElement;
  private readonly addRow: HTMLButtonElement;
  private readonly addColumn: HTMLButtonElement;
  /** The table under the pointer, which wins over the table of the caret. */
  private hovered: HTMLElement | null = null;
  /** The table the controls stand on now. */
  private active: HTMLElement | null = null;
  private readonly onPointer: (event: PointerEvent) => void;
  private readonly onLeave: () => void;
  private readonly onScroll: () => void;

  constructor(private readonly view: EditorView) {
    this.layer = document.createElement('div');
    this.layer.className = 'cm-np-table-controls';
    this.addRow = control('row');
    this.addColumn = control('column');
    this.layer.append(this.addRow, this.addColumn);
    view.scrollDOM.append(this.layer);

    // A press keeps the focus and the selection in the editor, and the
    // click that follows runs the command.
    for (const button of [this.addRow, this.addColumn])
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });
    this.addRow.addEventListener('click', () => {
      this.run('row');
    });
    this.addColumn.addEventListener('click', () => {
      this.run('column');
    });

    this.onPointer = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (this.layer.contains(target)) return;
      const table = target.closest<HTMLElement>('.cm-np-table');
      if (table === this.hovered) return;
      this.hovered = table;
      this.schedule();
    };
    this.onLeave = (): void => {
      this.hovered = null;
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

  /** Runs one control on the table it stands on. */
  private run(kind: 'row' | 'column'): void {
    const table = this.active;
    if (table === null || this.view.state.readOnly) return;
    const pos = this.view.posAtDOM(table, 0);
    const spec = tableEditSpec(
      this.view.state,
      kind === 'row' ? addRowAtEndEdit : addColumnAtEndEdit,
      pos,
    );
    if (spec === null) return;
    this.view.dispatch(this.view.state.update(editingTransaction(spec)));
    this.view.focus();
  }

  /** Measures the active table and places the controls on it. */
  private schedule(): void {
    this.view.requestMeasure({
      key: this,
      read: (view): ControlPlace | null => {
        if (view.state.readOnly) {
          this.active = null;
          return null;
        }
        const table =
          this.hovered?.isConnected === true
            ? this.hovered
            : view.hasFocus
              ? caretTable(view)
              : null;
        this.active = table;
        if (table === null) return null;
        const scroller = view.scrollDOM.getBoundingClientRect();
        const box = table.getBoundingClientRect();
        // The rows form the table inside the wrapper: the first row is as
        // wide as the table, and the last row ends it. The wrapper clips a
        // wider table, so the controls stop at its edge.
        const lines = table.querySelectorAll('.cm-np-table-line');
        const first = lines.item(0)?.getBoundingClientRect() ?? box;
        const last =
          lines.item(lines.length - 1)?.getBoundingClientRect() ?? box;
        const right = Math.min(box.right, first.right);
        const left = box.left - scroller.left + view.scrollDOM.scrollLeft;
        const top = box.top - scroller.top + view.scrollDOM.scrollTop;
        const bottom = last.bottom - scroller.top + view.scrollDOM.scrollTop;
        // The bar beside a table stays inside what the scroller shows. A
        // table as wide as a phone leaves no room beside it, so the bar then
        // stands over its edge, and the note never scrolls sideways for it.
        const room =
          scroller.left +
          view.scrollDOM.clientWidth -
          this.addColumn.offsetWidth;
        return {
          row: { top: bottom, left, width: right - box.left },
          column: {
            top,
            left:
              Math.min(right, room) - scroller.left + view.scrollDOM.scrollLeft,
            height: bottom - top,
          },
        };
      },
      write: (place): void => {
        this.layer.classList.toggle(
          'cm-np-table-controls-shown',
          place !== null,
        );
        if (place === null) return;
        // A place on the screen is a measured number, which no class can
        // state, so the layer writes it, as a tooltip of CodeMirror does.
        this.addRow.style.top = `${String(place.row.top)}px`;
        this.addRow.style.left = `${String(place.row.left)}px`;
        this.addRow.style.width = `${String(place.row.width)}px`;
        this.addColumn.style.top = `${String(place.column.top)}px`;
        this.addColumn.style.left = `${String(place.column.left)}px`;
        this.addColumn.style.height = `${String(place.column.height)}px`;
      },
    });
  }
}

/** The controls of every table: add a row and add a column (record 0096). */
export function tableControls(): Extension {
  return ViewPlugin.fromClass(TableControls);
}
