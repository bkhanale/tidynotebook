/**
 * The contract source layout check.
 *
 * The contract source is a root document beside one file for each path item
 * and one file for each component. Redocly bundles those files into the one
 * document that the generator reads, so a file that the root document does not
 * reference never reaches the bundle and Redocly reports nothing about it. A
 * component file that nothing references, or a path file that the root does
 * not list, would then sit in the tree and look live.
 *
 * This check closes that gap from the bundled document. Each path key and each
 * component name states the one file that holds it, so the set of files that
 * the document needs and the set of files on disk must be equal. A file that
 * the document does not need is unreachable. A file that the document needs
 * and the tree does not hold means the root keeps a definition inline instead
 * of splitting it out.
 *
 * The check reads the bundled source document, before the generator merges the
 * authentication fragment, because that fragment adds paths and schemas that
 * no source file holds.
 */
import { resolve } from 'node:path';
import { listFiles } from './files.ts';
import { contractDirectory } from './paths.ts';

type Json = Record<string, unknown>;

/** Directory of the path item files, relative to the contract directory. */
export const pathsDirectory = 'paths';

/** Directory of the component files, relative to the contract directory. */
export const componentsDirectory = 'components';

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The one file that holds a path item.
 *
 * The name is the path without its leading slash, with each `{name}` template
 * written as the bare name and each remaining slash written as `_`. The rule
 * is total, so a reader who knows the URL knows the file and needs no index.
 * A brace stays out of the name because a shell expands it.
 */
export function pathItemFile(path: string): string {
  const name = path
    .replace(/^\//, '')
    .replaceAll(/\{([^{}]+)\}/g, '$1')
    .replaceAll('/', '_');
  return `${pathsDirectory}/${name}.yaml`;
}

/** The one file that holds a component, named after the component. */
export function componentFile(section: string, name: string): string {
  return `${componentsDirectory}/${section}/${name}.yaml`;
}

/** Everything the document declares, as the file that must hold it. */
function requiredFiles(
  document: Json,
  problems: string[],
): Map<string, string> {
  const required = new Map<string, string>();
  const claim = (file: string, owner: string): void => {
    const other = required.get(file);
    if (other === undefined) {
      required.set(file, owner);
      return;
    }
    problems.push(`${file}: ${other} and ${owner} both need this file.`);
  };
  const paths = document.paths;
  if (isRecord(paths))
    for (const path of Object.keys(paths))
      claim(pathItemFile(path), `the path ${path}`);
  const components = document.components;
  if (isRecord(components))
    for (const [section, entries] of Object.entries(components)) {
      if (!isRecord(entries)) continue;
      for (const name of Object.keys(entries))
        claim(componentFile(section, name), `the component ${section}/${name}`);
    }
  return required;
}

/** Every disagreement between the document and the source files, sorted. */
export function findLayoutProblems(
  document: Json,
  files: readonly string[],
): string[] {
  const problems: string[] = [];
  const required = requiredFiles(document, problems);
  const present = new Set(files);
  for (const [file, owner] of [...required].sort(([a], [b]) =>
    a < b ? -1 : 1,
  ))
    if (!present.has(file))
      problems.push(
        `${file}: ${owner} stays in the root document. Move it into this file.`,
      );
  for (const file of [...present].sort())
    if (!required.has(file))
      problems.push(
        `${file}: no path and no component reaches this file. Reference it from the root document, or delete it.`,
      );
  return problems;
}

/** The contract source files, relative to the contract directory. */
export async function contractSourceFiles(): Promise<string[]> {
  const directories = [pathsDirectory, componentsDirectory];
  const listed = await Promise.all(
    directories.map(async (directory) =>
      (await listFiles(resolve(contractDirectory, directory))).map(
        (file) => `${directory}/${file}`,
      ),
    ),
  );
  return listed.flat();
}

/** Stops generation when the source files and the root document disagree. */
export async function assertContractLayout(document: Json): Promise<void> {
  const problems = findLayoutProblems(document, await contractSourceFiles());
  if (problems.length === 0) return;
  throw new Error(
    [
      'Contract layout: the source files and the root document disagree.',
      'One file holds one path item. One file holds one component.',
      ...problems.map((problem) => `  ${problem}`),
    ].join('\n'),
  );
}
