/**
 * The preload of the entry modules, only on a load that no worker controls
 * (record 0180).
 *
 * Vite writes one `modulepreload` link for each module of the entry. On a
 * load that the service worker controls, a preload and the module script both
 * reached the worker for one module, and the browser aborted one of them on a
 * few loads in each thousand. The entry then failed and the page stayed
 * white. The built shell therefore holds the addresses in a small inline
 * script that adds the links only when `navigator.serviceWorker.controller`
 * is empty. The server hashes every inline script of the shell into its
 * content policy, so the script needs no other change.
 */

/** One `modulepreload` link that Vite writes, with its address. */
const preloadLinkPattern =
  /[ \t]*<link rel="modulepreload" crossorigin href="([^"]+)">\r?\n?/g;

/** One link element, as the script of the shell sets it. */
type PreloadLink = { rel: string; crossOrigin: string | null; href: string };

/** What the script of the shell reads of the page. */
export type PreloadPage = {
  readonly navigator: {
    readonly serviceWorker?: { readonly controller: unknown } | undefined;
  };
  readonly document: {
    readonly createElement: (name: 'link') => PreloadLink;
    readonly head: { readonly appendChild: (link: PreloadLink) => unknown };
  };
};

/**
 * Adds the preload links of the entry, unless a worker controls the load.
 *
 * The shell runs the source of this function as its inline script, so it
 * reads nothing but its arguments.
 */
export function addEntryPreloads(
  addresses: readonly string[],
  page: PreloadPage,
): void {
  const worker = page.navigator.serviceWorker;
  if (worker !== undefined && worker.controller !== null) return;
  for (const address of addresses) {
    const link = page.document.createElement('link');
    link.rel = 'modulepreload';
    link.crossOrigin = '';
    link.href = address;
    page.document.head.appendChild(link);
  }
}

/**
 * The shell with its `modulepreload` links moved into a script that adds them
 * only on a load that no worker controls. A shell with no such link stays as
 * it is.
 */
export function preloadOnlyUncontrolled(html: string): string {
  const addresses: string[] = [];
  let first = -1;
  const stripped = html.replace(
    preloadLinkPattern,
    (_link: string, address: string, offset: number) => {
      if (first < 0) first = offset;
      addresses.push(address);
      return '';
    },
  );
  if (addresses.length === 0) return html;
  const script = `    <script>(${addEntryPreloads.toString()})(${JSON.stringify(addresses)}, window);</script>\n`;
  return stripped.slice(0, first) + script + stripped.slice(first);
}
