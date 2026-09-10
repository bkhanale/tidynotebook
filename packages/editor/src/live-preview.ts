/**
 * Source-preserving live preview decorations.
 *
 * The editor always keeps the Markdown source as the document. This module
 * computes two things from that source: the ranges of the syntax markers
 * (`#`, `**`, list bullets, link brackets, and similar) and the ranges of the
 * content those markers format. The editor extension hides the markers that
 * sit outside the active selection and styles the content in place, so the
 * note looks formatted while the text stays editable. When the cursor enters
 * a formatted region its markers are shown again.
 *
 * The scanning is line based and viewport scoped. Fenced code content gets a
 * code style, but is excluded from other formatting, so a `#` inside code is
 * never treated as a heading. Decorations never rewrite the document; they
 * only hide or style ranges. React rerenders and theme changes must never
 * replace the document to update them.
 */
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';

/** What kind of Markdown syntax a range belongs to. */
export type MarkerKind =
  | 'heading'
  | 'emphasis'
  | 'list'
  | 'task'
  | 'link'
  | 'code'
  | 'code-block'
  | 'quote';

/** One range of syntax marker text, for example the `#` run or the `**`. */
export type Marker = {
  readonly from: number;
  readonly to: number;
  readonly kind: MarkerKind;
};

/** One range of formatted content, for example the heading text. */
export type StyledSpan = {
  readonly from: number;
  readonly to: number;
  readonly kind: MarkerKind;
  readonly level?: number | undefined;
  readonly variant?: 'bold' | 'italic' | 'strike' | 'code' | undefined;
};

/** The result of scanning one block of source text. */
export type MarkerScan = {
  readonly markers: readonly Marker[];
  readonly styles: readonly StyledSpan[];
};

/** One line with its absolute offset in the scanned block. */
type Line = {
  readonly text: string;
  readonly from: number;
};

/** Splits text into lines while keeping absolute offsets. */
function splitLines(text: string, base: number): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      lines.push({ text: text.slice(start, index), from: base + start });
      start = index + 1;
    }
  }
  lines.push({ text: text.slice(start), from: base + start });
  return lines;
}

/** A fence run that opens or closes a code block, or null. */
function fenceRun(line: string): { readonly char: string } | null {
  const match = /^(?: {0,3})(```+|~~~+)/.exec(line);
  if (match === null) return null;
  const run = match[1] ?? '';
  const char = run[0] ?? '';
  return char === '' ? null : { char };
}

/** Inline code spans of one line, with absolute offsets. */
function codeSpans(line: Line): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  const pattern = /(`+)([^`\n]*?)\1/g;
  for (;;) {
    const match = pattern.exec(line.text);
    if (match === null) return spans;
    const full = match[0] ?? '';
    if (full === '') return spans;
    const start = (match.index ?? 0) + line.from;
    spans.push({ from: start, to: start + full.length });
  }
}

/** Whether a range overlaps any of the given spans. */
function overlaps(
  from: number,
  to: number,
  spans: ReadonlyArray<{ from: number; to: number }>,
): boolean {
  return spans.some((span) => from < span.to && to > span.from);
}

/** Records one marker and returns nothing, so call sites stay short. */
function mark(
  markers: Marker[],
  from: number,
  to: number,
  kind: MarkerKind,
): void {
  if (to > from) markers.push({ from, to, kind });
}

/** Scans a heading line. Returns true when the line is a heading. */
function scanHeading(
  line: Line,
  markers: Marker[],
  styles: StyledSpan[],
): boolean {
  const match = /^( {0,3})(#{1,6})([ \t]+|$)/.exec(line.text);
  if (match === null) return false;
  const indent = match[1] ?? '';
  const hashes = match[2] ?? '';
  const rest = match[3] ?? '';
  const markerFrom = line.from + indent.length;
  mark(markers, markerFrom, markerFrom + hashes.length, 'heading');
  const contentFrom = markerFrom + hashes.length + rest.length;
  const contentTo = line.from + line.text.replace(/\r$/, '').length;
  if (contentTo > contentFrom)
    styles.push({
      from: contentFrom,
      to: contentTo,
      kind: 'heading',
      level: hashes.length,
    });
  return true;
}

/** Scans a list bullet and an optional task box. */
function scanList(
  line: Line,
  markers: Marker[],
  code: ReturnType<typeof codeSpans>,
): void {
  const match = /^( {0,3})((?:[-+*])|(?:\d{1,9}[.)]))([ \t]+|$)/.exec(
    line.text,
  );
  if (match === null) return;
  const indent = match[1] ?? '';
  const bullet = match[2] ?? '';
  const gap = match[3] ?? '';
  const bulletFrom = line.from + indent.length;
  if (!overlaps(bulletFrom, bulletFrom + bullet.length, code))
    mark(markers, bulletFrom, bulletFrom + bullet.length, 'list');
  if (gap === '') return;
  const boxStart = bulletFrom + bullet.length + gap.length;
  const boxText = line.text.slice(
    boxStart - line.from,
    boxStart - line.from + 3,
  );
  if (boxText.length === 3 && boxText[0] === '[' && boxText[2] === ']') {
    const middle = boxText[1] ?? '';
    if (middle === ' ' || middle === 'x' || middle === 'X') {
      if (!overlaps(boxStart, boxStart + 3, code))
        mark(markers, boxStart, boxStart + 3, 'task');
    }
  }
}

/** Scans a block quote marker and styles the quoted content. */
function scanQuote(line: Line, markers: Marker[], styles: StyledSpan[]): void {
  const match = /^( {0,3})(>)([ \t]?)/.exec(line.text);
  if (match === null) return;
  const indent = match[1] ?? '';
  const marker = match[2] ?? '';
  const gap = match[3] ?? '';
  const markerFrom = line.from + indent.length;
  const contentFrom = markerFrom + marker.length + gap.length;
  mark(markers, markerFrom, contentFrom, 'quote');
  const contentTo = line.from + line.text.replace(/\r$/, '').length;
  if (contentTo > contentFrom)
    styles.push({ from: contentFrom, to: contentTo, kind: 'quote' });
}

/** Scans emphasis, strikethrough, and inline code of one line. */
function scanInline(
  line: Line,
  markers: Marker[],
  styles: StyledSpan[],
  code: ReturnType<typeof codeSpans>,
): void {
  for (const span of code) {
    const run = line.text.slice(span.from - line.from);
    const ticks = /^`+/.exec(run)?.[0] ?? '';
    if (ticks !== '') {
      mark(markers, span.from, span.from + ticks.length, 'code');
      mark(markers, span.to - ticks.length, span.to, 'code');
      if (span.to - ticks.length > span.from + ticks.length)
        styles.push({
          from: span.from + ticks.length,
          to: span.to - ticks.length,
          kind: 'code',
          variant: 'code',
        });
    }
  }
  const pattern = /(\*\*|__|~~|\*|_)(?=\S)(.+?)(?<=\S)\1/g;
  for (;;) {
    const match = pattern.exec(line.text);
    if (match === null) return;
    const full = match[0] ?? '';
    if (full === '') return;
    const delimiter = match[1] ?? '';
    const inner = match[2] ?? '';
    const start = (match.index ?? 0) + line.from;
    const end = start + full.length;
    if (overlaps(start, end, code)) continue;
    const variant =
      delimiter === '**' || delimiter === '__'
        ? ('bold' as const)
        : delimiter === '~~'
          ? ('strike' as const)
          : ('italic' as const);
    mark(markers, start, start + delimiter.length, 'emphasis');
    mark(markers, end - delimiter.length, end, 'emphasis');
    const innerFrom = start + delimiter.length;
    const innerTo = innerFrom + inner.length;
    if (innerTo > innerFrom)
      styles.push({ from: innerFrom, to: innerTo, kind: 'emphasis', variant });
  }
}

/** Scans Markdown links and wiki links of one line. */
function scanLinks(
  line: Line,
  markers: Marker[],
  styles: StyledSpan[],
  code: ReturnType<typeof codeSpans>,
): void {
  const inline = /\[([^\]\n]*)\]\(([^)\s\n]+)\)/g;
  for (;;) {
    const match = inline.exec(line.text);
    if (match === null) break;
    const full = match[0] ?? '';
    if (full === '') break;
    const label = match[1] ?? '';
    const start = (match.index ?? 0) + line.from;
    const end = start + full.length;
    if (overlaps(start, end, code)) continue;
    mark(markers, start, start + 1, 'link');
    const labelFrom = start + 1;
    const labelTo = labelFrom + label.length;
    if (labelTo > labelFrom)
      styles.push({ from: labelFrom, to: labelTo, kind: 'link' });
    mark(markers, labelTo, end, 'link');
  }
  const wiki = /\[\[([^\]\n]+)\]\]/g;
  for (;;) {
    const match = wiki.exec(line.text);
    if (match === null) return;
    const full = match[0] ?? '';
    if (full === '') return;
    const title = match[1] ?? '';
    const start = (match.index ?? 0) + line.from;
    const end = start + full.length;
    if (overlaps(start, end, code)) continue;
    mark(markers, start, start + 2, 'link');
    mark(markers, end - 2, end, 'link');
    const titleFrom = start + 2;
    const titleTo = titleFrom + title.length;
    if (titleTo > titleFrom)
      styles.push({ from: titleFrom, to: titleTo, kind: 'link' });
  }
}

/**
 * Scans one block of source text for markers and styled spans.
 *
 * `base` is the absolute offset of `text` in the document, so a viewport
 * slice still reports document offsets. The scan never changes the text;
 * every reported range slices the original string.
 */
export function scanBlockMarkers(text: string, base: number): MarkerScan {
  const markers: Marker[] = [];
  const styles: StyledSpan[] = [];
  let inFence: string | null = null;
  for (const line of splitLines(text, base)) {
    const fence = fenceRun(line.text);
    if (fence !== null && (inFence === null || inFence === fence.char)) {
      const run = /```+|~~~+/.exec(line.text)?.[0] ?? '';
      const at = line.text.indexOf(run);
      if (run !== '' && at >= 0)
        mark(markers, line.from + at, line.from + at + run.length, 'code');
      inFence = inFence === null ? fence.char : null;
      continue;
    }
    if (inFence !== null) {
      const contentTo = line.from + line.text.replace(/\r$/, '').length;
      if (contentTo > line.from)
        styles.push({
          from: line.from,
          to: contentTo,
          kind: 'code-block',
        });
      continue;
    }
    const code = codeSpans(line);
    const isHeading = scanHeading(line, markers, styles);
    if (!isHeading) scanList(line, markers, code);
    scanQuote(line, markers, styles);
    scanInline(line, markers, styles, code);
    scanLinks(line, markers, styles, code);
  }
  return { markers, styles };
}

/**
 * Scans a whole document. A viewport slice uses `scanBlockMarkers` with its
 * document offset instead; this helper covers tests and single-block callers.
 */
export function scanTextMarkers(text: string): MarkerScan {
  return scanBlockMarkers(text, 0);
}

/**
 * Whether a marker is revealed because the selection touches it.
 *
 * A collapsed cursor reveals the marker it sits in or at the edge of, so the
 * syntax appears as soon as the cursor enters it. A range selection reveals
 * every marker it overlaps, so a selection across hidden syntax keeps its
 * Markdown visible for copying.
 */
export function isRevealed(
  from: number,
  to: number,
  selectionFrom: number,
  selectionTo: number,
): boolean {
  if (selectionFrom === selectionTo)
    return from <= selectionFrom && selectionFrom <= to;
  return from < selectionTo && to > selectionFrom;
}

/**
 * Splits markers into hidden and revealed sets for one selection.
 *
 * Task boxes and code ticks are always revealed: a checkbox must stay visible
 * to show its state, and code ticks mark editable source. All other markers
 * outside the selection are hidden.
 */
export function partitionMarkers(
  markers: readonly Marker[],
  selectionFrom: number,
  selectionTo: number,
): {
  readonly hidden: readonly Marker[];
  readonly revealed: readonly Marker[];
} {
  const hidden: Marker[] = [];
  const revealed: Marker[] = [];
  for (const marker of markers) {
    if (marker.kind === 'task' || marker.kind === 'code') {
      revealed.push(marker);
      continue;
    }
    if (isRevealed(marker.from, marker.to, selectionFrom, selectionTo))
      revealed.push(marker);
    else hidden.push(marker);
  }
  return { hidden, revealed };
}

/** The CSS class of one styled span. */
function styleClass(span: StyledSpan): string {
  if (span.kind === 'heading') {
    const level = span.level ?? 1;
    if (level <= 1) return 'cm-np-heading cm-np-h1';
    if (level === 2) return 'cm-np-heading cm-np-h2';
    return 'cm-np-heading cm-np-h3';
  }
  if (span.kind === 'emphasis') {
    if (span.variant === 'bold') return 'cm-np-bold';
    if (span.variant === 'strike') return 'cm-np-strike';
    return 'cm-np-italic';
  }
  if (span.kind === 'link') return 'cm-np-link';
  if (span.kind === 'code') return 'cm-np-code';
  if (span.kind === 'code-block') return 'cm-np-code-block';
  if (span.kind === 'quote') return 'cm-np-quote';
  if (span.kind === 'task') return 'cm-np-taskbox';
  return 'cm-np-list';
}

/** Replaces an unordered list marker with an accessible visual bullet. */
class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-np-bullet';
    span.textContent = '•';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  override eq(): boolean {
    return true;
  }
}

/**
 * Builds the decoration set of one editor view.
 *
 * Only the visible ranges are scanned, after expanding each to full lines, so
 * a long note renders only its affected visible regions. Hidden markers use a
 * replaced decoration; revealed markers and styled spans use marks. The
 * document is never changed.
 */
export function buildLivePreviewDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const selection = view.state.selection.main;
  type Placed = { from: number; to: number; decoration: Decoration };
  const placed: Placed[] = [];
  for (const range of view.visibleRanges) {
    const first = view.state.doc.lineAt(range.from);
    const last = view.state.doc.lineAt(range.to);
    const slice = view.state.doc.sliceString(first.from, last.to);
    const scan = scanBlockMarkers(slice, first.from);
    const { hidden, revealed } = partitionMarkers(
      scan.markers,
      selection.from,
      selection.to,
    );

    for (const marker of hidden) {
      if (marker.kind === 'list') {
        const markerText = view.state.doc.sliceString(marker.from, marker.to);
        const isOrdered = /^\d+[.)]$/.test(markerText);
        if (isOrdered) {
          placed.push({
            from: marker.from,
            to: marker.to,
            decoration: Decoration.mark({ class: 'cm-np-list-number' }),
          });
        } else {
          const line = view.state.doc.lineAt(marker.from);
          const hasTask = /^( {0,3})[-+*][ \t]+\[[ xX]\]/.test(line.text);
          if (hasTask) {
            placed.push({
              from: marker.from,
              to: marker.to,
              decoration: Decoration.replace({}),
            });
          } else {
            placed.push({
              from: marker.from,
              to: marker.to,
              decoration: Decoration.replace({ widget: new BulletWidget() }),
            });
          }
        }
      } else {
        placed.push({
          from: marker.from,
          to: marker.to,
          decoration: Decoration.replace({}),
        });
      }
    }
    for (const marker of revealed) {
      const isOrdered =
        marker.kind === 'list' &&
        /^\d+[.)]$/.test(view.state.doc.sliceString(marker.from, marker.to));
      placed.push({
        from: marker.from,
        to: marker.to,
        decoration: Decoration.mark({
          class: isOrdered ? 'cm-np-list-number' : 'cm-np-marker',
        }),
      });
    }
    for (const span of scan.styles) {
      if (span.to > span.from)
        placed.push({
          from: span.from,
          to: span.to,
          decoration: Decoration.mark({ class: styleClass(span) }),
        });
    }
  }
  placed.sort((left, right) => left.from - right.from || left.to - right.to);
  for (const item of placed) builder.add(item.from, item.to, item.decoration);
  return builder.finish();
}

/** The preview styles. Colors follow CSS variables with neutral fallbacks. */
const livePreviewTheme = EditorView.baseTheme({
  '& .cm-np-heading': { fontWeight: '700' },
  '& .cm-np-h1': { fontSize: 'var(--text-xl)' },
  '& .cm-np-h2': { fontSize: 'var(--text-lg)' },
  '& .cm-np-h3': { fontSize: 'var(--text-base)' },
  '& .cm-np-bold': { fontWeight: '700' },
  '& .cm-np-italic': { fontStyle: 'italic' },
  '& .cm-np-strike': { textDecoration: 'line-through' },
  '& .cm-np-code': {
    fontFamily: 'var(--font-mono)',
    backgroundColor: 'var(--notes-surface-hover)',
    borderRadius: 'var(--radius-sm)',
    paddingInline: 'calc(var(--spacing) * 0.5)',
  },
  '& .cm-np-code-block': {
    fontFamily: 'var(--font-mono)',
    backgroundColor: 'var(--notes-surface-hover)',
    borderRadius: 'var(--radius-sm)',
    boxDecorationBreak: 'clone',
    paddingInline: 'calc(var(--spacing) * 1.5)',
  },
  '& .cm-np-quote': {
    color: 'var(--notes-text-muted)',
    fontStyle: 'italic',
    borderLeft: '2px solid var(--notes-border-subtle)',
    paddingLeft: 'calc(var(--spacing) * 2)',
  },
  '& .cm-np-link': {
    color: 'var(--notes-accent-text)',
    textDecoration: 'underline',
  },
  '& .cm-np-marker': { opacity: '0.55' },
  '& .cm-np-bullet': {
    color: 'var(--notes-accent-fill)',
    fontWeight: '700',
    display: 'inline-block',
    paddingRight: 'calc(var(--spacing) * 1.5)',
  },
  '& .cm-np-list-number': {
    color: 'var(--notes-text-muted)',
    fontWeight: '600',
    opacity: '0.85',
  },
  '& .cm-np-taskbox': { fontWeight: '700' },
});

/**
 * The live preview extension.
 *
 * Recomputes decorations when the document, the selection, or the viewport
 * changes. Nothing here dispatches a document change, so undo history, IME
 * composition, and the selection survive decoration updates.
 */
export function livePreview(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildLivePreviewDecorations(view);
      }
      update(update: {
        readonly docChanged: boolean;
        readonly selectionSet: boolean;
        readonly viewportChanged: boolean;
        readonly view: EditorView;
      }): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged)
          this.decorations = buildLivePreviewDecorations(update.view);
      }
    },
    { decorations: (value) => value.decorations },
  );
  return [plugin, livePreviewTheme];
}
