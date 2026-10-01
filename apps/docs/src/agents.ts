/**
 * The files of the site that an agent and a search engine read.
 *
 * Record 0153 gives the site three of them, all from the same guide as the
 * pages: `llms.txt`, the index of the `llms.txt` proposal with a link and one
 * sentence for each page in the order of the contents, `llms-full.txt`, every
 * page in that order in one file, and `sitemap.xml`. Each page also has a
 * Markdown copy at its address with `.md` added, whose links name the other
 * copies, so an agent moves from copy to copy.
 */
import { mapRelativeReferences } from '@notesapp/markdown';
import {
  guideFolder,
  slugOf,
  type GuideGroup,
  type GuidePage,
} from './guide.ts';
import { markdownDestination, markdownHref, pageHref } from './links.ts';
import { absoluteAddress, siteName, type SiteSettings } from './site.ts';

/** The Markdown copy of one page, with the links of the site. */
export function markdownCopy(
  settings: SiteSettings,
  files: ReadonlySet<string>,
  page: GuidePage,
): string {
  const { text } = mapRelativeReferences(
    page.source,
    `${guideFolder}/${page.file}`,
    (path, fragment) => markdownDestination(settings, files, path, fragment),
  );
  return text.endsWith('\n') ? text : `${text}\n`;
}

/** A sentence that starts with a capital and ends with a full stop. */
function sentence(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return trimmed;
  const capital = `${trimmed[0]?.toUpperCase() ?? ''}${trimmed.slice(1)}`;
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/**
 * The `llms.txt` index of the site.
 *
 * The title is the name of the site and the quote is the introduction of the
 * home page. Each group of the contents is a section, and each page is a link
 * to its Markdown copy with the summary that the index of the guide gives it.
 */
export function llmsIndex(
  settings: SiteSettings,
  groups: readonly GuideGroup[],
  home: GuidePage,
): string {
  const address = (path: string): string => absoluteAddress(settings, path);
  const lines = [
    `# ${siteName}`,
    '',
    `> ${home.introduction === '' ? home.description : home.introduction}`,
    '',
    `Each link opens the Markdown copy of one page. Every page in one file: ${address(`${settings.base}llms-full.txt`)}. The pages for people start at ${address(pageHref(settings, ''))}.`,
  ];
  for (const group of groups) {
    lines.push('', `## ${group.title}`, '');
    for (const entry of group.pages)
      lines.push(
        `- [${entry.title}](${address(markdownHref(settings, slugOf(entry.file)))}): ${sentence(entry.summary)}`,
      );
  }
  return `${lines.join('\n')}\n`;
}

/** Every page in reading order, in one Markdown file. */
export function llmsFull(
  settings: SiteSettings,
  files: ReadonlySet<string>,
  pages: readonly GuidePage[],
): string {
  return pages
    .map((page) => {
      const address = absoluteAddress(settings, pageHref(settings, page.slug));
      return `<!-- ${address} -->\n\n${markdownCopy(settings, files, page).trim()}\n`;
    })
    .join('\n');
}

/** Text inside an XML element. */
function xmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** The sitemap of the site, or `null` when the origin is not known. */
export function sitemap(
  settings: SiteSettings,
  pages: readonly GuidePage[],
): string | null {
  if (settings.origin === null) return null;
  const urls = pages.map(
    (page) =>
      `  <url><loc>${xmlText(absoluteAddress(settings, pageHref(settings, page.slug)))}</loc></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/** The `robots.txt` of the site, which names the sitemap when it exists. */
export function robots(settings: SiteSettings): string {
  const lines = ['User-agent: *', 'Allow: /'];
  if (settings.origin !== null)
    lines.push(
      `Sitemap: ${absoluteAddress(settings, `${settings.base}sitemap.xml`)}`,
    );
  return `${lines.join('\n')}\n`;
}
