/**
 * The guide, read as the pages and the contents of the site.
 *
 * `docs/guide/` is the one source of the text (record 0152). Its index page,
 * `README.md`, lists every page in groups, each with a link and a short
 * summary. That list is the sidebar of the site and its order is the order of
 * the previous and the next page, so a new page reaches the site through the
 * one place that a reader of the repository already reads.
 *
 * Every function here reads text and answers data. The build reads the files.
 */
import type { Nodes, Root } from 'mdast';
import { headingSlug, parseMarkdown } from '@notesapp/markdown';

/** The file name of the index page of the guide. */
export const indexFile = 'README.md';

/** The folder of the guide, from the root of the repository. */
export const guideFolder = 'docs/guide';

/** One page that the index lists. */
export type GuideEntry = {
  /** The file name of the page, for example `quickstart.md`. */
  readonly file: string;
  /** The words of the link to the page. */
  readonly title: string;
  /** The words after the link, which state what the page holds. */
  readonly summary: string;
};

/** One group of pages of the index, for example "Writing notes". */
export type GuideGroup = {
  readonly title: string;
  readonly pages: readonly GuideEntry[];
};

/** One heading of a page, with the identifier that the renderer writes. */
export type GuideHeading = {
  readonly depth: number;
  readonly text: string;
  readonly id: string;
};

/** One page of the guide. */
export type GuidePage = {
  readonly file: string;
  /** The address of the page under the base path, `''` for the home page. */
  readonly slug: string;
  /** The text of the one `#` heading. */
  readonly title: string;
  /** The first paragraph, which names the reader of the page. */
  readonly description: string;
  /** The paragraphs between the first one and the first heading. */
  readonly introduction: string;
  /** Every heading under the title, in page order. */
  readonly headings: readonly GuideHeading[];
  /** The Markdown source. */
  readonly source: string;
};

/** The plain text of a node, the way the renderer reads a heading. */
function textOf(node: Nodes): string {
  // A code block, raw HTML and front matter hold no heading text. Every other
  // node with a value is text, inline code or inline math, which the renderer
  // keeps as its source.
  if (node.type === 'code' || node.type === 'html' || node.type === 'yaml')
    return '';
  if ('value' in node) return node.value;
  if ('children' in node)
    return node.children.map((child) => textOf(child)).join('');
  return '';
}

/** One line of text, with each run of white space as one space. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** The address of a page under the base path. */
export function slugOf(file: string): string {
  if (file === indexFile) return '';
  return file.replace(/\.md$/, '');
}

/**
 * Reads the groups of the index.
 *
 * A group is a `##` heading, and its pages are the items of the first list
 * under it. An item is a link to a page of the guide, then a hyphen, then the
 * summary. A list item of another shape is not a page.
 */
export function readGuideIndex(source: string): readonly GuideGroup[] {
  const tree: Root = parseMarkdown(source);
  const groups: { title: string; pages: GuideEntry[] }[] = [];
  let current: { title: string; pages: GuideEntry[] } | null = null;
  for (const node of tree.children) {
    if (node.type === 'heading') {
      current =
        node.depth === 2 ? { title: oneLine(textOf(node)), pages: [] } : null;
      if (current !== null) groups.push(current);
      continue;
    }
    if (node.type !== 'list' || current === null || current.pages.length > 0)
      continue;
    for (const item of node.children) {
      const paragraph = item.children[0];
      if (paragraph?.type !== 'paragraph') continue;
      const [link, ...rest] = paragraph.children;
      if (link?.type !== 'link' || !/^[a-z0-9-]+\.md$/.test(link.url)) continue;
      const summary = oneLine(rest.map((child) => textOf(child)).join(''))
        .replace(/^-\s*/, '')
        .trim();
      current.pages.push({
        file: link.url,
        title: oneLine(textOf(link)),
        summary,
      });
    }
  }
  return groups.filter((group) => group.pages.length > 0);
}

/** The files of the site in reading order: the index, then each group. */
export function readingOrder(groups: readonly GuideGroup[]): readonly string[] {
  return [
    indexFile,
    ...groups.flatMap((group) => group.pages.map((page) => page.file)),
  ];
}

/**
 * States what keeps the index and the folder from being one list.
 *
 * Every page of the folder is in the index once, and every page that the
 * index names is in the folder, so no page is hidden from the sidebar and no
 * row of the sidebar leads nowhere.
 */
export function indexProblems(
  files: readonly string[],
  groups: readonly GuideGroup[],
): readonly string[] {
  const listed = groups.flatMap((group) =>
    group.pages.map((page) => page.file),
  );
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const file of listed) {
    if (seen.has(file))
      problems.push(`${indexFile} lists ${file} more than once.`);
    seen.add(file);
    if (!files.includes(file))
      problems.push(
        `${indexFile} lists ${file}, and ${guideFolder} holds no such page.`,
      );
  }
  for (const file of files)
    if (file !== indexFile && !seen.has(file))
      problems.push(`${guideFolder}/${file} is in no group of ${indexFile}.`);
  return problems;
}

/**
 * Reads one page: its title, its description and its headings.
 *
 * The identifier of a heading follows the rule of `renderMarkdown`: the slug
 * of its text with the `user-content-` namespace, and a number from the second
 * use of one slug on. Every heading counts, in document order, the title and a
 * heading inside a quote or a list as well, because the renderer counts them
 * all. The outline lists the headings of the page itself, not the nested ones.
 */
export function readGuidePage(file: string, source: string): GuidePage {
  const tree: Root = parseMarkdown(source);
  const used = new Map<string, number>();
  const headings: GuideHeading[] = [];
  let title = '';
  const identify = (node: Nodes, top: boolean): void => {
    if (node.type === 'heading') {
      const text = oneLine(textOf(node));
      const base = headingSlug(text);
      if (top && node.depth === 1 && title === '') title = text;
      if (base === '') return;
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      const id = `user-content-${base}${count === 0 ? '' : `-${String(count + 1)}`}`;
      if (top && node.depth > 1) headings.push({ depth: node.depth, text, id });
      return;
    }
    if ('children' in node)
      for (const child of node.children) identify(child, false);
  };
  let description = '';
  const introduction: string[] = [];
  for (const node of tree.children) {
    identify(node, true);
    if (node.type !== 'paragraph') continue;
    if (description === '') description = oneLine(textOf(node));
    else if (headings.length === 0) introduction.push(oneLine(textOf(node)));
  }
  if (title === '') throw new Error(`${guideFolder}/${file} has no # title.`);
  return {
    file,
    slug: slugOf(file),
    title,
    description,
    introduction: introduction.join(' '),
    headings,
    source,
  };
}
