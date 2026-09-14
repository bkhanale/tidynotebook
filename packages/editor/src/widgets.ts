/**
 * The block level part of the live preview.
 *
 * Three things cannot be expressed with text decorations: an attachment
 * image, a Mermaid diagram, and a display math block. Each of them replaces
 * whole lines with a rendered widget. Everything else, tables included,
 * stays text so it can be edited in place.
 *
 * The rules these widgets follow:
 *
 * - Their ranges come from the Markdown syntax tree, never from a regular
 *   expression over the document.
 * - A widget covers whole lines and is a `Decoration.replace({ block: true })`,
 *   so CodeMirror can measure it.
 * - A widget disappears while the selection touches its range, so the source
 *   is always reachable and always editable.
 * - The remaining widgets are declared as atomic ranges, so an arrow key
 *   steps over a widget instead of walking into hidden text.
 * - A click inside a widget puts the cursor at the start of its source.
 * - `updateDOM` re-renders when the source or a resolver changed, so a same
 *   length edit never leaves a stale preview on screen.
 *
 * This module never fetches anything and never imports the API client or a
 * storage package. Attachment URLs, math rendering, and the diagram frame
 * arrive through the injected `RichWidgetResolvers`. It never loads an
 * external image by itself either: an external destination renders a compact
 * placeholder with a Load action that the reader must press.
 *
 * A decoration that replaces a line break, and every block decoration, has
 * to come from a state field rather than from a view plugin, which is why
 * the setext heading underline and the code fence lines are hidden here as
 * well.
 */
import { syntaxTree } from '@codemirror/language';
import {
  RangeSet,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';

/** The kinds of region that render as a widget. */
export type RichWidgetKind =
  'image' | 'image-external' | 'math-inline' | 'math-display' | 'diagram';

/** One region with its exact source range. */
export type RichWidget = {
  readonly from: number;
  readonly to: number;
  readonly kind: RichWidgetKind;
  /** The exact source text, so `doc.sliceString(from, to)` is this string. */
  readonly source: string;
  /** The image alt text or the math body, depending on the kind. */
  readonly content: string;
  /** The image destination, for the two image kinds. */
  readonly destination: string;
  /** True when the region covers whole lines and renders as a block. */
  readonly block: boolean;
};

/**
 * The fixed resource limits of widget rendering.
 *
 * A region larger than its cap stays editable source rather than rendering.
 * The math cap matches `mathLimits.maxSourceChars` in `@notesapp/markdown`,
 * so a widget never asks KaTeX for more than the renderer accepts.
 */
export const richLimits = {
  /** Largest accepted widget source, in characters. */
  maxSourceChars: 20000,
  /** Largest accepted math source inside a widget, in characters. */
  maxMathChars: 2000,
  /** Largest accepted diagram source, in characters. */
  maxDiagramChars: 20000,
  /** Largest accepted widget count per document; the rest stays source. */
  maxWidgets: 200,
} as const;

/**
 * Reports whether a region stays editable source instead of rendering.
 *
 * Rendering an oversized region would cost more than the preview is worth
 * and could freeze typing.
 */
export function shouldPreserveAsSource(widget: RichWidget): boolean {
  if (widget.source.length > richLimits.maxSourceChars) return true;
  if (
    (widget.kind === 'math-inline' || widget.kind === 'math-display') &&
    widget.content.length > richLimits.maxMathChars
  )
    return true;
  return (
    widget.kind === 'diagram' &&
    widget.content.length > richLimits.maxDiagramChars
  );
}

/** The attachment revision identifier of a destination, or null. */
export function attachmentIdOf(destination: string): string | null {
  const legacy = /^\/attachments\/([^/?#]+)$/.exec(destination)?.[1];
  if (legacy !== undefined) return legacy;
  if (
    destination === '' ||
    destination.startsWith('/') ||
    destination.startsWith('#') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination)
  )
    return null;
  return destination;
}

/** Callbacks the web composition injects into the widget extension. */
export type RichWidgetResolvers = {
  /**
   * Renders math to sanitized HTML, for example through a dynamic import of
   * `@notesapp/markdown`. May throw; a throw shows editable source.
   */
  readonly renderMath?:
    ((source: string, display: boolean) => string) | undefined;
  /**
   * Resolves an attachment destination to a local object URL, or null when
   * the bytes are not ready. Never fetches an external URL.
   */
  readonly resolveAttachment?:
    ((destination: string) => string | null) | undefined;
  /**
   * Creates the diagram element for one Mermaid source, for example an
   * isolated frame. May throw; a throw shows editable source.
   */
  readonly createDiagram?: ((source: string) => HTMLElement) | undefined;
  /** Called when a widget hands the cursor back to its source. */
  readonly onOpenSource?: ((widget: RichWidget) => void) | undefined;
};

/**
 * The external images the reader chose to load in this session.
 *
 * An external image is never fetched on its own. Once the reader presses
 * Load, the choice survives a rebuild of the widget so the picture does not
 * blink away on the next keystroke.
 */
const allowedExternalImages = new Set<string>();

/** The text of one whole-line range, used to place a block widget. */
function lineRange(
  state: EditorState,
  from: number,
  to: number,
): { readonly from: number; readonly to: number } {
  return { from: state.doc.lineAt(from).from, to: state.doc.lineAt(to).to };
}

/** Reads the destination and alt text of one Image node. */
function readImage(
  state: EditorState,
  node: { from: number; to: number },
  urlFrom: number,
  urlTo: number,
): { readonly alt: string; readonly destination: string } {
  const source = state.doc.sliceString(node.from, node.to);
  const alt = /^!\[([^\]]*)\]/.exec(source)?.[1] ?? '';
  return { alt, destination: state.doc.sliceString(urlFrom, urlTo) };
}

/**
 * Finds every region that renders as a widget, from the syntax tree.
 *
 * Regions come back in document order and never overlap. At most
 * `richLimits.maxWidgets` are reported; the rest of a very long document
 * stays editable source.
 */
export function findRichRegions(state: EditorState): readonly RichWidget[] {
  const doc = state.doc;
  const found: RichWidget[] = [];
  const slice = (from: number, to: number): string => doc.sliceString(from, to);
  syntaxTree(state).iterate({
    enter: (node) => {
      if (found.length >= richLimits.maxWidgets) return false;
      const name = node.name;
      if (name === 'FencedCode') {
        const info = node.node.getChild('CodeInfo');
        const language =
          info === null ? '' : slice(info.from, info.to).trim().toLowerCase();
        if (language !== 'mermaid') return false;
        const text = node.node.getChild('CodeText');
        const range = lineRange(state, node.from, node.to);
        found.push({
          ...range,
          kind: 'diagram',
          source: slice(range.from, range.to),
          content: text === null ? '' : slice(text.from, text.to),
          destination: '',
          block: true,
        });
        return false;
      }
      if (name === 'MathBlock') {
        const range = lineRange(state, node.from, node.to);
        const parts: string[] = [];
        for (const text of node.node.getChildren('MathText'))
          parts.push(slice(text.from, text.to));
        found.push({
          ...range,
          kind: 'math-display',
          source: slice(range.from, range.to),
          content: parts.join('\n'),
          destination: '',
          block: true,
        });
        return false;
      }
      if (name === 'InlineMath') {
        const text = node.node.getChild('MathText');
        found.push({
          from: node.from,
          to: node.to,
          kind: 'math-inline',
          source: slice(node.from, node.to),
          content: text === null ? '' : slice(text.from, text.to),
          destination: '',
          block: false,
        });
        return false;
      }
      if (name === 'Image') {
        const url = node.node.getChild('URL');
        if (url === null) return false;
        const { alt, destination } = readImage(state, node, url.from, url.to);
        const attachment = attachmentIdOf(destination);
        const line = doc.lineAt(node.from);
        const alone =
          line.text.trim() === slice(node.from, node.to).trim() &&
          doc.lineAt(node.to).number === line.number;
        found.push({
          from: alone ? line.from : node.from,
          to: alone ? line.to : node.to,
          kind: attachment === null ? 'image-external' : 'image',
          source: slice(node.from, node.to),
          content: alt,
          destination,
          block: attachment !== null && alone,
        });
        return false;
      }
      return true;
    },
  });
  return found;
}

/**
 * What one widget shows, decided without a DOM.
 *
 * Keeping the decision separate from the element makes every branch of the
 * widget testable in Node: the tests assert the view model, and the DOM
 * builder below is a direct translation of it.
 */
export type WidgetView =
  | {
      readonly kind: 'image';
      readonly url: string;
      readonly alt: string;
      readonly external: boolean;
    }
  | {
      readonly kind: 'image-placeholder';
      readonly label: string;
      readonly action: string;
      readonly actionLabel: string;
    }
  | { readonly kind: 'math'; readonly html: string; readonly display: boolean }
  | { readonly kind: 'element'; readonly element: HTMLElement }
  | {
      readonly kind: 'source';
      readonly message: string;
      readonly source: string;
    };

/**
 * Decides what one region shows.
 *
 * `isLoaded` reports whether the reader already pressed Load for an
 * external destination. Everything that can fail, an oversized region, a
 * missing attachment, a resolver that is still loading, and a resolver that
 * throws, ends in the `source` view, so the source is never lost.
 */
export function widgetView(
  widget: RichWidget,
  resolvers: RichWidgetResolvers,
  isLoaded: (destination: string) => boolean,
): WidgetView {
  const source = (message: string): WidgetView => ({
    kind: 'source',
    message,
    source: widget.source,
  });
  if (shouldPreserveAsSource(widget))
    return source('This block is large, so it stays source.');
  if (widget.kind === 'image') {
    const id = attachmentIdOf(widget.destination);
    const url =
      id === null
        ? null
        : (resolvers.resolveAttachment?.(widget.destination) ?? null);
    if (url === null) return source('The attachment is not ready yet.');
    return { kind: 'image', url, alt: widget.content, external: false };
  }
  if (widget.kind === 'image-external') {
    if (isLoaded(widget.destination))
      return {
        kind: 'image',
        url: widget.destination,
        alt: widget.content,
        external: true,
      };
    const alt = widget.content === '' ? 'image' : widget.content;
    return {
      kind: 'image-placeholder',
      label: `${alt} \u00b7 ${widget.destination}`,
      action: 'Load',
      actionLabel: `Load the external image ${alt}`,
    };
  }
  if (widget.kind === 'math-inline' || widget.kind === 'math-display') {
    const render = resolvers.renderMath;
    if (render === undefined) return source('Math is still loading.');
    const display = widget.kind === 'math-display';
    try {
      return { kind: 'math', html: render(widget.content, display), display };
    } catch {
      return source('This formula cannot be rendered.');
    }
  }
  const create = resolvers.createDiagram;
  if (create === undefined) return source('Diagrams are still loading.');
  try {
    return { kind: 'element', element: create(widget.content) };
  } catch {
    return source('This diagram cannot be rendered.');
  }
}

/** The accessible label of one widget kind. */
function widgetLabel(kind: RichWidgetKind): string {
  if (kind === 'image') return 'Image';
  if (kind === 'image-external') return 'External image';
  if (kind === 'math-inline') return 'Inline formula';
  if (kind === 'math-display') return 'Formula';
  return 'Diagram';
}

/** Renders one region as DOM. */
class RichWidgetType extends WidgetType {
  readonly widget: RichWidget;
  readonly resolvers: RichWidgetResolvers;

  constructor(widget: RichWidget, resolvers: RichWidgetResolvers) {
    super();
    this.widget = widget;
    this.resolvers = resolvers;
  }

  override eq(other: RichWidgetType): boolean {
    return (
      other.widget.kind === this.widget.kind &&
      other.widget.source === this.widget.source &&
      other.widget.content === this.widget.content &&
      other.widget.destination === this.widget.destination &&
      other.resolvers === this.resolvers
    );
  }

  override get estimatedHeight(): number {
    if (this.widget.kind === 'diagram') return 240;
    if (this.widget.kind === 'math-display') return 60;
    return -1;
  }

  override ignoreEvent(): boolean {
    return false;
  }

  /**
   * Re-renders in place when the source or a resolver changed.
   *
   * CodeMirror calls this only when `eq` reported a difference, which is
   * exactly the case where the previous DOM is stale. Returning true keeps
   * the same element and its position in the layout.
   */
  override updateDOM(dom: HTMLElement): boolean {
    dom.textContent = '';
    this.fill(dom);
    return true;
  }

  /** Releases a removed widget promptly, which stops a frame from loading. */
  override destroy(dom: HTMLElement): void {
    dom.textContent = '';
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement(
      this.widget.block ? 'div' : 'span',
    );
    container.className = this.widget.block
      ? 'cm-np-widget cm-np-widget-block'
      : 'cm-np-widget cm-np-widget-inline';
    container.setAttribute('data-notesapp-rich', this.widget.kind);
    container.setAttribute('aria-label', widgetLabel(this.widget.kind));
    container.addEventListener('mousedown', (event: Event): void => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('button') !== null)
        return;
      event.preventDefault();
      this.openSource(view);
    });
    this.fill(container);
    return container;
  }

  /** Puts the cursor at the start of the source this widget replaced. */
  private openSource(view: EditorView): void {
    view.dispatch({ selection: { anchor: this.widget.from } });
    view.focus();
    this.resolvers.onOpenSource?.(this.widget);
  }

  /** Renders one view model into `parent`. */
  private fill(parent: HTMLElement): void {
    const view = widgetView(this.widget, this.resolvers, (destination) =>
      allowedExternalImages.has(destination),
    );
    if (view.kind === 'source') {
      const note = document.createElement('span');
      note.className = 'cm-np-widget-note';
      note.textContent = view.message;
      parent.appendChild(note);
      const code = document.createElement('span');
      code.className = 'cm-np-widget-source';
      code.textContent = view.source;
      parent.appendChild(code);
      return;
    }
    if (view.kind === 'image') {
      const image = document.createElement('img');
      image.className = 'cm-np-widget-image';
      image.src = view.url;
      image.alt = view.alt;
      if (view.external)
        image.addEventListener('error', (): void => {
          parent.textContent = '';
          const failed = document.createElement('span');
          failed.className = 'cm-np-widget-note cm-np-widget-error';
          failed.textContent = `This image did not load: ${view.url}`;
          parent.appendChild(failed);
        });
      parent.appendChild(image);
      return;
    }
    if (view.kind === 'image-placeholder') {
      const label = document.createElement('span');
      label.className = 'cm-np-widget-note';
      label.textContent = view.label;
      parent.appendChild(label);
      const load = document.createElement('button');
      load.type = 'button';
      load.className = 'cm-np-widget-action';
      load.textContent = view.action;
      load.setAttribute('aria-label', view.actionLabel);
      load.addEventListener('mousedown', (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
      });
      load.addEventListener('click', (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
        allowedExternalImages.add(this.widget.destination);
        parent.textContent = '';
        this.fill(parent);
      });
      parent.appendChild(load);
      return;
    }
    if (view.kind === 'math') {
      const holder = document.createElement('span');
      holder.className = view.display
        ? 'cm-np-math cm-np-math-display'
        : 'cm-np-math cm-np-math-inline';
      // The resolver returns sanitized markup: `renderMath` in
      // `@notesapp/markdown` strips every element and every attribute that
      // is not part of the KaTeX drawing set before it returns.
      holder.innerHTML = view.html;
      parent.appendChild(holder);
      return;
    }
    parent.appendChild(view.element);
  }
}

/** The decorations and the atomic ranges of one state. */
export type RichWidgetSet = {
  readonly decorations: DecorationSet;
  readonly atomic: RangeSet<Decoration>;
};

/**
 * Builds the block decorations of one state.
 *
 * A region whose range the selection touches is left out, so its source
 * shows and stays editable. The setext heading underline is hidden here as
 * well, because that decoration replaces a line break.
 */
export function buildRichWidgets(
  state: EditorState,
  resolvers: RichWidgetResolvers,
): RichWidgetSet {
  const selection = state.selection.main;
  const touches = (from: number, to: number): boolean =>
    selection.from <= to && selection.to >= from;
  const items: Range<Decoration>[] = [];
  const atomicItems: Range<Decoration>[] = [];
  for (const widget of findRichRegions(state)) {
    if (widget.to <= widget.from) continue;
    if (touches(widget.from, widget.to)) continue;
    const decoration = Decoration.replace({
      widget: new RichWidgetType(widget, resolvers),
      block: widget.block,
    });
    items.push(decoration.range(widget.from, widget.to));
    atomicItems.push(decoration.range(widget.from, widget.to));
  }
  for (const underline of findSetextUnderlines(state)) {
    if (touches(underline.headingFrom, underline.headingTo)) continue;
    const hide = Decoration.replace({});
    items.push(hide.range(underline.from, underline.to));
    atomicItems.push(hide.range(underline.from, underline.to));
  }
  for (const fence of findCodeFences(state)) {
    if (touches(fence.blockFrom, fence.blockTo)) continue;
    for (const line of fence.hides) {
      if (line.to <= line.from) continue;
      const hide = Decoration.replace({});
      items.push(hide.range(line.from, line.to));
      atomicItems.push(hide.range(line.from, line.to));
    }
  }
  return {
    decorations: Decoration.set(items, true),
    atomic: RangeSet.of(atomicItems, true),
  };
}

/**
 * The ranges that hold a setext heading underline and the line break above.
 *
 * Hiding both joins the underline into the heading line, so the heading
 * shows its text only. The selection range that reveals it covers the whole
 * heading, so a cursor on either line brings the underline back.
 */
function findSetextUnderlines(state: EditorState): readonly {
  from: number;
  to: number;
  headingFrom: number;
  headingTo: number;
}[] {
  const found: {
    from: number;
    to: number;
    headingFrom: number;
    headingTo: number;
  }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'SetextHeading1' && node.name !== 'SetextHeading2')
        return true;
      const mark = node.node.getChild('HeaderMark');
      if (mark === null) return false;
      const line = state.doc.lineAt(mark.from);
      if (line.from === 0) return false;
      found.push({
        from: line.from - 1,
        to: line.to,
        headingFrom: node.from,
        headingTo: node.to,
      });
      return false;
    },
  });
  return found;
}

/**
 * The fence lines of a fenced code block, with the block range that reveals
 * them.
 *
 * A fenced code block hides its opening and its closing fence line, so the
 * reader sees the highlighted code alone and not the ` ``` ` lines (decision
 * 0002). Each hidden range covers one fence line and the one line break that
 * joins it to the code, so the line collapses. The block shows its fences
 * again while the selection touches it, so the source stays editable. A
 * mermaid fence is a diagram widget, so it is left out here.
 */
function findCodeFences(state: EditorState): readonly {
  hides: readonly { from: number; to: number }[];
  blockFrom: number;
  blockTo: number;
}[] {
  const doc = state.doc;
  const found: {
    hides: { from: number; to: number }[];
    blockFrom: number;
    blockTo: number;
  }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return true;
      const fence = node.node;
      const info = fence.getChild('CodeInfo');
      const language =
        info === null
          ? ''
          : doc.sliceString(info.from, info.to).trim().toLowerCase();
      if (language === 'mermaid') return false;
      const marks = fence.getChildren('CodeMark');
      const open = marks[0] ?? null;
      if (open === null) return false;
      const openLine = doc.lineAt(open.from);
      const close = marks.length > 1 ? (marks[marks.length - 1] ?? null) : null;
      const closeLine = close === null ? null : doc.lineAt(close.from);
      const hides: { from: number; to: number }[] = [];
      if (closeLine === null || closeLine.number > openLine.number + 1) {
        // The opening line and the line break after it, so the first code
        // line moves up into its place.
        hides.push({
          from: openLine.from,
          to: Math.min(doc.length, openLine.to + 1),
        });
        if (closeLine !== null)
          // The closing line and the line break before it.
          hides.push({ from: closeLine.from - 1, to: closeLine.to });
      } else if (closeLine.number === openLine.number + 1) {
        // An empty block holds no code between its fences, so one range hides
        // both lines and cannot overlap.
        hides.push({ from: openLine.from, to: closeLine.to });
      }
      // A single line fence keeps its open and close on one line, so it is
      // left as source rather than hiding the code with the fences.
      if (hides.length > 0)
        found.push({ hides, blockFrom: node.from, blockTo: node.to });
      return false;
    },
  });
  return found;
}

/**
 * The widget extension.
 *
 * Block replacements come from a state field, because CodeMirror refuses
 * block decorations from a view plugin. The set is rebuilt when the
 * document changes, when the selection moves, and when the parser has
 * produced more tree, which is what a long note does while it loads.
 */
export function richWidgets(resolvers: RichWidgetResolvers = {}): Extension {
  const field = StateField.define<RichWidgetSet>({
    create: (state) => buildRichWidgets(state, resolvers),
    update: (current, transaction) => {
      const treeChanged =
        syntaxTree(transaction.startState) !== syntaxTree(transaction.state);
      if (
        !transaction.docChanged &&
        transaction.selection === undefined &&
        !treeChanged
      )
        return current;
      return buildRichWidgets(transaction.state, resolvers);
    },
    provide: (self) => [
      EditorView.decorations.from(self, (value) => value.decorations),
      EditorView.atomicRanges.of(
        (view) => view.state.field(self, false)?.atomic ?? RangeSet.empty,
      ),
    ],
  });
  return [field];
}
