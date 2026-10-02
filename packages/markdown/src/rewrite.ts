/** Pure rewrites for portable references in stored Markdown. */
import type { Nodes } from 'mdast';
import { visit } from 'unist-util-visit';
import { parseMarkdown } from './parse.ts';
import { classifyUrl } from './policy.ts';

export type ReferenceRewrite = {
  readonly text: string;
  readonly count: number;
};

export type LegacyReferenceMap = {
  readonly notes: ReadonlyMap<string, string>;
  readonly attachments: ReadonlyMap<string, string>;
};

export type PortableMigration = ReferenceRewrite & {
  readonly deadReferences: readonly string[];
};

type Replacement = {
  readonly from: number;
  readonly to: number;
  readonly text: string;
};

function folder(path: string): readonly string[] {
  const parts = path.split('/');
  parts.pop();
  return parts;
}

/**
 * The characters that a path segment cannot hold as they are, with their
 * escape, in the order the escape runs.
 *
 * A space and a parenthesis would end a Markdown destination, `#` and `?`
 * would start a fragment and a query, `<` and `>` would start or end a
 * destination of their own, and `:` would make the path read as an address
 * with a scheme, so `https:evil.com.md` would open another site. `%` comes first, so an escape is never escaped
 * twice. Every other character stays as the name holds it, so a link reads
 * like its note.
 */
const pathEscapes: readonly (readonly [string, string])[] = [
  ['%', '%25'],
  [' ', '%20'],
  ['(', '%28'],
  [')', '%29'],
  ['#', '%23'],
  ['?', '%3F'],
  ['<', '%3C'],
  ['>', '%3E'],
  [':', '%3A'],
];

/** Returns the portable path of `targetPath` seen from `sourcePath`. */
export function portableRelativePath(
  sourcePath: string,
  targetPath: string,
): string {
  const source = folder(sourcePath);
  const target = targetPath.split('/');
  let shared = 0;
  while (
    shared < source.length &&
    shared < target.length - 1 &&
    source[shared] === target[shared]
  )
    shared += 1;
  const parts = [
    ...Array.from({ length: source.length - shared }, () => '..'),
    ...target.slice(shared),
  ];
  return pathEscapes.reduce(
    (path, [character, escape]) => path.replaceAll(character, escape),
    parts.join('/'),
  );
}

function destinationRange(
  source: string,
  node: Nodes,
  destination: string,
): { from: number; to: number } | null {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  if (from === undefined || to === undefined) return null;
  const found = source.indexOf(destination, from);
  return found < from || found >= to
    ? null
    : { from: found, to: found + destination.length };
}

function rewrite(source: string, replacements: readonly Replacement[]): string {
  let result = source;
  for (const item of [...replacements].sort(
    (left, right) => right.from - left.from,
  ))
    result = `${result.slice(0, item.from)}${item.text}${result.slice(item.to)}`;
  return result;
}

/**
 * Rewrites the destination of every relative link and image.
 *
 * `destination` receives the path that a relative reference resolves to from
 * `sourcePath`, and the fragment as the author wrote it, with its `#` or as an
 * empty text. It answers the new destination, or `null` to keep the reference
 * as written. Every other destination and every other character of the source
 * stays as it is.
 */
export function mapRelativeReferences(
  source: string,
  sourcePath: string,
  destination: (path: string, fragment: string) => string | null,
): ReferenceRewrite {
  const replacements: Replacement[] = [];
  visit(parseMarkdown(source), (node) => {
    if (
      node.type !== 'link' &&
      node.type !== 'image' &&
      node.type !== 'definition'
    )
      return;
    const target = classifyUrl(node.url, sourcePath);
    if (target.kind !== 'relative') return;
    const hash = node.url.indexOf('#');
    const fragment = hash === -1 ? '' : node.url.slice(hash);
    const text = destination(target.path, fragment);
    if (text === null) return;
    const range = destinationRange(source, node, node.url);
    if (range === null) return;
    replacements.push({ ...range, text });
  });
  return { text: rewrite(source, replacements), count: replacements.length };
}

/** Rewrites links when their source or target path moves. */
export function rewriteRelativeReferences(
  source: string,
  sourcePath: string,
  movedPaths: ReadonlyMap<string, string>,
): ReferenceRewrite {
  const nextSourcePath = movedPaths.get(sourcePath) ?? sourcePath;
  return mapRelativeReferences(source, sourcePath, (path, fragment) => {
    const nextTargetPath = movedPaths.get(path) ?? path;
    if (nextSourcePath === sourcePath && nextTargetPath === path) return null;
    return `${portableRelativePath(nextSourcePath, nextTargetPath)}${fragment}`;
  });
}

/** Rewrites the identifier references stored by version 0.1.0. */
export function migrateLegacyReferences(
  source: string,
  sourcePath: string,
  references: LegacyReferenceMap,
): PortableMigration {
  const replacements: Replacement[] = [];
  const deadReferences: string[] = [];
  visit(parseMarkdown(source), (node) => {
    if (
      node.type !== 'link' &&
      node.type !== 'image' &&
      node.type !== 'definition'
    )
      return;
    const target = classifyUrl(node.url, sourcePath);
    const targetPath =
      target.kind === 'note'
        ? references.notes.get(target.id)
        : target.kind === 'attachment'
          ? references.attachments.get(target.id)
          : undefined;
    if (target.kind !== 'note' && target.kind !== 'attachment') return;
    if (targetPath === undefined) {
      deadReferences.push(node.url);
      return;
    }
    const hash = node.url.indexOf('#');
    const fragment = hash === -1 ? '' : node.url.slice(hash);
    const range = destinationRange(source, node, node.url);
    if (range === null) return;
    replacements.push({
      ...range,
      text: `${portableRelativePath(sourcePath, targetPath)}${fragment}`,
    });
  });
  return {
    text: rewrite(source, replacements),
    count: replacements.length,
    deadReferences,
  };
}
