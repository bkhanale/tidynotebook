/**
 * The bar of a code block: its language and a copy action (record 0174).
 *
 * A fence hides its fence lines while the caret is away from it, so the
 * language of the block is not on the screen. A bar stands at the top of the
 * card of each code block on the screen: the label of the language at the
 * start, as `codeBlockLabel` of `@notesapp/markdown` names it, and a copy
 * control at the end. The first line of the card keeps the room of the bar
 * (`editor-theme.ts`).
 *
 * The bar stands in one layer over the text, inside the scroller of the
 * editor, as the controls of a table do (`table-controls.ts`), so it replaces
 * no text, holds no caret, and the set of widget kinds of record 0002 stays
 * closed. A diagram is a widget of its own and carries no bar.
 *
 * The copy control is the ghost button of `packages/ui`, with the copy glyph
 * and its word. It takes the focus with Tab after the text and runs with
 * Enter or Space. A press keeps the caret where it is. A copy writes the code
 * of the block as the renderer reads it, says Copied for a moment, and tells
 * a screen reader that the code is on the clipboard.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
  codeBlockLabel,
  diagramFence,
  parseMarkdown,
  type Root,
} from '@notesapp/markdown';
import {
  buttonClassName,
  checkParts,
  compactButtonVisualClassName,
  copiedForMs,
  copyCodeWords,
  copyParts,
  glyph,
} from '@notesapp/ui';

/** One code block that carries a bar. */
export type CodeBlockBar = {
  /** The start of the block in the document. */
  readonly from: number;
  /** The end of the block in the document. */
  readonly to: number;
  /** The label of the block, or `null` for a block with no info string. */
  readonly label: string | null;
};

/**
 * The code blocks of a state between two offsets, in document order.
 *
 * A fenced block and an indented block each carry a bar. A Mermaid fence is a
 * diagram, which draws as a widget and carries none.
 */
export function codeBlockBars(
  state: EditorState,
  from = 0,
  to = state.doc.length,
): readonly CodeBlockBar[] {
  const found: CodeBlockBar[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === 'CodeBlock') {
        found.push({ from: node.from, to: node.to, label: null });
        return false;
      }
      if (node.name !== 'FencedCode') return true;
      const info = node.node.getChild('CodeInfo');
      const text =
        info === null ? '' : state.doc.sliceString(info.from, info.to);
      if (!diagramFence(text))
        found.push({
          from: node.from,
          to: node.to,
          label: codeBlockLabel(text),
        });
      return false;
    },
  });
  return found;
}

/**
 * The code of the block that holds `at`, as the renderer reads it, or `null`.
 *
 * The parse of `@notesapp/markdown` is the one reading of a block: it leaves
 * out the fences, the indentation of an indented block and the marks of a
 * quote or a list around it, so a copy of the note and a copy of the
 * published page hold the same code.
 */
export function codeBlockText(doc: string, at: number): string | null {
  let root: Root;
  try {
    root = parseMarkdown(doc);
  } catch {
    // A note over the limits of the grammar renders as its source, so its
    // blocks hold no code that a reader of the page could copy either.
    return null;
  }
  const shift = doc.startsWith('\uFEFF') ? 1 : 0;
  let found: string | null = null;
  const walk = (node: Root | Root['children'][number]): void => {
    const start = (node.position?.start.offset ?? -1) + shift;
    const end = (node.position?.end.offset ?? -1) + shift;
    if (start > at || end < at) return;
    if (node.type === 'code') found = node.value;
    if ('children' in node) for (const child of node.children) walk(child);
  };
  walk(root);
  return found;
}

/** The class of the glyph inside a control: the 16 px of a control. */
const glyphClass = 'size-4 shrink-0';

/** One bar on the screen, and the block it belongs to. */
type Bar = {
  readonly element: HTMLElement;
  readonly label: HTMLElement;
  readonly surface: HTMLElement;
  readonly word: HTMLElement;
  block: CodeBlockBar | null;
  timer: number;
};

/** A place of one bar, in the coordinates of the scroller. */
type Place = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
};

/** Builds the layer of the bars and keeps each bar on its block. */
class CodeControls {
  private readonly view: EditorView;
  private readonly layer: HTMLElement;
  private readonly bars: Bar[] = [];

  constructor(view: EditorView) {
    this.view = view;
    this.layer = document.createElement('div');
    this.layer.className = 'cm-np-code-controls';
    view.scrollDOM.append(this.layer);
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.geometryChanged || update.viewportChanged)
      this.schedule();
  }

  destroy(): void {
    for (const bar of this.bars) window.clearTimeout(bar.timer);
    this.layer.remove();
  }

  /** One bar, built once and kept for the next block that needs one. */
  private bar(index: number): Bar {
    const existing = this.bars[index];
    if (existing !== undefined) return existing;
    const element = document.createElement('div');
    element.className = 'cm-np-code-bar';
    const label = document.createElement('span');
    label.className = 'cm-np-code-label';
    const control = document.createElement('button');
    control.type = 'button';
    control.className = buttonClassName({
      variant: 'ghost',
      size: 'sm',
      compact: true,
    });
    control.setAttribute('aria-label', copyCodeWords.name);
    const surface = document.createElement('span');
    surface.className = compactButtonVisualClassName({
      variant: 'ghost',
      size: 'sm',
      iconOnly: false,
    });
    const word = document.createElement('span');
    word.textContent = copyCodeWords.action;
    surface.append(glyph(glyphClass, copyParts), word);
    control.append(surface);
    element.append(label, control);
    this.layer.append(element);
    const made: Bar = { element, label, surface, word, block: null, timer: 0 };
    // A press keeps the caret and the selection in the text.
    control.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    control.addEventListener('click', () => {
      this.copy(made);
    });
    this.bars.push(made);
    return made;
  }

  /** Writes the code of the block of one bar to the clipboard. */
  private copy(bar: Bar): void {
    const block = bar.block;
    if (block === null) return;
    const code = codeBlockText(this.view.state.doc.toString(), block.from);
    if (code === null) return;
    void navigator.clipboard.writeText(code).then(() => {
      bar.surface.replaceChildren(glyph(glyphClass, checkParts), bar.word);
      bar.word.textContent = copyCodeWords.done;
      this.view.dispatch({
        effects: EditorView.announce.of(copyCodeWords.announcement),
      });
      window.clearTimeout(bar.timer);
      bar.timer = window.setTimeout(() => {
        bar.surface.replaceChildren(glyph(glyphClass, copyParts), bar.word);
        bar.word.textContent = copyCodeWords.action;
      }, copiedForMs);
    });
  }

  /** Measures each code block on the screen and places its bar. */
  private schedule(): void {
    this.view.requestMeasure({
      key: this,
      read: (view): readonly { block: CodeBlockBar; place: Place }[] => {
        // A browser with no clipboard copies nothing, so it shows no bar.
        if (typeof navigator.clipboard?.writeText !== 'function') return [];
        const scroller = view.scrollDOM.getBoundingClientRect();
        const placed: { block: CodeBlockBar; place: Place }[] = [];
        for (const range of view.visibleRanges)
          for (const block of codeBlockBars(view.state, range.from, range.to)) {
            if (placed.some((done) => done.block.from === block.from)) continue;
            const { node } = view.domAtPos(block.from);
            const element = node instanceof Element ? node : node.parentElement;
            const line = element?.closest('.cm-line')?.getBoundingClientRect();
            if (line === undefined) continue;
            placed.push({
              block,
              place: {
                top: line.top - scroller.top + view.scrollDOM.scrollTop,
                left: line.left - scroller.left + view.scrollDOM.scrollLeft,
                width: line.width,
              },
            });
          }
        return placed;
      },
      write: (placed): void => {
        placed.forEach(({ block, place }, index) => {
          const bar = this.bar(index);
          bar.block = block;
          bar.label.textContent = block.label ?? '';
          bar.element.hidden = false;
          // A place on the screen is a measured number, which no class can
          // state, so the layer writes it, as a tooltip of CodeMirror does.
          bar.element.style.top = `${String(place.top)}px`;
          bar.element.style.left = `${String(place.left)}px`;
          bar.element.style.width = `${String(place.width)}px`;
        });
        for (const bar of this.bars.slice(placed.length)) {
          bar.block = null;
          bar.element.hidden = true;
        }
      },
    });
  }
}

/** The bar of every code block on the screen (record 0174). */
export function codeControls(): Extension {
  return ViewPlugin.fromClass(CodeControls);
}
