/**
 * Wiki links of other tools, as standard links (record 0172).
 *
 * Record 0004 stores a link between notes as a standard Markdown link, and no
 * surface reads the wiki form `[[Note]]`. A note from Obsidian, or a page
 * pasted from one, holds that form all the same. This module is the one
 * converter: the import of an archive, a paste and the editor call it at the
 * moment the text enters a note, and it writes a standard link for every wiki
 * link whose target resolves. A target that does not resolve keeps its text,
 * so no link ever names a note that is not there and no word is lost.
 *
 * The converter reads the parse tree, so a `[[` inside code, inside math,
 * inside HTML, inside a link and behind a backslash stays as it is. It writes
 * the forms of Obsidian:
 *
 * - `[[Note]]` and `[[folder/Note]]` as a link with the name as its label;
 * - `[[Note|label]]`, also as `[[Note\|label]]` in a table, with its label;
 * - `[[Note#Heading]]` with the fragment of the heading, `[[#Heading]]` as a
 *   link inside the note, and `[[Note#^block]]` as a link to the note;
 * - `![[image.png]]` as a picture, and `![[Note]]` as a link, because no
 *   surface draws one note inside another.
 *
 * `wikiLinkResolver` resolves a target the way Obsidian does, from a list of
 * the paths of a workspace or of an archive. Nothing here reads a store.
 */
import type { Nodes } from 'mdast';
import { visit } from 'unist-util-visit';
import { headingSlug } from './heading-slug.ts';
import { parseMarkdown } from './parse.ts';
import { portableRelativePath } from './rewrite.ts';

/** Resolves the target of one wiki link from one note, or answers `null`. */
export type WikiResolver = (
  target: string,
  sourcePath: string,
) => string | null;

/** The text of a note after its conversion, and how many links it took. */
export type WikiConversion = {
  readonly text: string;
  readonly count: number;
};

/**
 * The characters that a label escapes.
 *
 * Each one would open or close a construct inside the label: a link, a code
 * span, emphasis, a strike, math, HTML or an autolink, or a cell of a table.
 */
const labelSyntax = /([\\`*_[\]<$|~])/g;

/** An ampersand that starts an entity, which the label keeps as text. */
const entityStart = /&(?=#?[A-Za-z0-9]+;)/g;

/**
 * The label of a link, escaped, so it reads as the text it holds.
 *
 * A note named `C# [draft]` gives `C# \[draft\]`, which is one link whose
 * text is the name. An escape stands only where it changes the meaning, so a
 * label reads like the name in any other Markdown tool too.
 */
export function noteLinkLabel(text: string): string {
  return text.replace(labelSyntax, '\\$1').replace(entityStart, '\\&');
}

/**
 * One standard link from the note at `sourcePath` to `targetPath`.
 *
 * The destination is the portable relative path of `./rewrite.ts`, which
 * every link between notes holds, with the fragment after it.
 */
export function standardNoteLink(
  sourcePath: string,
  targetPath: string,
  label: string,
  fragment = '',
): string {
  return `[${noteLinkLabel(label)}](${portableRelativePath(sourcePath, targetPath)}${fragment})`;
}

/** The folder segments of a stored path. */
function folderOf(path: string): readonly string[] {
  const parts = path.split('/');
  parts.pop();
  return parts;
}

/** A path joined to a folder, with `.` and `..` resolved, or `null`. */
function joined(folder: readonly string[], path: string): string | null {
  const parts = [...folder];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length === 0 ? null : parts.join('/');
}

/** The last segment of a stored path. */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The number of segments of a path. */
function depthOf(path: string): number {
  return path.split('/').length;
}

/**
 * The one path of several candidates, or `null` for a tie.
 *
 * The candidate in the folder of the note wins, then the one of the fewest
 * folders. Two of the fewest folders are a tie, and a tie links nothing,
 * because a guess would link the wrong note.
 */
function pick(
  candidates: readonly string[],
  sourcePath: string,
): string | null {
  if (candidates.length <= 1) return candidates[0] ?? null;
  const folder = folderOf(sourcePath).join('/');
  const near = candidates.filter((path) => folderOf(path).join('/') === folder);
  if (near.length === 1) return near[0] ?? null;
  const fewest = Math.min(...candidates.map(depthOf));
  const shallow = candidates.filter((path) => depthOf(path) === fewest);
  return shallow.length === 1 ? (shallow[0] ?? null) : null;
}

/**
 * The resolver of the wiki links of one set of paths, as Obsidian resolves.
 *
 * A target names a note with or without its `.md` suffix, or a picture by its
 * whole name. A target with a folder names that path from the folder of the
 * note first, then from the root, then as the end of a longer path, since an
 * archive often holds the vault inside one more folder. A bare name matches
 * every file of that name in any folder. Case matters first, and a target
 * that matches no file in its own case matches with case aside.
 */
export function wikiLinkResolver(paths: readonly string[]): WikiResolver {
  const byLowerPath = new Map<string, string[]>();
  const byLowerName = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, path: string): void => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [path]);
    else list.push(path);
  };
  for (const path of paths) {
    const lower = path.toLowerCase();
    add(byLowerPath, lower, path);
    add(byLowerName, lower.slice(lower.lastIndexOf('/') + 1), path);
  }
  /** The files that one wanted path names, in its case first. */
  const matching = (found: readonly string[], wanted: string): string[] => {
    const exact = found.filter((path) => path === wanted);
    return exact.length > 0 ? exact : [...found];
  };
  const resolveOne = (wanted: string, sourcePath: string): string | null => {
    const lower = wanted.toLowerCase();
    if (!wanted.includes('/')) {
      const named = byLowerName.get(lower) ?? [];
      const exact = named.filter((path) => baseName(path) === wanted);
      return pick(exact.length > 0 ? exact : named, sourcePath);
    }
    for (const candidate of [
      joined(folderOf(sourcePath), wanted),
      joined([], wanted),
    ]) {
      if (candidate === null) continue;
      const found = matching(
        byLowerPath.get(candidate.toLowerCase()) ?? [],
        candidate,
      );
      if (found.length === 1) return found[0] ?? null;
    }
    const tail = `/${wanted.replace(/^(?:\.\.?\/)+/, '')}`;
    const longer = paths.filter((path) =>
      path.toLowerCase().endsWith(tail.toLowerCase()),
    );
    const exact = longer.filter((path) => path.endsWith(tail));
    return pick(exact.length > 0 ? exact : longer, sourcePath);
  };
  return (target, sourcePath) => {
    const written = target.trim().normalize('NFC');
    if (written === '' || written.startsWith('/')) return null;
    // A name with no suffix names a note, and a note wins over a file that
    // holds the same name with no suffix.
    for (const wanted of written.toLowerCase().endsWith('.md')
      ? [written]
      : [`${written}.md`, written]) {
      const found = resolveOne(wanted, sourcePath);
      if (found !== null) return found;
    }
    return null;
  };
}

/** The node types whose text a wiki link inside stays. */
const literalNodes = new Set<string>([
  'code',
  'inlineCode',
  'math',
  'inlineMath',
  'html',
  'yaml',
  'link',
  'image',
  'definition',
]);

/** One range of the source, from and to. */
type Range = { readonly from: number; readonly to: number };

/** A wiki link as the source writes it, without its brackets. */
const wikiLink = /\[\[([^[\]\n]+)\]\]/g;

/** The picture suffixes that an embed draws as a picture. */
const pictureSuffix = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp)$/i;

/** An alias of an embedded picture that states its size, such as `300x200`. */
const pictureSize = /^\d+(?:x\d+)?$/;

/** Whether the character at `at` is escaped by an odd run of backslashes. */
function escapedAt(source: string, at: number): boolean {
  let count = 0;
  for (let index = at - 1; index >= 0 && source[index] === '\\'; index -= 1)
    count += 1;
  return count % 2 === 1;
}

/** The parts of the text inside the brackets of one wiki link. */
type WikiParts = {
  readonly target: string;
  readonly heading: string;
  readonly alias: string;
};

/** Splits the text inside the brackets at its alias and its heading. */
function wikiParts(inner: string): WikiParts {
  const bar = /\\?\|/.exec(inner);
  const link = bar === null ? inner : inner.slice(0, bar.index);
  const alias = bar === null ? '' : inner.slice(bar.index + bar[0].length);
  const hash = link.indexOf('#');
  return {
    target: (hash === -1 ? link : link.slice(0, hash)).trim(),
    // Obsidian writes a heading inside a heading as `#One#Two`, and the last
    // one is the heading that the link opens.
    heading: hash === -1 ? '' : (link.slice(hash + 1).split('#').at(-1) ?? ''),
    alias: alias.trim(),
  };
}

/** The standard Markdown of one wiki link, or `null` to keep its text. */
function converted(
  parts: WikiParts,
  embed: boolean,
  sourcePath: string,
  resolve: WikiResolver,
): string | null {
  const block = parts.heading.startsWith('^');
  const heading = block ? '' : parts.heading.trim();
  const slug = heading === '' ? '' : headingSlug(heading);
  const fragment = slug === '' ? '' : `#${slug}`;
  if (parts.target === '') {
    if (embed || fragment === '') return null;
    return `[${noteLinkLabel(parts.alias === '' ? heading : parts.alias)}](${fragment})`;
  }
  const path = resolve(parts.target, sourcePath);
  if (path === null) return null;
  const written = parts.target;
  if (embed && pictureSuffix.test(path)) {
    const name = written.slice(written.lastIndexOf('/') + 1);
    const alt =
      parts.alias === '' || pictureSize.test(parts.alias) ? name : parts.alias;
    return `!${standardNoteLink(sourcePath, path, alt)}`;
  }
  if (!path.endsWith('.md')) return null;
  const label =
    parts.alias !== ''
      ? parts.alias
      : heading === ''
        ? written
        : `${written} > ${heading}`;
  return standardNoteLink(sourcePath, path, label, fragment);
}

/**
 * Converts every wiki link of `source` whose target resolves.
 *
 * `sourcePath` is the stored path of the note that holds the text, which a
 * relative destination starts from. Every other character of the source
 * stays as it is. A source that the parser refuses for its size throws
 * `MarkdownLimitError`, as every entry point of this package does.
 */
export function convertWikiLinks(
  source: string,
  sourcePath: string,
  resolve: WikiResolver,
): WikiConversion {
  if (!source.includes('[[')) return { text: source, count: 0 };
  // The parser removes a leading byte order mark before it counts offsets.
  const shift = source.startsWith('\uFEFF') ? 1 : 0;
  const literal: Range[] = [];
  const cells: Range[] = [];
  visit(parseMarkdown(source), (node: Nodes) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined) return;
    const range = { from: from + shift, to: to + shift };
    if (node.type === 'tableCell') cells.push(range);
    if (!literalNodes.has(node.type)) return;
    literal.push(range);
    return 'skip';
  });
  const replacements: { readonly range: Range; readonly text: string }[] = [];
  for (const match of source.matchAll(wikiLink)) {
    const from = match.index;
    const to = from + match[0].length;
    if (escapedAt(source, from)) continue;
    if (literal.some((range) => range.from < to && from < range.to)) continue;
    // A link that runs over the edge of a cell would join two cells.
    if (
      cells.some(
        (cell) =>
          cell.from < to &&
          from < cell.to &&
          (from < cell.from || to > cell.to),
      )
    )
      continue;
    const embed = from > 0 && source[from - 1] === '!' && !escapedAt(source, from - 1);
    const text = converted(
      wikiParts(match[1] ?? ''),
      embed,
      sourcePath,
      resolve,
    );
    if (text === null) continue;
    replacements.push({ range: { from: embed ? from - 1 : from, to }, text });
  }
  let text = source;
  for (const { range, text: written } of [...replacements].reverse())
    text = `${text.slice(0, range.from)}${written}${text.slice(range.to)}`;
  return { text, count: replacements.length };
}
