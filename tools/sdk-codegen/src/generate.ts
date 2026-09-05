/**
 * Deterministic contract and SDK generation.
 *
 * The order is fixed: bundle and dereference the contract with Redocly, write
 * the runtime operation index and its Ajv validators, then generate the typed
 * client with Hey API. Every step writes only into the requested output
 * directories, so `check-generated` can run the same code into a temporary
 * root and compare bytes.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient } from '@hey-api/openapi-ts';
import { buildContractIndex } from './contract-index.ts';
import { emitContractModule, emitValidatorModule } from './emit.ts';
import {
  contractFile,
  outputDirectories,
  redoclyBin,
  redoclyConfigFile,
  repositoryRoot,
} from './paths.ts';

/** Runs Redocly and returns the fully dereferenced contract document. */
async function bundleContract(): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), 'notesapp-bundle-'));
  const file = resolve(directory, 'openapi.bundled.json');
  try {
    execFileSync(
      redoclyBin,
      [
        'bundle',
        contractFile,
        '--config',
        redoclyConfigFile,
        '--dereferenced',
        '--ext',
        'json',
        '--output',
        file,
      ],
      { cwd: repositoryRoot, stdio: ['ignore', 'ignore', 'inherit'] },
    );
    const source: unknown = JSON.parse(await readFile(file, 'utf8'));
    return source;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Generates every committed artefact under the given repository-like root. */
export async function generateInto(root: string): Promise<void> {
  const directories = outputDirectories(root);
  const document = await bundleContract();
  const index = buildContractIndex(document);

  await rm(directories.contract, { recursive: true, force: true });
  await mkdir(directories.contract, { recursive: true });
  await writeFile(
    resolve(directories.contract, 'contract.ts'),
    emitContractModule(index),
    'utf8',
  );
  await writeFile(
    resolve(directories.contract, 'validators.ts'),
    emitValidatorModule(),
    'utf8',
  );

  await createClient({
    input: contractFile,
    output: {
      path: directories.client,
      clean: true,
      // The emitted modules import each other with a `.js` extension, so the
      // consuming package compiles and emits without a rewrite step.
      module: { extension: '.js' },
    },
    logs: { level: 'silent' },
    plugins: ['@hey-api/client-fetch', '@hey-api/sdk', '@hey-api/typescript'],
  });
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  await generateInto(repositoryRoot);
  console.log('Generated the contract index, its validators, and the SDK.');
}
