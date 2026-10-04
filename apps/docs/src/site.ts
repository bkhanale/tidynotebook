/**
 * The settings of one build of the documentation site.
 *
 * The site is a folder of static files (record 0152), so the address it is
 * served from is a fact of the build and not of a server. Two settings carry
 * it: the base path that every address of the site starts with, and the
 * origin that a sitemap, a canonical link and the files for agents name in
 * full. The same build serves `https://docs.bhu.sh/notesapp/` and a folder on
 * a laptop.
 */

/** The name of the product, as every page names it. */
export const productName = 'NotesApp';

/** The name of the site, as a browser tab and a search engine read it. */
export const siteName = `${productName} docs`;

/** The repository that holds the source of the product and of this site. */
export const repositoryUrl = 'https://github.com/tidynotebook/tidynotebook';

/** The branch whose files a link out of the guide opens. */
export const repositoryBranch = 'main';

/** The settings of one build. */
export type SiteSettings = {
  /** The path that every address starts and ends with, for example `/notesapp/`. */
  readonly base: string;
  /** The origin of the site with no path, or `null` when it is not known. */
  readonly origin: string | null;
};

/** The variables that a person sets to build for one address. */
export const settingNames = {
  base: 'NOTESAPP_DOCS_BASE',
  origin: 'NOTESAPP_DOCS_ORIGIN',
} as const;

/** A base path segment: letters, digits, a dot, a hyphen or an underscore. */
const segment = /^[A-Za-z0-9._-]+$/;

/**
 * Reads the settings of a build from its environment.
 *
 * An empty base serves the site at the root. A base names its segments with
 * no `..` and no query, and it gains its two slashes here, so `notesapp`,
 * `/notesapp` and `/notesapp/` are one setting. An origin is an `https`
 * address with no path, or an `http` address of the loopback host. A value
 * that breaks a rule stops the build with a message that names the variable.
 */
export function readSiteSettings(
  environment: Readonly<Record<string, string | undefined>>,
): SiteSettings {
  const rawBase = (environment[settingNames.base] ?? '').trim();
  const parts = rawBase.split('/').filter((part) => part !== '');
  for (const part of parts)
    if (!segment.test(part) || part === '.' || part === '..')
      throw new Error(
        `${settingNames.base} must be a path such as /notesapp/. "${rawBase}" holds "${part}".`,
      );
  const base = parts.length === 0 ? '/' : `/${parts.join('/')}/`;
  const rawOrigin = (environment[settingNames.origin] ?? '').trim();
  if (rawOrigin === '') return { base, origin: null };
  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new Error(
      `${settingNames.origin} must be an origin such as https://docs.example.com.`,
    );
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  )
    throw new Error(
      `${settingNames.origin} must be an https origin with no path, such as https://docs.example.com.`,
    );
  return { base, origin: url.origin };
}

/** The address of a path of the site, in full when the origin is known. */
export function absoluteAddress(settings: SiteSettings, path: string): string {
  return settings.origin === null ? path : `${settings.origin}${path}`;
}
