/**
 * Where sign-in goes after it succeeds.
 *
 * A screen that needs a session and finds none sends the person to sign-in
 * with the address to come back to in the query. That address comes from the
 * address bar, so anybody can write it into a link. Sign-in therefore goes
 * back only to a path of this origin: a value that names another host, a
 * scheme, or a form that a browser reads as either, goes to the root. Every
 * rule of the return lives here, so the screen holds none of it.
 */
import { queryAddress, queryValue } from './address-query.ts';

/** The path of the sign-in screen. */
export const signInRoute = '/login';

/** The query member of the sign-in address that names the return. */
export const returnParameter = 'next';

/** Where sign-in goes when the return names no safe path. */
const home = '/';

/** Whether one character is a control character of ASCII. */
function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

/**
 * The path that sign-in goes back to, from the raw value of the query.
 *
 * The URL standard reads an address that starts with one slash, and not with
 * a second slash or a backslash, as a path of the current origin. A browser
 * reads a backslash as a slash and drops a tab or a line break, so a value
 * with either could become `//host`, and such a value is refused whole. A
 * path to the sign-in screen itself goes to the root, so a return never
 * loops. Any other value, and no value, answers the root.
 */
export function returnAddress(raw: string | null): string {
  if (raw === null || !raw.startsWith('/')) return home;
  if (raw.includes('\\') || raw.startsWith('//')) return home;
  if (Array.from(raw).some(isControlCharacter)) return home;
  const path = raw.split(/[?#]/, 1)[0] ?? '';
  if (path === signInRoute || path.startsWith(`${signInRoute}/`)) return home;
  return raw;
}

/** The address of sign-in that comes back to `path` after it succeeds. */
export function signInAddress(path: string): string {
  const back = returnAddress(path);
  return back === home
    ? signInRoute
    : queryAddress(signInRoute, returnParameter, back);
}

/** The return that the query of the sign-in address names. */
export function returnOf(search: string): string {
  return returnAddress(queryValue(search, returnParameter));
}
