/**
 * What the note screen does with one activated Markdown link.
 *
 * The editor reports the raw destination that the author wrote. This module
 * turns that text into one decision and nothing else: it opens no window, it
 * navigates nowhere, and it reads no storage. The note screen performs the
 * decision, so the rule stays testable without a browser.
 *
 * Only `http:`, `https:`, and `mailto:` may leave the application. Every
 * other scheme, and a protocol relative destination, is refused, because a
 * note is author supplied text.
 */

/** The one action that an activated link destination asks for. */
export type LinkAction =
  /** Open the note with this identifier. */
  | { readonly kind: 'note-id'; readonly fileId: string }
  /** Open the note that carries this name, once the name is resolved. */
  | { readonly kind: 'note-name'; readonly name: string }
  /** Open this address in a new tab. */
  | { readonly kind: 'external'; readonly url: string }
  /** Do nothing: the destination names no reachable target. */
  | { readonly kind: 'none' };

const noAction: LinkAction = { kind: 'none' };

/** The only schemes that may leave the application. */
const allowedScheme = /^(?:https?|mailto):/i;

/** Any scheme at the start of a destination. */
const anyScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** The storage suffix that a written note path may carry. */
const markdownSuffix = '.md';

/**
 * Reports whether the text holds a control character.
 *
 * A control character can hide a scheme from a reader, for example a tab
 * inside `java<tab>script:`, so a destination that holds one is refused.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Decides what one activated link destination asks the application to do.
 *
 * `/notes/<id>` opens that note. An allowed absolute address opens in a new
 * tab. A relative destination names another note by its name, with the `.md`
 * storage suffix removed. Everything else asks for nothing.
 */
export function resolveLinkAction(destination: string): LinkAction {
  const url = destination.trim();
  if (url === '' || hasControlCharacter(url) || url.startsWith('//'))
    return noAction;
  if (url.startsWith('/notes/')) {
    const id = url.slice('/notes/'.length).split(/[/?#]/)[0] ?? '';
    return id === '' ? noAction : { kind: 'note-id', fileId: id };
  }
  if (allowedScheme.test(url)) return { kind: 'external', url };
  if (anyScheme.test(url)) return noAction;
  // A remaining absolute path or a bare fragment names no note.
  if (url.startsWith('/') || url.startsWith('#')) return noAction;
  const name = url.split(/[?#]/)[0] ?? '';
  const trimmed = name.toLowerCase().endsWith(markdownSuffix)
    ? name.slice(0, -markdownSuffix.length)
    : name;
  return trimmed === '' ? noAction : { kind: 'note-name', name: trimmed };
}

/** The copy shown when a written note name matches no note. */
export const missingNoteNotice = 'No note has that name yet.';
