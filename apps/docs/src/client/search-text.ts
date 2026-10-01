/**
 * The pure rules of the client script of the documentation site.
 *
 * The client script runs in the browser of the reader with no bundler, so it
 * imports only the modules of this folder. Every rule that decides what a
 * person sees lives here, where a unit test reaches it, and the script holds
 * the effects.
 */

/** One run of the text of an excerpt, and whether the search matched it. */
export type ExcerptPart = {
  readonly text: string;
  readonly marked: boolean;
};

/** The entities that the search index writes into an excerpt. */
const entities: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

/** Text with the entities of an excerpt read back into characters. */
function decode(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (entity) => {
    return entities[entity] ?? entity;
  });
}

/**
 * Splits the excerpt of a result into text and marked text.
 *
 * Pagefind marks each matched word with a `mark` element and escapes the rest.
 * The script writes each part as a text node, so no markup of the index ever
 * reaches the page, and any other element is dropped with its tags.
 */
export function excerptParts(excerpt: string): readonly ExcerptPart[] {
  const parts: ExcerptPart[] = [];
  let marked = false;
  for (const piece of excerpt.split(/(<\/?mark>)/i)) {
    const tag = piece.toLowerCase();
    if (tag === '<mark>') {
      marked = true;
      continue;
    }
    if (tag === '</mark>') {
      marked = false;
      continue;
    }
    const text = decode(piece.replace(/<[^>]*>/g, ''));
    if (text === '') continue;
    const last = parts.at(-1);
    if (last !== undefined && last.marked === marked)
      parts[parts.length - 1] = { text: `${last.text}${text}`, marked };
    else parts.push({ text, marked });
  }
  return parts;
}

/** The sentence under the field that states what the search found. */
export function resultSentence(query: string, count: number): string {
  if (query.trim() === '') return '';
  if (count === 0) return 'No page matches this search. Try another word.';
  return count === 1 ? '1 result' : `${String(count)} results`;
}

/** The keys that a press holds, as the script reads them. */
export type KeyPress = {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  /** Whether the focus is in a field where the key types text. */
  readonly inField: boolean;
};

/**
 * Whether a key press opens the search.
 *
 * Control and K, or Command and K on a Mac, open it from everywhere. The
 * slash opens it when the focus is not in a field, where it types a slash.
 */
export function opensSearch(press: KeyPress): boolean {
  if (press.altKey) return false;
  if (press.key.toLowerCase() === 'k') return press.ctrlKey || press.metaKey;
  return (
    press.key === '/' && !press.ctrlKey && !press.metaKey && !press.inField
  );
}

/** The next result to focus for an arrow key, or `null` to stay. */
export function nextResult(
  key: string,
  current: number | null,
  count: number,
): number | null {
  if (count === 0) return null;
  if (key === 'ArrowDown')
    return current === null ? 0 : Math.min(current + 1, count - 1);
  if (key === 'ArrowUp')
    return current === null || current === 0 ? null : current - 1;
  return current;
}

/** The title of a result: the page, and the section when it is another. */
export function resultTitle(page: string, section: string): string {
  const trimmed = section.trim();
  return trimmed === '' || trimmed === page ? page : `${page}: ${trimmed}`;
}
