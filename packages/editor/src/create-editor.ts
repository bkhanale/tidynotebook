/**
 * The one-pane live Markdown editor.
 *
 * This module composes CodeMirror into the required Obsidian-like behavior:
 * Markdown source stays the document, the preview extension styles it in
 * place, and every change flows through CodeMirror transactions. The caller
 * owns one `EditorView` per open working copy and keeps it across React
 * rerenders; decorations, theme changes, and selection updates never replace
 * the document, so undo history, IME composition, selection, and clipboard
 * content survive them.
 */
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view';
import {
  findTaskBox,
  headingSpec,
  linkTargetAt,
  toggleTaskSpec,
  type EditorNavigation,
  type LinkTarget,
} from './commands.ts';
import { editorCommands } from './extensions.ts';
import { livePreview } from './live-preview.ts';
import { richWidgets, type RichWidgetResolvers } from './widgets.ts';

/** Optional behavior beyond the required creation signature. */
export type CreateEditorOptions = {
  /** Opens link targets, for example through the application router. */
  readonly navigation?: EditorNavigation | undefined;
  /** Runs the Save checkpoint, for example on Ctrl+S or Cmd+S. */
  readonly onSave?: (() => void) | undefined;
  /** Read-only rendering, for a preview that must not be edited. */
  readonly readOnly?: boolean | undefined;
  /** Starting palette. Later changes use `setEditorTheme` without rebuild. */
  readonly theme?: 'light' | 'dark' | undefined;
  /**
   * Rich preview resolvers for images, tables, math, and diagrams.
   *
   * The web composition injects attachment URLs, lazily loaded math, and the
   * isolated diagram frame here. When absent, rich regions still scan but
   * render as loading placeholders with their source, so the editor works
   * before the deferred modules arrive.
   */
  readonly rich?: RichWidgetResolvers | undefined;
};

/** Re-resolution of a link target for keyboard activation. */
function linkAtCursor(view: EditorView): LinkTarget | null {
  const position = view.state.selection.main.head;
  return linkTargetAt(view.state.doc.toString(), position);
}

/** Whether the position sits inside the task box of its line. */
function positionInTaskBox(view: EditorView, position: number): boolean {
  const line = view.state.doc.lineAt(position);
  const box = findTaskBox(line.text, line.from);
  return box !== null && position >= box.from && position <= box.to;
}

/** The theme compartment, so palette changes never rebuild the editor. */
const themeCompartment = new Compartment();

/** The rich preview compartment, so resolver changes never rebuild it. */
const richCompartment = new Compartment();

/** The access compartment, so a loaded role can unlock the same editor. */
const readOnlyCompartment = new Compartment();

/** Editor chrome for one palette. */
function themeExtension(theme: 'light' | 'dark'): Extension {
  return EditorView.theme(
    {
      '&': {
        backgroundColor: 'var(--notes-bg)',
        color: 'var(--notes-text)',
        fontSize: 'var(--text-ui)',
        lineHeight: 'var(--text-ui--line-height)',
        minHeight: 'calc(var(--spacing) * 96)',
      },
      '.cm-scroller': {
        fontFamily: 'var(--font-sans)',
        paddingBlock: 'calc(var(--spacing) * 4)',
      },
      '.cm-content': {
        caretColor: 'var(--notes-focus)',
        maxWidth: 'calc(var(--spacing) * 192)',
        marginInline: 'auto',
        paddingInline: 'calc(var(--spacing) * 4)',
      },
      '.cm-line': { paddingInline: 'calc(var(--spacing) * 1)' },
      '.cm-cursor': {
        borderLeftColor: 'var(--notes-focus)',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-activeLine': {
        backgroundColor:
          'color-mix(in srgb, var(--notes-focus) 8%, transparent)',
      },
    },
    { dark: theme === 'dark' },
  );
}

/**
 * Creates the live Markdown editor inside `parent`.
 *
 * `onChange` receives the full text after every document change; all other
 * updates (selection, viewport, decorations, theme) stay silent. The caller
 * destroys the view when the working copy closes and never writes the text
 * back into the document, so undo and composition stay intact.
 */
export function createEditor(
  parent: HTMLElement,
  initialText: string,
  onChange: (text: string) => void,
  options: CreateEditorOptions = {},
): EditorView {
  const navigation = options.navigation ?? {};
  const readOnly = options.readOnly ?? false;

  const saveKeymap = keymap.of([
    {
      key: 'Mod-s',
      run: (): boolean => {
        options.onSave?.();
        return true;
      },
    },
    {
      key: 'Mod-Enter',
      run: (view): boolean => {
        const spec = toggleTaskSpec(view.state);
        if (spec === null) return false;
        view.dispatch(view.state.update(spec));
        return true;
      },
    },
    {
      key: 'Alt-Enter',
      run: (view): boolean => {
        const target = linkAtCursor(view);
        if (target === null) return false;
        navigation.onOpenLink?.(target);
        return true;
      },
    },
  ]);

  const state = EditorState.create({
    doc: initialText,
    extensions: [
      history(),
      markdown(),
      livePreview(),
      richCompartment.of(richWidgets(options.rich ?? {})),
      EditorView.lineWrapping,
      themeCompartment.of(themeExtension(options.theme ?? 'dark')),
      saveKeymap,
      editorCommands(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((update: ViewUpdate): void => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
      EditorView.domEventHandlers({
        mousedown: (event, view): boolean => {
          const target = event.target as HTMLElement | null;
          const position = view.posAtCoords({
            x: event.clientX,
            y: event.clientY,
          });
          if (position === null || position === undefined) return false;
          if (!view.state.readOnly && positionInTaskBox(view, position)) {
            const spec = toggleTaskSpec(view.state);
            if (spec === null) return false;
            view.dispatch(view.state.update(spec));
            view.focus();
            event.preventDefault();
            return true;
          }
          const withModifier = event.metaKey || event.ctrlKey;
          const isTouchAction =
            target?.getAttribute('data-notesapp-touch-link') === 'true';
          if ((withModifier || isTouchAction) && !view.state.readOnly) {
            const link = linkTargetAt(view.state.doc.toString(), position);
            if (link !== null) {
              navigation.onOpenLink?.(link);
              event.preventDefault();
              return true;
            }
          }
          return false;
        },
      }),
      readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
    ],
  });

  const view = new EditorView({ state, parent });
  view.dom.setAttribute('data-notesapp-theme', options.theme ?? 'dark');
  return view;
}

/**
 * Switches the editor palette without rebuilding it.
 *
 * Only the theme compartment is reconfigured, so the document, undo history,
 * selection, and any active IME composition stay exactly where they are.
 */
export function setEditorTheme(
  view: EditorView,
  theme: 'light' | 'dark',
): void {
  view.dispatch({
    effects: themeCompartment.reconfigure(themeExtension(theme)),
  });
  view.dom.setAttribute('data-notesapp-theme', theme);
}

/**
 * Applies a changed workspace role without replacing the editor.
 *
 * The document, history, selection, and composition remain in the same
 * editor state while CodeMirror updates its editing permission.
 */
export function setEditorReadOnly(view: EditorView, readOnly: boolean): void {
  view.dispatch({
    effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
  });
}

/**
 * Switches the rich preview resolvers without rebuilding the editor.
 *
 * Only the rich compartment is reconfigured, so the document, undo history,
 * selection, and any active IME composition stay exactly where they are. The
 * web composition calls this when lazily loaded math arrives, when
 * attachment URLs resolve, and when the theme changes the diagram palette.
 */
export function setEditorRich(
  view: EditorView,
  resolvers: RichWidgetResolvers,
): void {
  view.dispatch({
    effects: richCompartment.reconfigure(richWidgets(resolvers)),
  });
}

/**
 * Applies one heading level to the current selection, if the view is live.
 *
 * Exported for future toolbar use. Returns false when no line changed.
 */
export function applyHeading(view: EditorView, level: number): boolean {
  const spec = headingSpec(view.state, level);
  if (spec === null) return false;
  view.dispatch(view.state.update(spec));
  return true;
}
