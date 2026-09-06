/**
 * Accessible inline widgets for rich Markdown regions.
 *
 * The editor document always stays Markdown source. This module finds the
 * regions that deserve a rendered preview (images, tables, math, and Mermaid
 * fences) and offers a CodeMirror extension that shows each preview in place
 * while keeping its source addressable. Focusing, clicking, or pressing Enter
 * on a widget moves the selection to its source range, so the region stays
 * editable in the same pane.
 *
 * What this module never does:
 *
 * - It never fetches anything and never imports the API client or a storage
 *   package. Attachment URLs, math HTML, and diagram frames arrive through the
 *   injected `RichWidgetResolvers`, which the web composition wires to the
 *   generated operations and to lazily loaded rich modules.
 * - It never auto loads an external image. An external destination renders as
 *   a placeholder with an explicit load action that the caller owns.
 * - It never hides a failure. An unknown, oversized, or failed region renders
 *   as editable source with an inline message, and the rest of the file is
 *   unaffected.
 *
 * KaTeX and Mermaid stay out of this package on purpose: the web layer passes
 * `renderMath` and `createDiagram` in after a dynamic import, so the initial
 * bundle keeps them deferred and the service worker precaches them later.
 */
import type { Extension } from '@codemirror/state';
import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';

/** The kinds of rich regions the editor previews. */
export type RichWidgetKind =
  'image' | 'table' | 'math-inline' | 'math-display' | 'diagram';

/** One rich region with its exact source range. */
export type RichWidget = {
  readonly from: number;
  readonly to: number;
  readonly kind: RichWidgetKind;
  /** The exact source text, so `source.slice(from, to)` is this string. */
  readonly source: string;
};

/**
 * The fixed resource limits of widget scanning.
 *
 * A region larger than its cap is preserved as editable source rather than
 * rendered. The math cap matches `mathLimits.maxSourceChars` in
 * `@notesapp/markdown`, so a widget never asks KaTeX for more than the
 * renderer accepts.
 */
export const richLimits = {
  /** Largest accepted widget source, in characters. */
  maxSourceChars: 20000,
  /** Largest accepted math source inside a widget, in characters. */
  maxMathChars: 2000,
  /** Largest accepted diagram source, in characters. */
  maxDiagramChars: 20000,
  /** Largest accepted table, in rows including the header. */
  maxTableRows: 200,
  /** Largest accepted widget count per document; the rest stays source. */
  maxWidgets: 200,
} as const;

/**
 * Reports whether a widget stays editable source instead of rendering.
 *
 * Oversized regions are preserved: rendering them would cost more than the
 * preview is worth and could freeze typing. The caller shows the source with
 * an inline message when this returns true.
 */
export function shouldPreserveAsSource(widget: RichWidget): boolean {
  if (widget.source.length > richLimits.maxSourceChars) return true;
  if (
    (widget.kind === 'math-inline' || widget.kind === 'math-display') &&
    widget.source.length > richLimits.maxMathChars
  )
    return true;
  if (
    widget.kind === 'diagram' &&
    widget.source.length > richLimits.maxDiagramChars
  )
    return true;
  if (widget.kind === 'table') {
    const rows = widget.source.split('\n').length;
    if (rows > richLimits.maxTableRows) return true;
  }
  return false;
}

/** One fenced code block with its absolute offsets. */
type Fence = {
  readonly from: number;
  readonly to: number;
  readonly info: string;
  /** The inner text between the fences, without the fence lines. */
  readonly inner: string;
};

/** Finds fenced code blocks with absolute offsets. */
function findFences(source: string): Fence[] {
  const fences: Fence[] = [];
  const lines = source.split('\n');
  let offset = 0;
  let open: {
    from: number;
    char: string;
    length: number;
    info: string;
  } | null = null;
  let innerStart = 0;
  for (const line of lines) {
    const lineFrom = offset;
    const lineTo = offset + line.length;
    const match = /^(?: {0,3})(```+|~~~+)/.exec(line);
    if (match !== null) {
      const run = match[1] ?? '';
      const char = run[0] ?? '`';
      if (open === null) {
        if (
          char === '`' &&
          line.slice(line.indexOf(run) + run.length).includes('`')
        ) {
          // A backtick fence whose info string holds a backtick is a
          // paragraph under CommonMark, not a fence.
        } else {
          const info = line
            .slice(line.indexOf(run) + run.length)
            .trim()
            .toLowerCase();
          open = { from: lineFrom, char, length: run.length, info };
          innerStart = lineTo + 1;
        }
      } else if (char === open.char && run.length >= open.length) {
        fences.push({
          from: open.from,
          to: Math.min(
            source.length,
            lineTo + (lineTo < source.length ? 1 : 0),
          ),
          info: open.info,
          inner: source.slice(innerStart, lineFrom),
        });
        open = null;
      }
    }
    offset = lineTo + 1;
  }
  return fences;
}

/** Whether an offset sits inside any of the given ranges. */
function inside(
  offset: number,
  ranges: ReadonlyArray<{ from: number; to: number }>,
): boolean {
  return ranges.some((range) => offset >= range.from && offset < range.to);
}

/** Inline code spans with absolute offsets, outside fenced blocks. */
function findCodeSpans(
  source: string,
  fences: readonly Fence[],
): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  const pattern = /(`+)([^`\n]*?)\1/g;
  for (;;) {
    const match = pattern.exec(source);
    if (match === null) return spans;
    const full = match[0] ?? '';
    if (full === '') return spans;
    const start = match.index ?? 0;
    if (!inside(start, fences))
      spans.push({ from: start, to: start + full.length });
  }
}

/**
 * Finds the rich regions of one Markdown source.
 *
 * Returns exact source ranges in document order: inline images, GFM tables,
 * inline and display math, and Mermaid fences. Code fences (other than
 * Mermaid, which is reported as a diagram) and inline code spans never
 * produce widgets. An unclosed fence produces no diagram. At most
 * `richLimits.maxWidgets` regions are returned; the rest of a very long
 * document stays editable source.
 */
export function findRichWidgets(source: string): readonly RichWidget[] {
  const widgets: RichWidget[] = [];
  const fences = findFences(source);
  const codeSpans = findCodeSpans(source, fences);

  for (const fence of fences) {
    if (fence.info === 'mermaid') {
      const text = source.slice(fence.from, fence.to);
      widgets.push({
        from: fence.from,
        to: fence.to,
        kind: 'diagram',
        source: text,
      });
    }
  }

  const imagePattern = /!\[([^\]\n]*)\]\(([^)\s\n]+)\)/g;
  for (;;) {
    const match = imagePattern.exec(source);
    if (match === null) break;
    const full = match[0] ?? '';
    if (full === '') break;
    const start = match.index ?? 0;
    if (inside(start, fences) || inside(start, codeSpans)) continue;
    widgets.push({
      from: start,
      to: start + full.length,
      kind: 'image',
      source: full,
    });
  }

  const displayPattern = /\$\$([\s\S]+?)\$\$/g;
  for (;;) {
    const match = displayPattern.exec(source);
    if (match === null) break;
    const full = match[0] ?? '';
    if (full === '') break;
    const start = match.index ?? 0;
    if (inside(start, fences) || inside(start, codeSpans)) continue;
    if (source[start - 1] === '\\') continue;
    widgets.push({
      from: start,
      to: start + full.length,
      kind: 'math-display',
      source: full,
    });
  }

  const inlinePattern = /\$([^$\n]+?)\$/g;
  for (;;) {
    const match = inlinePattern.exec(source);
    if (match === null) break;
    const full = match[0] ?? '';
    if (full === '') break;
    const start = match.index ?? 0;
    if (inside(start, fences) || inside(start, codeSpans)) continue;
    if (source[start - 1] === '\\') continue;
    if (source[start + 1] === '$' || full.endsWith('$$')) continue;
    if (widgets.some((widget) => start >= widget.from && start < widget.to))
      continue;
    widgets.push({
      from: start,
      to: start + full.length,
      kind: 'math-inline',
      source: full,
    });
  }

  const lines = source.split('\n');
  let offset = 0;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const lineFrom = offset;
    const next = lines[index + 1];
    if (
      line.includes('|') &&
      next !== undefined &&
      /^\s*\|?[\s:|.-]+\|?[\s:|.-]*$/.test(next) &&
      next.includes('-')
    ) {
      let end = index + 2;
      while (end < lines.length && (lines[end] ?? '').includes('|')) end += 1;
      let to = lineFrom;
      for (let row = index; row < end; row += 1)
        to += (lines[row] ?? '').length + (row < end - 1 ? 1 : 0);
      if (!inside(lineFrom, fences)) {
        widgets.push({
          from: lineFrom,
          to: Math.min(source.length, to),
          kind: 'table',
          source: source.slice(lineFrom, Math.min(source.length, to)),
        });
      }
      for (let row = index; row < end; row += 1)
        offset += (lines[row] ?? '').length + 1;
      index = end;
      continue;
    }
    offset += line.length + 1;
    index += 1;
  }

  widgets.sort((left, right) => left.from - right.from || left.to - right.to);
  const placed: RichWidget[] = [];
  for (const widget of widgets) {
    if (placed.length >= richLimits.maxWidgets) break;
    const overlap = placed.some(
      (other) => widget.from < other.to && widget.to > other.from,
    );
    if (!overlap) placed.push(widget);
  }
  return placed;
}

/**
 * Parses one GFM table source into rows of cells.
 *
 * Returns null when the source is not a table, so the caller falls back to
 * editable source. Alignment from the delimiter row is reported per column
 * but rendering may ignore it; it is content, not styling.
 */
export function parseTableSource(source: string): {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
} | null {
  const lines = source.split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) return null;
  const split = (line: string): string[] => {
    const trimmed = line.trim();
    const inner =
      trimmed.startsWith('|') && trimmed.endsWith('|')
        ? trimmed.slice(1, -1)
        : trimmed;
    return inner.split('|').map((cell) => cell.trim());
  };
  const header = split(lines[0] ?? '');
  const delimiter = split(lines[1] ?? '');
  if (header.length === 0 || delimiter.length !== header.length) return null;
  if (!delimiter.every((cell) => /^:?-{1,}:?$/.test(cell))) return null;
  const rows = lines.slice(2).map((line) => split(line));
  return { header, rows };
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
   * Resolves an attachment revision ID to a local object URL, or null when
   * the bytes are not ready. Never fetches an external URL.
   */
  readonly resolveAttachment?:
    ((revisionId: string) => string | null) | undefined;
  /**
   * Creates the diagram element for one Mermaid source, for example an
   * isolated frame. May throw; a throw shows editable source.
   */
  readonly createDiagram?: ((source: string) => HTMLElement) | undefined;
  /** Called when a widget reveals its source region. */
  readonly onOpenSource?: ((widget: RichWidget) => void) | undefined;
};

/** The accessible label of one widget kind. */
function widgetLabel(kind: RichWidgetKind): string {
  if (kind === 'image') return 'Image preview';
  if (kind === 'table') return 'Table preview';
  if (kind === 'math-inline') return 'Inline math preview';
  if (kind === 'math-display') return 'Display math preview';
  return 'Diagram preview';
}

/** Moves the selection to a widget source range and focuses the editor. */
function revealSource(view: EditorView, widget: RichWidget): void {
  view.dispatch({ selection: { anchor: widget.from, head: widget.to } });
  view.focus();
}

/** One rendered widget with its source toggle. */
class RichWidgetType extends WidgetType {
  readonly widget: RichWidget;
  readonly resolvers: RichWidgetResolvers;

  constructor(widget: RichWidget, resolvers: RichWidgetResolvers) {
    super();
    this.widget = widget;
    this.resolvers = resolvers;
  }

  eq(other: RichWidgetType): boolean {
    return (
      other.widget.from === this.widget.from &&
      other.widget.to === this.widget.to &&
      other.widget.kind === this.widget.kind &&
      other.widget.source === this.widget.source
    );
  }

  /**
   * Reuses the rendered DOM while the source range is unchanged.
   *
   * Typing elsewhere in the note then keeps diagram frames alive instead of
   * reloading them. Resolver changes (a loaded attachment URL, arrived math,
   * a new theme) rebuild the whole extension through the rich compartment,
   * so stale previews cannot stick: that path destroys and recreates.
   */
  updateDOM(): boolean {
    return true;
  }

  /**
   * Releases a removed widget promptly.
   *
   * Detaching the iframe stops its load. The parent side of the diagram
   * frame also drops its message listener once the frame disconnects.
   */
  destroy(dom: HTMLElement): void {
    dom.textContent = '';
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'notes-rich';
    container.setAttribute('tabindex', '0');
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', widgetLabel(this.widget.kind));
    container.setAttribute('data-notesapp-rich', this.widget.kind);

    const preview = document.createElement('div');
    preview.className = 'notes-rich-preview';
    container.appendChild(preview);

    const showSource = (event: Event): void => {
      event.preventDefault();
      revealSource(view, this.widget);
      this.resolvers.onOpenSource?.(this.widget);
    };

    const fallback = (message: string): void => {
      const note = document.createElement('p');
      note.className = 'notes-rich-fallback';
      note.textContent = message;
      preview.appendChild(note);
      const code = document.createElement('pre');
      code.className = 'notes-rich-source';
      code.textContent = this.widget.source;
      preview.appendChild(code);
    };

    if (shouldPreserveAsSource(this.widget)) {
      fallback('This block is large, so it stays editable source.');
    } else if (this.widget.kind === 'image') {
      const match = /!\[([^\]]*)\]\(([^)\s]+)\)/.exec(this.widget.source);
      const alt = match?.[1] ?? 'image';
      const destination = match?.[2] ?? '';
      const attachment = /^\/attachments\/([^/?#]+)$/.exec(destination)?.[1];
      if (attachment !== undefined) {
        const url = this.resolvers.resolveAttachment?.(attachment) ?? null;
        if (url !== null) {
          const image = document.createElement('img');
          image.className = 'notes-rich-image';
          image.setAttribute('src', url);
          image.setAttribute('alt', alt);
          preview.appendChild(image);
        } else {
          fallback('The attachment bytes are not ready yet.');
        }
      } else {
        const note = document.createElement('p');
        note.className = 'notes-rich-fallback';
        note.textContent = `External image ${alt} needs an explicit load.`;
        preview.appendChild(note);
        const load = document.createElement('button');
        load.type = 'button';
        load.className = 'notes-rich-load';
        load.textContent = `Load ${destination}`;
        load.setAttribute('data-external-image', destination);
        load.addEventListener('click', (event: Event): void => {
          // Explicit user action only. The caller decides how to load the
          // bytes, for example by asking for user supplied bytes to import as
          // an attachment. This widget never fetches through the server.
          event.preventDefault();
          revealSource(view, this.widget);
          this.resolvers.onOpenSource?.(this.widget);
        });
        preview.appendChild(load);
      }
    } else if (this.widget.kind === 'table') {
      const parsed = parseTableSource(this.widget.source);
      if (parsed === null) {
        fallback(
          'This table cannot be previewed, so it stays editable source.',
        );
      } else {
        const table = document.createElement('table');
        table.className = 'notes-rich-table';
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const cell of parsed.header) {
          const th = document.createElement('th');
          th.textContent = cell;
          headRow.appendChild(th);
        }
        head.appendChild(headRow);
        table.appendChild(head);
        const body = document.createElement('tbody');
        for (const row of parsed.rows) {
          const tr = document.createElement('tr');
          for (const cell of row) {
            const td = document.createElement('td');
            td.textContent = cell;
            tr.appendChild(td);
          }
          body.appendChild(tr);
        }
        table.appendChild(body);
        preview.appendChild(table);
      }
    } else if (
      this.widget.kind === 'math-inline' ||
      this.widget.kind === 'math-display'
    ) {
      const display = this.widget.kind === 'math-display';
      const inner =
        this.widget.kind === 'math-inline'
          ? this.widget.source.replace(/^\$/, '').replace(/\$$/, '')
          : this.widget.source.replace(/^\$\$/, '').replace(/\$\$$/, '');
      if (this.resolvers.renderMath === undefined) {
        fallback('Math rendering is still loading.');
      } else {
        try {
          const holder = document.createElement('div');
          holder.innerHTML = this.resolvers.renderMath(inner, display);
          preview.appendChild(holder);
        } catch {
          fallback(
            'This math cannot be rendered, so it stays editable source.',
          );
        }
      }
    } else if (this.resolvers.createDiagram === undefined) {
      fallback('Diagram rendering is still loading.');
    } else {
      try {
        preview.appendChild(this.resolvers.createDiagram(this.widget.source));
      } catch {
        fallback(
          'This diagram cannot be rendered, so it stays editable source.',
        );
      }
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'notes-rich-source-toggle';
    toggle.textContent = 'Show source';
    toggle.setAttribute('aria-label', 'Show the source of this preview');
    toggle.addEventListener('click', showSource);
    container.appendChild(toggle);

    container.addEventListener('keydown', (event: KeyboardEvent): void => {
      if (event.key === 'Enter' && event.target === container)
        showSource(event);
    });
    container.addEventListener('dblclick', showSource);
    return container;
  }
}

/** The preview styles. Colors follow Tokyo Night CSS variables. */
const richWidgetTheme = EditorView.baseTheme({
  '& .notes-rich': {
    border: '1px solid var(--notes-border, #6b7499)',
    borderRadius: '6px',
    margin: '8px 0',
    padding: '8px',
    backgroundColor: 'var(--notes-surface, rgba(127, 127, 127, 0.08))',
    color: 'var(--notes-text, inherit)',
  },
  '& .notes-rich:focus-within': {
    outline: '3px solid var(--notes-focus, #7aa2f7)',
    outlineOffset: '2px',
  },
  '& .notes-rich-image': { maxWidth: '100%', borderRadius: '4px' },
  '& .notes-rich-table': {
    borderCollapse: 'collapse',
    display: 'block',
    overflowX: 'auto',
  },
  '& .notes-rich-table th, & .notes-rich-table td': {
    border: '1px solid var(--notes-border, #6b7499)',
    padding: '4px 8px',
  },
  '& .notes-rich-fallback': { margin: '4px 0' },
  '& .notes-rich-source': {
    fontFamily: 'ui-monospace, monospace',
    whiteSpace: 'pre-wrap',
  },
  '& .notes-rich-source-toggle, & .notes-rich-load': {
    font: 'inherit',
    minHeight: '44px',
    marginTop: '4px',
  },
  '& .notes-math, & .katex': { color: 'var(--notes-text, inherit)' },
});

/**
 * Builds the decoration set of one editor view.
 *
 * Every widget replaces its source range with an accessible preview. The
 * document keeps the source; only the viewport display changes. A widget that
 * must stay source still replaces its range, but with source text and a
 * message rather than with a rendered preview.
 */
export function buildRichWidgetDecorations(
  view: EditorView,
  resolvers: RichWidgetResolvers,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  const found = findRichWidgets(text);
  type Placed = { from: number; to: number; decoration: Decoration };
  const placed: Placed[] = [];
  for (const widget of found) {
    if (widget.to > widget.from)
      placed.push({
        from: widget.from,
        to: widget.to,
        decoration: Decoration.replace({
          widget: new RichWidgetType(widget, resolvers),
        }),
      });
  }
  placed.sort((left, right) => left.from - right.from || left.to - right.to);
  for (const item of placed) builder.add(item.from, item.to, item.decoration);
  return builder.finish();
}

/**
 * The rich widget extension.
 *
 * Recomputes previews when the document or the viewport changes. Resolvers
 * are injected by the web composition and may change without rebuilding the
 * editor. Nothing here dispatches a document change.
 */
export function richWidgets(resolvers: RichWidgetResolvers = {}): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildRichWidgetDecorations(view, resolvers);
      }
      update(update: {
        readonly docChanged: boolean;
        readonly viewportChanged: boolean;
        readonly view: EditorView;
      }): void {
        if (update.docChanged || update.viewportChanged)
          this.decorations = buildRichWidgetDecorations(update.view, resolvers);
      }
    },
    { decorations: (value) => value.decorations },
  );
  return [plugin, richWidgetTheme];
}
