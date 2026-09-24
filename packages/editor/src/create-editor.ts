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
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  keymap,
  placeholder,
  type ViewUpdate,
} from '@codemirror/view';
import {
  editingTransaction,
  linkSpanAt,
  toggleTaskSpec,
  type EditorNavigation,
  type LinkTarget,
} from './commands.ts';
import { isRemoteChange } from './document-binding.ts';

/**
 * What a bound editor needs of the open note: its extensions and nothing
 * else. The screen holds the note itself.
 */
type BoundEditorDocument = { readonly extension: Extension };
import { editorCommands } from './extensions.ts';
import { editorTheme } from './editor-theme.ts';
import { noteMarkdownExtensions } from './language.ts';
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
  /**
   * The live document of the open note, bound to this view (record 0082).
   *
   * A bound editor holds no document of its own: the text of the view and the
   * text of the note are one value, and Yjs holds the local undo. A plain
   * editor, which History and a diff use, leaves this absent and keeps the
   * CodeMirror history. `initialText` must state the text the binding holds.
   */
  readonly document?: BoundEditorDocument | undefined;
  /**
   * The text after work that came from the document rather than the person.
   *
   * A remote change and a repair reach a bound editor as a transaction of the
   * binding. They are not input of this device, so they never schedule a save
   * and never enter local undo. The screen reads the new text here.
   */
  readonly onRemoteChange?: ((text: string) => void) | undefined;
};

/** Re-resolution of a link target for keyboard activation. */
function linkAtCursor(view: EditorView): LinkTarget | null {
  const position = view.state.selection.main.head;
  return linkSpanAt(view.state, position)?.target ?? null;
}

/** The theme compartment, so palette changes never rebuild the editor. */
const themeCompartment = new Compartment();

/** The rich preview compartment, so resolver changes never rebuild it. */
const richCompartment = new Compartment();

/** The access compartment, so a loaded role can unlock the same editor. */
const readOnlyCompartment = new Compartment();

/**
 * The live preview half of the editor.
 *
 * Everything that decides how Markdown looks is composed here, in order:
 * the language and its code colors, the decoration layer, and the block
 * widget layer inside its compartment. Other composition (keymaps, search,
 * completion, paste) is added next to this call, never inside it.
 */
export function livePreviewExtensions(
  resolvers: RichWidgetResolvers,
): Extension {
  return [
    noteMarkdownExtensions(),
    livePreview(),
    richCompartment.of(richWidgets(resolvers)),
    highlightActiveLine(),
    EditorView.lineWrapping,
  ];
}

/** The line an empty note shows until the person types. */
export const emptyNoteHint = 'Start writing. Markdown works here.';

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
        view.dispatch(view.state.update(editingTransaction(spec)));
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

  const bound = options.document;
  const state = EditorState.create({
    doc: initialText,
    extensions: [
      // A bound editor takes its undo from Yjs, so the two histories never
      // both answer the same key.
      ...(bound === undefined ? [history()] : [bound.extension]),
      livePreviewExtensions(options.rich ?? {}),
      placeholder(emptyNoteHint),
      themeCompartment.of(editorTheme(options.theme ?? 'dark')),
      saveKeymap,
      editorCommands(),
      keymap.of([
        ...defaultKeymap,
        ...(bound === undefined ? historyKeymap : []),
      ]),
      EditorView.updateListener.of((update: ViewUpdate): void => {
        if (!update.docChanged) return;
        const text = update.state.doc.toString();
        if (bound !== undefined && isRemoteChange(update)) {
          options.onRemoteChange?.(text);
          return;
        }
        onChange(text);
      }),
      EditorView.domEventHandlers({
        // A link opens on a plain click, which is what the pointer over it
        // states, and one tap opens it on a touch screen for the same reason.
        //
        // A link the selection already touches shows its source, so the
        // person is editing that link and the click places the caret instead.
        // The caret reaches a link with an arrow key or with a click beside
        // it, so every link stays editable with no modifier to learn.
        //
        // The main button only, and never with Shift, so a middle click and
        // an extended selection keep their meaning.
        mousedown: (event, view): boolean => {
          if (event.button !== 0 || event.shiftKey) return false;
          const position = view.posAtCoords({
            x: event.clientX,
            y: event.clientY,
          });
          if (position === null || position === undefined) return false;
          const link = linkSpanAt(view.state, position);
          if (link === null) return false;
          const selection = view.state.selection.main;
          if (selection.from <= link.to && selection.to >= link.from)
            return false;
          navigation.onOpenLink?.(link.target);
          event.preventDefault();
          return true;
        },
      }),
      // The content element carries the accessible name. The wrapper around
      // it must not declare a second text box (UI-26, MD-19).
      EditorView.contentAttributes.of({ 'aria-label': 'Note text' }),
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
    effects: themeCompartment.reconfigure(editorTheme(theme)),
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
