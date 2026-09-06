/**
 * Editor commands as CodeMirror transactions.
 *
 * Every command here describes a document change and returns it for the
 * caller to dispatch; no command touches the network, storage, or generated
 * API operations. Navigation uses injected callbacks, so this package never
 * imports the API client or a storage package.
 */
import type { ChangeSpec, TransactionSpec } from '@codemirror/state';
import { EditorState } from '@codemirror/state';

/** A link found at one document position. */
export type LinkTarget =
  | { readonly kind: 'url'; readonly target: string }
  | { readonly kind: 'wiki'; readonly title: string };

/** Callbacks the editor receives for navigation out of the text. */
export type EditorNavigation = {
  /** Opens one link target, for example through the router. */
  readonly onOpenLink?: ((target: LinkTarget) => void) | undefined;
};

/** One task box on a line, with absolute offsets. */
export type TaskBox = {
  readonly from: number;
  readonly to: number;
  readonly checked: boolean;
};

/** Finds the task box of one line, or null when the line holds no task. */
export function findTaskBox(
  lineText: string,
  lineFrom: number,
): TaskBox | null {
  const match = /^( {0,3})((?:[-+*])|(?:\d{1,9}[.)]))([ \t]+)\[([ xX])\]/.exec(
    lineText,
  );
  if (match === null) return null;
  const indent = match[1] ?? '';
  const bullet = match[2] ?? '';
  const gap = match[3] ?? '';
  const state = match[4] ?? '';
  const from = lineFrom + indent.length + bullet.length + gap.length;
  return { from, to: from + 3, checked: state === 'x' || state === 'X' };
}

/**
 * Toggles every task box touched by the selection.
 *
 * Lines with `- [ ]` become `- [x]` and lines with `- [x]` or `- [X]` become
 * `- [ ]`. Returns null when no selected line holds a task, so the caller can
 * leave the transaction undispatched and keep undo history clean.
 */
export function toggleTaskSpec(state: EditorState): TransactionSpec | null {
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from);
    const last = state.doc.lineAt(range.to);
    for (let number = first.number; number <= last.number; number += 1) {
      if (seen.has(number)) continue;
      seen.add(number);
      const line = state.doc.line(number);
      const box = findTaskBox(line.text, line.from);
      if (box === null) continue;
      changes.push({
        from: box.from + 1,
        to: box.from + 2,
        insert: box.checked ? ' ' : 'x',
      });
    }
  }
  if (changes.length === 0) return null;
  return { changes };
}

/**
 * Sets or clears the heading level of every selected line.
 *
 * A line already at `level` loses its markers and becomes a paragraph. Any
 * other line receives `level` markers, replacing its current ones. Returns
 * null when the selection covers no line, which cannot happen for a normal
 * cursor but keeps the helper total.
 */
export function headingSpec(
  state: EditorState,
  level: number,
): TransactionSpec | null {
  const clamped = Math.min(6, Math.max(1, Math.floor(level)));
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from);
    const last = state.doc.lineAt(range.to);
    for (let number = first.number; number <= last.number; number += 1) {
      if (seen.has(number)) continue;
      seen.add(number);
      const line = state.doc.line(number);
      const match = /^( {0,3})(#{1,6})([ \t]+|$)/.exec(line.text);
      const indentLength = (match?.[1] ?? '').length;
      if (match !== null && (match[2] ?? '').length === clamped) {
        const markerFrom = line.from + indentLength;
        const markerTo = markerFrom + (match[2] ?? '').length;
        const gap = match[3] ?? '';
        changes.push({
          from: markerFrom,
          to: markerTo + gap.length,
          insert: '',
        });
      } else if (match !== null) {
        const markerFrom = line.from + indentLength;
        const markerTo = markerFrom + (match[2] ?? '').length;
        changes.push({
          from: markerFrom,
          to: markerTo,
          insert: '#'.repeat(clamped),
        });
      } else {
        changes.push({
          from: line.from,
          to: line.from,
          insert: `${'#'.repeat(clamped)} `,
        });
      }
    }
  }
  if (changes.length === 0) return null;
  return { changes };
}

/** The spans of one inline link match on a line. */
type InlineLinkSpans = {
  readonly openFrom: number;
  readonly labelFrom: number;
  readonly labelTo: number;
  readonly closeTo: number;
  readonly destination: string;
};

/** Finds the inline link at a line offset, or null. */
function inlineLinkAt(
  lineText: string,
  lineFrom: number,
  offset: number,
): InlineLinkSpans | null {
  const pattern = /\[([^\]\n]*)\]\(([^)\s\n]+)\)/g;
  for (;;) {
    const match = pattern.exec(lineText);
    if (match === null) return null;
    const full = match[0] ?? '';
    if (full === '') return null;
    const label = match[1] ?? '';
    const destination = match[2] ?? '';
    const start = (match.index ?? 0) + lineFrom;
    const end = start + full.length;
    if (offset < start || offset > end) continue;
    return {
      openFrom: start,
      labelFrom: start + 1,
      labelTo: start + 1 + label.length,
      closeTo: end,
      destination,
    };
  }
}

/** Finds the wiki link at a line offset, or null. */
function wikiLinkAt(
  lineText: string,
  lineFrom: number,
  offset: number,
): { readonly title: string } | null {
  const pattern = /\[\[([^\]\n]+)\]\]/g;
  for (;;) {
    const match = pattern.exec(lineText);
    if (match === null) return null;
    const full = match[0] ?? '';
    if (full === '') return null;
    const start = (match.index ?? 0) + lineFrom;
    if (offset < start || offset > start + full.length) continue;
    return { title: match[1] ?? '' };
  }
}

/**
 * Finds the link target at one document position.
 *
 * Returns the Markdown destination for `[label](destination)` and the title
 * for `[[Title]]`. Returns null on plain text, so a normal click keeps
 * placing the cursor instead of navigating.
 */
export function linkTargetAt(
  text: string,
  position: number,
): LinkTarget | null {
  let lineFrom = 0;
  for (;;) {
    const end = text.indexOf('\n', lineFrom);
    const lineTo = end === -1 ? text.length : end;
    if (position <= lineTo) {
      const lineText = text.slice(lineFrom, lineTo);
      const inline = inlineLinkAt(lineText, lineFrom, position);
      if (inline !== null) return { kind: 'url', target: inline.destination };
      const wiki = wikiLinkAt(lineText, lineFrom, position);
      if (wiki !== null) return { kind: 'wiki', title: wiki.title };
      return null;
    }
    if (end === -1) return null;
    lineFrom = end + 1;
  }
}
