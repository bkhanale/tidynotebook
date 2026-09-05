/**
 * Proves that the committed generated output matches the contract.
 *
 * Generation runs into a temporary root and every produced file is compared
 * byte for byte with the committed file. The check needs no Git history, so it
 * also works before the first commit.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { generateInto } from './generate.ts';
import { outputDirectories, repositoryRoot } from './paths.ts';
import { listFiles } from './files.ts';

async function compare(expected: string, actual: string): Promise<string[]> {
  const differences: string[] = [];
  const expectedFiles = await listFiles(expected);
  const actualFiles = await listFiles(actual);
  for (const file of expectedFiles)
    if (!actualFiles.includes(file))
      differences.push(`${file}: generated but not committed.`);
  for (const file of actualFiles)
    if (!expectedFiles.includes(file))
      differences.push(`${file}: committed but no longer generated.`);
  for (const file of expectedFiles) {
    if (!actualFiles.includes(file)) continue;
    const left = await readFile(resolve(expected, file));
    const right = await readFile(resolve(actual, file));
    if (!left.equals(right)) differences.push(`${file}: content differs.`);
  }
  return differences;
}

const temporary = await mkdtemp(join(tmpdir(), 'notesapp-generated-'));
try {
  await generateInto(temporary);
  const fresh = outputDirectories(temporary);
  const committed = outputDirectories(repositoryRoot);
  const differences = [
    ...(await compare(fresh.contract, committed.contract)).map(
      (line) => `${relative(repositoryRoot, committed.contract)}/${line}`,
    ),
    ...(await compare(fresh.client, committed.client)).map(
      (line) => `${relative(repositoryRoot, committed.client)}/${line}`,
    ),
  ];
  if (differences.length > 0) {
    console.error(
      [
        'Generated output is out of date. Run `pnpm generate`.',
        ...differences,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Generated output matches the contract.');
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
