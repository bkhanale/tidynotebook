/**
 * Loads the static search index of the site (record 0153).
 *
 * Pagefind writes its script beside the pages, under `pagefind/` of the base
 * path, at the end of the build. It is not a module of this source, so its
 * address is computed here, the one module that `tools/check-boundaries.mjs`
 * lets compute an import, and the script loads only when a person searches.
 */

/** The address of the search script of a site served under `base`. */
export function indexAddress(base: string): string {
  return `${base}pagefind/pagefind.js`;
}

/** Loads the search script, and answers its module. */
export function loadIndex(base: string): Promise<unknown> {
  return import(indexAddress(base)).then((module: unknown) => module);
}
