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

type Replacement = { readonly from: number; readonly to: number; readonly text: string };

function folder(path: string): readonly string[] {
  const parts = path.split('/');
  parts.pop();
  return parts;
}

/** Returns the portable path of `targetPath` seen from `sourcePath`. */
export function portableRelativePath(sourcePath: string, targetPath: string): string {
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
  return parts
    .join('/')
    .replaceAll('%', '%25')
    .replaceAll(' ', '%20')
    .replaceAll('(', '%28')
    .replaceAll(')', '%29');
}

function destinationRange(source: string, node: Nodes, destination: string): { from: number; to: number } | null {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  if (from === undefined || to === undefined) return null;
  const found = source.indexOf(destination, from);
  return found < from || found >= to ? null : { from: found, to: found + destination.length };
}

function rewrite(source: string, replacements: readonly Replacement[]): string {
  let result = source;
  for (const item of [...replacements].sort((left, right) => right.from - left.from))
    result = `${result.slice(0, item.from)}${item.text}${result.slice(item.to)}`;
  return result;
}

/** Rewrites links when their source or target path moves. */
export function rewriteRelativeReferences(
  source: string,
  sourcePath: string,
  movedPaths: ReadonlyMap<string, string>,
): ReferenceRewrite {
  const nextSourcePath = movedPaths.get(sourcePath) ?? sourcePath;
  const replacements: Replacement[] = [];
  visit(parseMarkdown(source), (node) => {
    if (node.type !== 'link' && node.type !== 'image' && node.type !== 'definition') return;
    const target = classifyUrl(node.url, sourcePath);
    if (target.kind !== 'relative') return;
    const nextTargetPath = movedPaths.get(target.path) ?? target.path;
    if (nextSourcePath === sourcePath && nextTargetPath === target.path) return;
    const hash = node.url.indexOf('#');
    const fragment = hash === -1 ? '' : node.url.slice(hash);
    const range = destinationRange(source, node, node.url);
    if (range === null) return;
    replacements.push({
      ...range,
      text: `${portableRelativePath(nextSourcePath, nextTargetPath)}${fragment}`,
    });
  });
  return { text: rewrite(source, replacements), count: replacements.length };
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
    if (node.type !== 'link' && node.type !== 'image' && node.type !== 'definition') return;
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
