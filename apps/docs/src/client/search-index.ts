/**
 * Loads the static search index of the site (record 0153).
 *
 * Pagefind writes its script beside the pages, under `pagefind/` of the base
 * path, at the end of the build. It is not a module of this source, so its
 * address is computed here, the one module that `tools/check-boundaries.mjs`
 * lets compute an import, and the script loads only when a person searches.
 *
 * The build stores the full address of each page in the index. Pagefind would
 * put the folder of its own script in front of that address, so the loader
 * names the root as its base, and a result opens the address that the index
 * holds.
 */

/** The address of the search script of a site served under `base`. */
export function indexAddress(base: string): string {
  return `${base}pagefind/pagefind.js`;
}

/** The options that the loader gives the search script. */
export const indexOptions = { baseUrl: '/' } as const;

/** Loads the search script with its options, and answers its module. */
export async function loadIndex(base: string): Promise<unknown> {
  const module: unknown = await import(indexAddress(base));
  const options: unknown = Reflect.get(Object(module), 'options');
  if (typeof options === 'function') await options.call(module, indexOptions);
  return module;
}
