/**
 * The find and replace panel of the note editor (issue 247).
 *
 * `@codemirror/search` draws a panel of its own, with lowercase words, grey
 * native buttons and a raw close mark. Its documented `createPanel` option
 * takes a panel of ours instead, so this module builds the panel from the
 * recipes of `packages/ui`: two fields, the buttons, three checkboxes and a
 * close action with the close glyph of the icon set. The words are sentence
 * case and say what each control does.
 *
 * The keys stay the keys of the search package. Enter in the find field finds
 * the next match and Shift and Enter the one before it, Enter in the replace
 * field replaces the next match, and the keys of `searchKeymap` that the
 * panel shares with the editor, Escape among them, run through
 * `runScopeHandlers` as they do in the panel of the package.
 *
 * `editor-theme.ts` places the controls in one band, because CodeMirror
 * places the panel itself. Every class of a control is a recipe.
 */
import {
  closeSearchPanel,
  findNext,
  gotoLine,
  searchKeymap,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from '@codemirror/search';
import {
  EditorView,
  runScopeHandlers,
  type Panel,
  type ViewUpdate,
} from '@codemirror/view';
import {
  buttonClassName,
  checkboxClassNames,
  checkParts,
  closeParts,
  compactButtonVisualClassName,
  fieldClassName,
  glyph,
} from '@notesapp/ui';

/** The words of the panel, which a person reads and hears. */
export const searchPanelWords = {
  panel: 'Find and replace',
  find: 'Find',
  replace: 'Replace with',
  next: 'Next',
  previous: 'Previous',
  selectAll: 'Select all',
  replaceOne: 'Replace',
  replaceAll: 'Replace all',
  matchCase: 'Match case',
  regexp: 'Regular expression',
  wholeWord: 'Whole word',
  close: 'Close',
} as const;

/**
 * The words of the parts of CodeMirror that a person hears.
 *
 * The search package announces a match and a replace, and the completion
 * list names itself, in words of its own. These are the same messages in
 * sentence case (issue 247).
 */
export const editorPhrases: Readonly<Record<string, string>> = {
  'current match': 'Current match',
  'on line': 'on line',
  'replaced match on line $': 'Replaced the match on line $',
  'replaced $ matches': 'Replaced $ matches',
  Completions: 'Suggestions',
};

/**
 * The keys of the search package that the note editor keeps.
 *
 * A note has no line numbers, so the key that goes to a line number, and the
 * stock dialog that it opens, have no place in it.
 */
export const noteSearchKeymap = searchKeymap.filter(
  (binding) => binding.run !== gotoLine,
);

/** The class of the glyph inside a control: the 16 px of a control. */
const glyphClass = 'size-4 shrink-0';

/** A text field of the panel. */
function field(label: string, value: string): HTMLInputElement {
  const input = document.createElement('input');
  input.className = fieldClassName();
  input.type = 'text';
  input.value = value;
  input.placeholder = label;
  input.setAttribute('aria-label', label);
  input.spellcheck = false;
  input.autocomplete = 'off';
  return input;
}

/** A button of the panel with its word. */
function button(label: string, run: () => void): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = buttonClassName({ variant: 'secondary', size: 'sm' });
  control.textContent = label;
  control.addEventListener('click', run);
  return control;
}

/** A checkbox of the panel with its label beside it. */
function checkbox(
  label: string,
  checked: boolean,
  change: () => void,
): { readonly element: HTMLLabelElement; readonly input: HTMLInputElement } {
  const classes = checkboxClassNames();
  const element = document.createElement('label');
  element.className = classes.label;
  const frame = document.createElement('span');
  frame.className = classes.frame;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = classes.box;
  input.checked = checked;
  input.addEventListener('change', change);
  frame.append(input, glyph(classes.mark, checkParts));
  const words = document.createElement('span');
  words.textContent = label;
  element.append(frame, words);
  return { element, input };
}

/** One band of the panel. */
function band(...children: readonly HTMLElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'cm-np-search-row';
  row.append(...children);
  return row;
}

/** The find and replace panel of one view. */
class SearchPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  private readonly view: EditorView;
  private query: SearchQuery;
  private readonly searchField: HTMLInputElement;
  private readonly replaceField: HTMLInputElement;
  private readonly caseField: HTMLInputElement;
  private readonly regexpField: HTMLInputElement;
  private readonly wordField: HTMLInputElement;

  constructor(view: EditorView) {
    this.view = view;
    this.query = getSearchQuery(view.state);
    const commit = (): void => {
      this.commit();
    };
    this.searchField = field(searchPanelWords.find, this.query.search);
    // `openSearchPanel` of the package selects the field with this mark.
    this.searchField.setAttribute('main-field', 'true');
    this.searchField.classList.add('cm-np-search-field');
    this.replaceField = field(searchPanelWords.replace, this.query.replace);
    this.replaceField.classList.add('cm-np-search-field');
    for (const input of [this.searchField, this.replaceField]) {
      input.addEventListener('input', commit);
      input.addEventListener('change', commit);
    }
    const matchCase = checkbox(
      searchPanelWords.matchCase,
      this.query.caseSensitive,
      commit,
    );
    const regexp = checkbox(searchPanelWords.regexp, this.query.regexp, commit);
    const wholeWord = checkbox(
      searchPanelWords.wholeWord,
      this.query.wholeWord,
      commit,
    );
    this.caseField = matchCase.input;
    this.regexpField = regexp.input;
    this.wordField = wholeWord.input;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = buttonClassName({
      variant: 'ghost',
      size: 'sm',
      iconOnly: true,
      compact: true,
    });
    close.setAttribute('aria-label', searchPanelWords.close);
    close.title = searchPanelWords.close;
    const closeSurface = document.createElement('span');
    closeSurface.className = compactButtonVisualClassName({
      variant: 'ghost',
      size: 'sm',
      iconOnly: true,
    });
    closeSurface.append(glyph(glyphClass, closeParts));
    close.append(closeSurface);
    close.addEventListener('click', () => {
      closeSearchPanel(view);
    });

    const rows = [
      band(
        this.searchField,
        button(searchPanelWords.previous, () => {
          findPrevious(view);
        }),
        button(searchPanelWords.next, () => {
          findNext(view);
        }),
        button(searchPanelWords.selectAll, () => {
          selectMatches(view);
        }),
        close,
      ),
    ];
    if (!view.state.readOnly)
      rows.push(
        band(
          this.replaceField,
          button(searchPanelWords.replaceOne, () => {
            replaceNext(view);
          }),
          button(searchPanelWords.replaceAll, () => {
            replaceAll(view);
          }),
        ),
      );
    rows.push(band(matchCase.element, regexp.element, wholeWord.element));

    this.dom = document.createElement('div');
    this.dom.className = 'cm-np-search';
    this.dom.setAttribute('role', 'search');
    this.dom.setAttribute('aria-label', searchPanelWords.panel);
    this.dom.append(...rows);
    this.dom.addEventListener('keydown', (event) => {
      this.keydown(event);
    });
  }

  /** States the query of the fields to the editor, when it changed. */
  private commit(): void {
    const query = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: this.caseField.checked,
      regexp: this.regexpField.checked,
      wholeWord: this.wordField.checked,
      replace: this.replaceField.value,
    });
    if (query.eq(this.query)) return;
    this.query = query;
    this.view.dispatch({ effects: setSearchQuery.of(query) });
  }

  /** The keys of the panel, as the panel of the package reads them. */
  private keydown(event: KeyboardEvent): void {
    if (runScopeHandlers(this.view, event, 'search-panel')) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Enter') return;
    if (event.target === this.searchField) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(this.view);
    } else if (event.target === this.replaceField) {
      event.preventDefault();
      replaceNext(this.view);
    }
  }

  update(update: ViewUpdate): void {
    for (const transaction of update.transactions)
      for (const effect of transaction.effects)
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query))
          this.setQuery(effect.value);
  }

  /** Shows a query that the editor set, for example from the selection. */
  private setQuery(query: SearchQuery): void {
    this.query = query;
    this.searchField.value = query.search;
    this.replaceField.value = query.replace;
    this.caseField.checked = query.caseSensitive;
    this.regexpField.checked = query.regexp;
    this.wordField.checked = query.wholeWord;
  }

  mount(): void {
    this.searchField.select();
  }
}

/** The panel of `search({ createPanel })`. */
export function createSearchPanel(view: EditorView): Panel {
  return new SearchPanel(view);
}
