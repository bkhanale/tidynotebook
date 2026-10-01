/**
 * The assets that the site takes from the build of the application.
 *
 * Record 0152 gives the site the one built stylesheet of `apps/web`, as the
 * published page of record 0060 has it, so the site cannot drift from the
 * theme, the face or the scales. This module reads which stylesheet and which
 * icon the built shell document names, and moves the font addresses of that
 * stylesheet under the base path of the site. It reads text and answers text.
 */

/** One element and its attributes, for the few elements read here. */
const linkElement = /<link\b[^>]*>/gi;

/** The value of one attribute of one element, or `null`. */
function attributeOf(element: string, name: string): string | null {
  const found = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*')`, 'i').exec(
    element,
  );
  const quoted = found?.[1];
  return quoted === undefined ? null : quoted.slice(1, -1);
}

/** The built assets that the shell document of the application names. */
export type ShellAssets = {
  /** Each stylesheet, as an address of the application, in order. */
  readonly stylesheets: readonly string[];
  /** The icon of the product, or `null` when the shell names none. */
  readonly icon: string | null;
};

/**
 * Reads the stylesheets and the icon of the built shell document.
 *
 * Only an address of the application itself is read, because the site copies
 * each one into its own folder.
 */
export function shellAssets(html: string): ShellAssets {
  const stylesheets: string[] = [];
  let icon: string | null = null;
  for (const element of html.match(linkElement) ?? []) {
    const relation = (attributeOf(element, 'rel') ?? '').toLowerCase();
    const href = attributeOf(element, 'href');
    if (href === null || !href.startsWith('/assets/') || href.includes('..'))
      continue;
    const relations = relation.split(/\s+/);
    if (relations.includes('stylesheet') && !stylesheets.includes(href))
      stylesheets.push(href);
    else if (relations.includes('icon') && icon === null) icon = href;
  }
  if (stylesheets.length === 0)
    throw new Error(
      'The built shell document names no stylesheet. Run pnpm build first.',
    );
  return { stylesheets, icon };
}

/**
 * Points the font addresses of the stylesheet at the fonts of the site.
 *
 * The application serves its fonts at `/fonts/` of its origin, and the site
 * serves the same files at `fonts/` of its base path, beside `assets/`. An
 * address relative to the stylesheet reaches them under every base path.
 */
export function rebaseFonts(css: string): string {
  return css.replace(/url\((["']?)\/fonts\//g, 'url($1../fonts/');
}
