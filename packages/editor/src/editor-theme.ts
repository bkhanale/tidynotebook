/**
 * The typed style adapter of the note surface.
 *
 * CodeMirror builds its own DOM, so a utility class cannot reach a line, a
 * marker, or a widget. This module is the one place that sets the
 * appearance of that generated DOM, and every value it writes is a central
 * theme variable declared in `apps/web/src/tailwind.css`. Nothing here
 * invents a color, a size, or a radius.
 *
 * The note surface is the design. Body text is 16 px on a 1.65 line height
 * at a measure of about 68 characters, headings run on one clear ramp from
 * twice the body size down to body size at level six, blocks breathe with
 * one shared vertical rhythm, and monospaced text sits at 0.9 em so a code
 * span keeps the line height of the paragraph around it.
 *
 * `editorThemeVariables` lists every custom property this module reads. A
 * unit test asserts that the built stylesheet declares all of them, which is
 * how a variable that Tailwind never emits gets caught before a release.
 */
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * Every custom property the adapter reads from the built stylesheet.
 *
 * The runtime palette (`--notes-*`) is written by `applyTheme` in
 * `@notesapp/ui` at run time and is deliberately not listed here.
 */
export const editorThemeVariables: readonly string[] = [
  '--font-sans',
  '--font-mono',
  '--spacing',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--text-ui',
  '--text-ui--line-height',
  '--text-control',
  '--text-note',
  '--text-note--line-height',
  '--note-measure',
  '--note-gap',
  '--note-mono-size',
  '--note-h1',
  '--note-h2',
  '--note-h3',
  '--note-h4',
  '--note-h5',
  '--note-h6',
];

/** The heading ramp, level by level. */
const headingSizes = [
  'var(--note-h1)',
  'var(--note-h2)',
  'var(--note-h3)',
  'var(--note-h4)',
  'var(--note-h5)',
  'var(--note-h6)',
];

/** The heading rules, one per level. */
function headingRules(): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {};
  headingSizes.forEach((size, index) => {
    rules[`.cm-np-h${String(index + 1)}`] = {
      fontSize: size,
      lineHeight: '1.25',
      fontWeight: index < 3 ? '700' : '600',
      color: 'var(--notes-text-strong)',
    };
  });
  return rules;
}

/** The quote bar of one nesting level, drawn with inset shadows. */
function quoteBars(level: number): string {
  const bars: string[] = [];
  for (let index = 0; index < level; index += 1)
    bars.push(
      `inset calc(var(--spacing) * ${String(index * 3)} + 2px) 0 0 calc(var(--spacing) * -1 + 6px) var(--notes-border)`,
    );
  return bars.join(', ');
}

/**
 * The complete note surface style for one palette.
 *
 * The palette only decides whether CodeMirror treats the editor as dark;
 * every color comes from a runtime variable, so a palette change never
 * rebuilds this object.
 */
export function editorTheme(theme: 'light' | 'dark'): Extension {
  return EditorView.theme(noteSurfaceStyle(), { dark: theme === 'dark' });
}

/**
 * The style rules of the note surface, so a unit test can read them.
 *
 * The block padding of the surface belongs to `.cm-content` and never to
 * `.cm-scroller`. `.cm-content` is the editable element, so a click inside
 * its padding places the caret on the nearest line. Padding on the scroller
 * would put that same strip outside the editable element, and a click under
 * the last line would then place no caret and lose every keystroke after it.
 *
 * The reading measure belongs to `.cm-line` and to a block widget, not to
 * `.cm-content`. The content element therefore keeps the full width of the
 * scroller, so the empty strip left and right of the text still belongs to
 * the editable element and a click there places the caret on that line. A
 * measure on `.cm-content` would put both strips outside the text and a
 * click in them would do nothing.
 */
export function noteSurfaceStyle(): Parameters<typeof EditorView.theme>[0] {
  return {
    // The note is the product, so its body reads in the strong text color
    // and not in the quieter interface body color.
    '&': {
      backgroundColor: 'var(--notes-bg)',
      color: 'var(--notes-text-strong)',
      fontSize: 'var(--text-note)',
      lineHeight: 'var(--text-note--line-height)',
    },
    // The scroller stretches its content, so the empty area under the last
    // line still belongs to the editable element and a click there places
    // the caret. The block padding therefore sits on the content and not on
    // the scroller.
    '.cm-scroller': {
      fontFamily: 'var(--font-sans)',
      lineHeight: 'var(--text-note--line-height)',
      alignItems: 'stretch',
    },
    '.cm-content': {
      caretColor: 'var(--notes-focus)',
      width: '100%',
      paddingInline: 'calc(var(--spacing) * 4)',
      paddingBlock: 'calc(var(--spacing) * 6)',
    },
    '.cm-line': {
      maxWidth: 'var(--note-measure)',
      marginInline: 'auto',
      paddingInline: '0',
      paddingBlock: 'calc(var(--note-gap) / 2)',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--notes-focus)' },
    '&.cm-focused': { outline: 'none' },
    // A faint neutral tint, so the line the caret sits on is findable and
    // the note still reads as one page of text.
    '.cm-activeLine': {
      backgroundColor:
        'color-mix(in srgb, var(--notes-text-muted) 8%, transparent)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection':
      {
        backgroundColor:
          'color-mix(in srgb, var(--notes-focus) 22%, transparent)',
      },

    ...headingRules(),
    '.cm-np-heading': { paddingBlock: 'var(--note-gap)' },

    '.cm-np-bold': { fontWeight: '700', color: 'var(--notes-text-strong)' },
    '.cm-np-italic': { fontStyle: 'italic' },
    '.cm-np-strike': {
      textDecoration: 'line-through',
      color: 'var(--notes-text-muted)',
    },
    '.cm-np-marker': { color: 'var(--notes-text-muted)', opacity: '0.6' },

    '.cm-np-code': {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--note-mono-size)',
      backgroundColor: 'var(--notes-surface-hover)',
      borderRadius: 'var(--radius-sm)',
      paddingInline: 'calc(var(--spacing) * 1)',
      paddingBlock: 'calc(var(--spacing) * 0.25)',
    },
    '.cm-np-code-block-line': {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--note-mono-size)',
      backgroundColor: 'var(--notes-surface-hover)',
      paddingInline: 'calc(var(--spacing) * 3)',
    },
    '.cm-np-code-info': {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-control)',
      color: 'var(--notes-text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
    },

    '.cm-np-quote': {
      color: 'var(--notes-text-muted)',
      paddingInlineStart: 'calc(var(--spacing) * 4)',
    },
    '.cm-np-quote-1': { boxShadow: quoteBars(1) },
    '.cm-np-quote-2': {
      boxShadow: quoteBars(2),
      paddingInlineStart: 'calc(var(--spacing) * 7)',
    },
    '.cm-np-quote-3': {
      boxShadow: quoteBars(3),
      paddingInlineStart: 'calc(var(--spacing) * 10)',
    },
    '.cm-np-quote-4': {
      boxShadow: quoteBars(4),
      paddingInlineStart: 'calc(var(--spacing) * 13)',
    },

    '.cm-np-bullet': {
      color: 'var(--notes-accent-fill)',
      fontWeight: '700',
    },
    '.cm-np-list-number': {
      color: 'var(--notes-text-muted)',
      fontWeight: '600',
    },
    '.cm-np-task': {
      width: 'calc(var(--spacing) * 4)',
      height: 'calc(var(--spacing) * 4)',
      margin: '0',
      marginInlineEnd: 'calc(var(--spacing) * 1)',
      // `text-bottom` sets the foot of the box on the foot of the text, so
      // the box sits on the writing line instead of floating above it.
      verticalAlign: 'text-bottom',
      accentColor: 'var(--notes-accent-fill)',
      cursor: 'pointer',
    },
    '.cm-np-task-source': { fontFamily: 'var(--font-mono)' },

    '.cm-np-link': {
      color: 'var(--notes-accent-text)',
      textDecoration: 'underline',
      textUnderlineOffset: '2px',
    },
    '.cm-np-footnote': {
      color: 'var(--notes-accent-text)',
      fontSize: 'var(--text-control)',
      verticalAlign: 'super',
    },
    '.cm-np-footnote-definition': {
      color: 'var(--notes-text-muted)',
      fontSize: 'var(--text-ui)',
    },
    '.cm-np-link-definition': {
      color: 'var(--notes-text-muted)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--note-mono-size)',
    },

    '.cm-np-rule-line': { paddingBlock: 'var(--note-gap)' },
    '.cm-np-rule': {
      display: 'inline-block',
      width: '100%',
      verticalAlign: 'middle',
      borderTop: '1px solid var(--notes-border)',
    },

    '.cm-np-table-line': {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--note-mono-size)',
      paddingBlock: '0',
    },
    '.cm-np-table-head': {
      fontWeight: '700',
      color: 'var(--notes-text-strong)',
    },
    // The cell separators of a table carry no meaning, so they stay far
    // quieter than the text they divide.
    '.cm-np-table-align': {
      color: 'var(--notes-text-muted)',
      opacity: '0.35',
    },
    '.cm-np-table-line .cm-np-marker': { opacity: '0.35' },
    '.cm-np-align-left': { display: 'inline-block', textAlign: 'left' },
    '.cm-np-align-center': { display: 'inline-block', textAlign: 'center' },
    '.cm-np-align-right': { display: 'inline-block', textAlign: 'right' },

    '.cm-np-hard-break': {
      borderBottom: '1px dotted var(--notes-border)',
    },
    '.cm-np-html': {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--note-mono-size)',
      color: 'var(--notes-text-muted)',
    },

    '.cm-np-widget-block': {
      display: 'block',
      maxWidth: 'var(--note-measure)',
      marginInline: 'auto',
      marginBlock: 'var(--note-gap)',
    },
    '.cm-np-widget-inline': { display: 'inline' },
    '.cm-np-widget-image': {
      maxWidth: '100%',
      borderRadius: 'var(--radius-md)',
    },
    '.cm-np-widget-note': {
      color: 'var(--notes-text-muted)',
      fontSize: 'var(--text-ui)',
    },
    '.cm-np-widget-error': { color: 'var(--notes-danger-text)' },
    '.cm-np-widget-source': {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--note-mono-size)',
      whiteSpace: 'pre-wrap',
    },
    '.cm-np-widget-action': {
      font: 'inherit',
      fontSize: 'var(--text-control)',
      marginInlineStart: 'calc(var(--spacing) * 2)',
      paddingInline: 'calc(var(--spacing) * 2)',
      minHeight: 'calc(var(--spacing) * 6)',
      color: 'var(--notes-accent-text)',
      backgroundColor: 'var(--notes-surface-hover)',
      border: '1px solid var(--notes-border)',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
    },
    '.cm-np-math-display': {
      display: 'block',
      textAlign: 'center',
      paddingBlock: 'var(--note-gap)',
      borderRadius: 'var(--radius-lg)',
    },
    '.cm-np-math-inline': { display: 'inline' },
  };
}
