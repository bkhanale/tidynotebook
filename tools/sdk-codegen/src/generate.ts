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
import { mergeAuthContract } from './auth-contract.ts';
import { buildContractIndex } from './contract-index.ts';
import { shareDefinitions } from './definitions.ts';
import { emitContractModule } from './emit.ts';
import { assertNoOrphanComponents } from './orphans.ts';
import {
  contractFile,
  outputDirectories,
  redoclyBin,
  redoclyConfigFile,
  repositoryRoot,
} from './paths.ts';

/**
 * Runs Redocly and writes one bundled contract document.
 *
 * Without `dereference` the result keeps the document's own references, so it
 * is still the source form that the client generator reads. With it, every
 * reference is resolved, which is the form the runtime operation index needs.
 */
function bundleContract(
  input: string,
  output: string,
  dereference: boolean,
): void {
  execFileSync(
    redoclyBin,
    [
      'bundle',
      input,
      '--config',
      redoclyConfigFile,
      ...(dereference ? ['--dereferenced'] : []),
      '--ext',
      'json',
      '--output',
      output,
    ],
    { cwd: repositoryRoot, stdio: ['ignore', 'ignore', 'inherit'] },
  );
}

/** Reads a JSON document as an object. */
async function readDocument(file: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`The bundled contract at ${file} is not an object.`);
  return Object.fromEntries(Object.entries(parsed));
}

/** `components.schemas` of a dereferenced document, or an empty map. */
function componentSchemas(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const components: unknown = document.components;
  if (components === null || typeof components !== 'object') return {};
  const schemas: unknown = (components as Record<string, unknown>).schemas;
  if (schemas === null || typeof schemas !== 'object') return {};
  return Object.fromEntries(Object.entries(schemas));
}

/** Generates every committed artefact under the given repository-like root. */
export async function generateInto(root: string): Promise<void> {
  const directories = outputDirectories(root);
  const work = await mkdtemp(join(tmpdir(), 'notesapp-bundle-'));
  const sourceFile = resolve(work, 'openapi.source.json');
  const mergedFile = resolve(work, 'openapi.merged.json');
  const flatFile = resolve(work, 'openapi.flat.json');
  try {
    await generateFrom(directories, sourceFile, mergedFile, flatFile);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Writes every artefact from one temporary working directory. */
async function generateFrom(
  directories: { contract: string; client: string },
  sourceFile: string,
  mergedFile: string,
  flatFile: string,
): Promise<void> {
  // The authentication protocol fragment is added to the source form, so the
  // generated client keeps one set of shared component types.
  bundleContract(contractFile, sourceFile, false);
  const merged = mergeAuthContract(await readDocument(sourceFile));
  // A component that nothing reaches would still reach the shipped client, so
  // it is a generation failure rather than a review matter.
  assertNoOrphanComponents(merged);
  await writeFile(mergedFile, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  bundleContract(mergedFile, flatFile, true);
  const flat = await readDocument(flatFile);
  const shared = shareDefinitions(
    buildContractIndex(flat),
    componentSchemas(flat),
  );

  await rm(directories.contract, { recursive: true, force: true });
  await mkdir(directories.contract, { recursive: true });
  await writeFile(
    resolve(directories.contract, 'contract.ts'),
    emitContractModule(shared),
    'utf8',
  );

  await createClient({
    input: mergedFile,
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
