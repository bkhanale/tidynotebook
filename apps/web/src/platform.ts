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
