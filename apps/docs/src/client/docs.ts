/**
 * The one client script of the documentation site.
 *
 * A page reads in full with no script. This script adds the four things that
 * need one: the search dialog over the static index of record 0153, the
 * contents on a phone, the control that copies a page as Markdown, and the
 * control that copies a code block. Every rule it follows lives in
 * `./search-text.ts`, and every class it draws comes from a template that the
 * build wrote from the recipes of `packages/ui`, so the script names no class
 * of its own beyond the attribute that opens the contents.
 *
 * The script writes text as text. A result of the search reaches the page
 * through text nodes and `mark` elements only, never through markup.
 */
import {
  excerptParts,
  nextResult,
  opensSearch,
  resultSentence,
  resultTitle,
} from './search-text.ts';
import { loadIndex } from './search-index.ts';

/** How long a copy control states that it copied, in milliseconds. */
const copiedFor = 2000;

/** How long the search waits for the next key before it runs, in milliseconds. */
const searchPause = 120;

/** The most results that the dialog lists. */
const resultLimit = 8;

/** One element of the page by its data attribute, or `null`. */
function element(attribute: string): HTMLElement | null {
  const found = document.querySelector(`[${attribute}]`);
  return found instanceof HTMLElement ? found : null;
}

/** The base path of the site, which the body states. */
const base = document.body.dataset['docsBase'] ?? '/';

/** Whether a key press types into the element that has the focus. */
function typesText(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Shows that a copy control copied, then puts its words back. */
function confirmCopy(control: HTMLElement): void {
  const copied = control.dataset['docsCopied'] ?? '';
  const label = control.querySelector('[data-docs-copy-label]');
  if (!(label instanceof HTMLElement)) return;
  const words = label.dataset['docsWords'] ?? label.textContent;
  label.dataset['docsWords'] = words;
  label.textContent = copied;
  const previous = Number(control.dataset['docsTimer'] ?? '0');
  window.clearTimeout(previous);
  control.dataset['docsTimer'] = String(
    window.setTimeout(() => {
      label.textContent = words;
    }, copiedFor),
  );
}

/** The contents of the site on a phone. */
function contents(): void {
  const button = element('data-docs-menu');
  const panel = element('data-docs-contents');
  if (button === null || panel === null) return;
  const openWords = button.getAttribute('aria-label') ?? '';
  const closeWords = button.dataset['docsCloseLabel'] ?? openWords;
  const set = (open: boolean): void => {
    panel.toggleAttribute('data-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? closeWords : openWords);
    button.setAttribute('title', open ? closeWords : openWords);
  };
  button.addEventListener('click', () => {
    set(!panel.hasAttribute('data-open'));
  });
  panel.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a') !== null)
      set(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel.hasAttribute('data-open')) {
      set(false);
      button.focus();
    }
  });
}

/** One result of the search index, read from the data it answers. */
type Result = { url: string; title: string; excerpt: string };

/** Reads a string field of an unknown record. */
function text(value: unknown, name: string): string {
  if (typeof value !== 'object' || value === null) return '';
  const field: unknown = Reflect.get(value, name);
  return typeof field === 'string' ? field : '';
}

/**
 * Reads one result of Pagefind: the first section that matched, or the page.
 *
 * The data of a result is the shape of the Pagefind API, read field by field,
 * so an index of another shape answers nothing rather than a broken row.
 */
async function readResult(entry: unknown): Promise<Result | null> {
  if (typeof entry !== 'object' || entry === null) return null;
  const data: unknown = Reflect.get(entry, 'data');
  if (typeof data !== 'function') return null;
  const value: unknown = await data.call(entry);
  const page = text(Reflect.get(Object(value), 'meta'), 'title');
  const sections: unknown = Reflect.get(Object(value), 'sub_results');
  const first: unknown = Array.isArray(sections) ? sections[0] : undefined;
  const url = text(first, 'url') || text(value, 'url');
  if (url === '') return null;
  return {
    url,
    title: resultTitle(page, text(first, 'title')),
    excerpt: text(first, 'excerpt') || text(value, 'excerpt'),
  };
}

/** The search dialog over the static index. */
function search(): void {
  const dialog = document.querySelector('[data-docs-search-dialog]');
  const field = document.querySelector('[data-docs-search-field]');
  const form = element('data-docs-search-form');
  const list = element('data-docs-search-results');
  const status = element('data-docs-search-status');
  const template = document.querySelector('[data-docs-search-result]');
  if (
    !(dialog instanceof HTMLDialogElement) ||
    !(field instanceof HTMLInputElement) ||
    !(template instanceof HTMLTemplateElement) ||
    form === null ||
    list === null ||
    status === null
  )
    return;
  let engine: Promise<unknown> | null = null;
  let generation = 0;
  let timer = 0;
  const load = (): Promise<unknown> => {
    engine ??= loadIndex(base);
    return engine;
  };
  const links = (): HTMLAnchorElement[] =>
    Array.from(list.querySelectorAll('a'));
  const show = (results: readonly Result[], query: string): void => {
    list.replaceChildren(
      ...results.map((result) => {
        const row = template.content.cloneNode(true);
        if (!(row instanceof DocumentFragment)) return document.createElement('li');
        const link = row.querySelector('a');
        const title = row.querySelector('[data-docs-result-title]');
        const excerpt = row.querySelector('[data-docs-result-excerpt]');
        if (link !== null) link.href = result.url;
        if (title !== null) title.textContent = result.title;
        if (excerpt !== null)
          excerpt.replaceChildren(
            ...excerptParts(result.excerpt).map((part) => {
              if (!part.marked) return document.createTextNode(part.text);
              const mark = document.createElement('mark');
              mark.textContent = part.text;
              return mark;
            }),
          );
        return row;
      }),
    );
    status.textContent = resultSentence(query, results.length);
  };
  const run = async (query: string): Promise<void> => {
    const turn = ++generation;
    if (query.trim() === '') {
      show([], query);
      return;
    }
    const module = await load();
    const find: unknown = Reflect.get(Object(module), 'search');
    if (typeof find !== 'function') return;
    const answer: unknown = await find.call(module, query);
    const entries: unknown = Reflect.get(Object(answer), 'results');
    const found = Array.isArray(entries) ? entries.slice(0, resultLimit) : [];
    const results = (await Promise.all(found.map(readResult))).filter(
      (result): result is Result => result !== null,
    );
    if (turn === generation) show(results, query);
  };
  const open = (): void => {
    if (dialog.open) return;
    dialog.showModal();
    field.select();
    void load();
  };
  for (const trigger of document.querySelectorAll('[data-docs-search]'))
    trigger.addEventListener('click', open);
  element('data-docs-search-close')?.addEventListener('click', () => {
    dialog.close();
  });
  dialog.addEventListener('click', (event) => {
    const panel = element('data-docs-search-panel');
    if (event.target instanceof Node && panel !== null && !panel.contains(event.target))
      dialog.close();
  });
  field.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void run(field.value);
    }, searchPause);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    links()[0]?.click();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = links();
    const at = rows.findIndex((row) => row === document.activeElement);
    const next = nextResult(event.key, at === -1 ? null : at, rows.length);
    event.preventDefault();
    if (next === null) field.focus();
    else rows[next]?.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (dialog.open) return;
    if (
      opensSearch({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        inField: typesText(event.target),
      })
    ) {
      event.preventDefault();
      open();
    }
  });
}

/**
 * The control that copies the whole page as Markdown.
 *
 * The page holds its own Markdown copy in a template, so the copy needs no
 * request and the text is exactly the file that `View as Markdown` opens.
 */
function copyPage(): void {
  const control = element('data-docs-copy-page');
  const source = document.querySelector('[data-docs-markdown]');
  if (control === null || !(source instanceof HTMLTemplateElement)) return;
  control.addEventListener('click', () => {
    void navigator.clipboard
      .writeText(source.content.textContent)
      .then(() => {
        confirmCopy(control);
      });
  });
}

/** A copy control on every code block of the text. */
function copyCode(): void {
  const template = document.querySelector('[data-docs-code-copy]');
  if (!(template instanceof HTMLTemplateElement)) return;
  for (const block of document.querySelectorAll('article pre')) {
    const layer = template.content.firstElementChild?.cloneNode(true);
    if (!(layer instanceof HTMLElement)) continue;
    block.replaceWith(layer);
    layer.prepend(block);
    const control = layer.querySelector('[data-docs-copy-code]');
    if (!(control instanceof HTMLElement)) continue;
    control.addEventListener('click', () => {
      void navigator.clipboard
        .writeText((block.textContent ?? '').replace(/\n$/, ''))
        .then(() => {
          confirmCopy(control);
        });
    });
  }
}

contents();
search();
copyPage();
copyCode();
