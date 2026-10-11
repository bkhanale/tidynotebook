/**
 * The address of every link of the site.
 *
 * A guide page links another guide page by its file name, the way GitHub and
 * an editor read it. On the site that link becomes the address of the page,
 * and in the Markdown copy for agents it becomes the address of that copy. A
 * link out of the guide, for example to `SECURITY.md`, names a file that the
 * site does not serve, so it opens that file on GitHub.
 */
import type { NoteTarget } from '@notesapp/markdown';
import { guideFolder, slugOf } from './guide.ts';
import {
  absoluteAddress,
  repositoryBranch,
  repositoryUrl,
  type SiteSettings,
} from './site.ts';

/** The namespace that the renderer gives each heading identifier. */
const headingNamespace = '#user-content-';

/** The contract source also opens its generated reference on the site. */
export const apiContractSource = 'packages/api-contract/openapi.yaml';

/** The client generator's bundled contract and its downloadable address. */
export const apiDocumentFile =
  'packages/api-contract/src/generated/openapi.json';
export const apiDownload = 'api/openapi.json';

/** The address of one page, with a fragment when one is given. */
export function pageHref(
  settings: SiteSettings,
  slug: string,
  fragment = '',
): string {
  return `${settings.base}${slug === '' ? '' : `${slug}/`}${fragment}`;
}

/** The address of the Markdown copy of one page. */
export function markdownHref(settings: SiteSettings, slug: string): string {
  return `${settings.base}${slug === '' ? 'index' : slug}.md`;
}

/** The address of one file of the repository on GitHub. */
export function repositoryHref(path: string, fragment = ''): string {
  return `${repositoryUrl}/blob/${repositoryBranch}/${path}${fragment}`;
}

/** The address that edits the source of one guide page on GitHub. */
export function editHref(file: string): string {
  return `${repositoryUrl}/edit/${repositoryBranch}/${guideFolder}/${file}`;
}

/** The file name of a guide page, or `null` for a path outside the guide. */
export function guideFileOf(path: string): string | null {
  const prefix = `${guideFolder}/`;
  if (!path.startsWith(prefix)) return null;
  const file = path.slice(prefix.length);
  return file.includes('/') ? null : file;
}

/** States that a link names a guide page that does not exist. */
function deadLink(path: string): Error {
  return new Error(
    `A guide page links ${path}, and the guide has no such page.`,
  );
}

/**
 * The address of a link on a page of the site.
 *
 * `renderMarkdown` passes every relative link through this resolver. The
 * fragment arrives in the namespace of the renderer, which is the identifier
 * that a heading of the site carries, so it stays as it is. GitHub writes the
 * bare slug, so a link out of the guide loses the namespace. A link out of the
 * guide must name a file that `inRepository` knows, so a typo stops the build
 * instead of becoming an address that GitHub does not answer.
 */
export function htmlDestination(
  settings: SiteSettings,
  files: ReadonlySet<string>,
  target: NoteTarget,
  inRepository: (path: string) => boolean = () => true,
): string | null {
  if (target.path === null) return null;
  if (target.path === apiContractSource)
    return pageHref(settings, 'api-reference', target.fragment);
  if (target.path === apiDocumentFile) return `${settings.base}${apiDownload}`;
  const file = guideFileOf(target.path);
  if (file === null && !inRepository(target.path))
    throw new Error(
      `A guide page links ${target.path}, and the repository has no such file.`,
    );
  if (file === null)
    return repositoryHref(
      target.path,
      target.fragment.startsWith(headingNamespace)
        ? `#${target.fragment.slice(headingNamespace.length)}`
        : target.fragment,
    );
  if (!files.has(file)) throw deadLink(target.path);
  return pageHref(settings, slugOf(file), target.fragment);
}

/**
 * The address of a link in the Markdown copy of a page.
 *
 * An agent that reads one copy follows a link to the next copy, so a guide
 * page links the Markdown copy of the other page, in full when the origin of
 * the site is known.
 */
export function markdownDestination(
  settings: SiteSettings,
  files: ReadonlySet<string>,
  path: string,
  fragment: string,
): string {
  if (path === apiContractSource)
    return absoluteAddress(settings, markdownHref(settings, 'api-reference'));
  if (path === apiDocumentFile)
    return absoluteAddress(settings, `${settings.base}${apiDownload}`);
  const file = guideFileOf(path);
  if (file === null) return repositoryHref(path, fragment);
  if (!files.has(file)) throw deadLink(path);
  return `${absoluteAddress(settings, markdownHref(settings, slugOf(file)))}${fragment}`;
}
