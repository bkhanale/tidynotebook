/**
 * Safe access to browser capabilities that vary by security context.
 *
 * A local-network deployment commonly uses plain HTTP. Such a page can have
 * fewer browser APIs than a loopback or HTTPS page. Application features use
 * these adapters so a missing optional capability cannot stop the workspace.
 */

/** Copies text when the asynchronous Clipboard API is available. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false;
    const clipboard = navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function')
      return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the asynchronous Clipboard API takes pictures on this page.
 *
 * A page served over plain HTTP has no clipboard at all, and an older
 * browser has no `ClipboardItem`. A caller asks first, so it never prepares
 * the bytes of a copy that cannot happen.
 */
export function canCopyImage(): boolean {
  if (typeof navigator === 'undefined') return false;
  const clipboard: Clipboard | undefined = navigator.clipboard;
  return (
    clipboard !== undefined &&
    typeof clipboard.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  );
}

/**
 * Copies one PNG picture when the asynchronous Clipboard API takes pictures.
 *
 * The bytes arrive as a promise, so the write starts inside the press that
 * asked for it. Safari refuses a clipboard write that starts after the press
 * has ended, which is where an awaited canvas encode would put it. A caller
 * asks `canCopyImage` before it starts that promise.
 */
export async function copyPngImage(png: Promise<Blob>): Promise<boolean> {
  try {
    if (!canCopyImage()) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}

/** Reads the system dark-theme preference when media queries are available. */
export function systemPrefersDark(): boolean {
  try {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    )
      return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** Subscribes to system theme changes and returns an idempotent cleanup. */
export function subscribeToSystemTheme(
  listener: (prefersDark: boolean) => void,
): () => void {
  try {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    )
      return () => {};
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void =>
      listener(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  } catch {
    return () => {};
  }
}
