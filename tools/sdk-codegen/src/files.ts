import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Repository-relative file paths inside a directory, sorted and stable. */
export async function listFiles(
  directory: string,
  prefix = '',
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const files: string[][] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    files.push(
      entry.isDirectory()
        ? await listFiles(join(directory, entry.name), name)
        : [name],
    );
  }
  return files.flat();
}
