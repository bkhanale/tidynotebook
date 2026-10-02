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
import { assertContractLayout } from './contract-layout.ts';
import { shareDefinitions, type ChannelSchemas } from './definitions.ts';
import { emitAddressModule, readBrowserAddresses } from './addresses.ts';
import { emitContractModule, emitSocketModule } from './emit.ts';
import {
  readMessageContract,
  type MessageContract,
} from './message-contract.ts';
import { assertNoOrphanComponents } from './orphans.ts';
import {
  contractFile,
  messageContractFile,
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
  if (!('schemas' in components)) return {};
  const schemas: unknown = components.schemas;
  if (schemas === null || typeof schemas !== 'object') return {};
  return Object.fromEntries(Object.entries(schemas));
}

/**
 * The channels with the dereferenced payload schema of each message.
 *
 * The payload schemas come from the dereferenced HTTP contract, which lists
 * each of them, so a message is validated by the same schema text that Hey
 * API typed.
 */
function channelSchemas(
  contract: MessageContract,
  schemas: Record<string, unknown>,
): ChannelSchemas[] {
  return contract.channels.map((channel) => ({
    ...channel,
    messages: channel.messages.map((message) => {
      const schema: unknown = schemas[message.schema];
      if (schema === null || typeof schema !== 'object')
        throw new Error(
          `Message contract: the schema ${message.schema} is not in the dereferenced contract.`,
        );
      return {
        kind: message.kind,
        direction: message.direction,
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          ...Object.fromEntries(Object.entries(schema)),
        },
      };
    }),
  }));
}

/** Generates every committed artefact under the given repository-like root. */
export async function generateInto(root: string): Promise<void> {
  const directories = outputDirectories(root);
  const work = await mkdtemp(join(tmpdir(), 'notesapp-bundle-'));
  const sourceFile = resolve(work, 'openapi.source.json');
  const messagesFile = resolve(work, 'asyncapi.source.json');
  const mergedFile = resolve(work, 'openapi.merged.json');
  const flatFile = resolve(work, 'openapi.flat.json');
  try {
    await generateFrom(directories, {
      sourceFile,
      messagesFile,
      mergedFile,
      flatFile,
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Writes every artefact from one temporary working directory. */
async function generateFrom(
  directories: { contract: string; client: string },
  files: {
    readonly sourceFile: string;
    readonly messagesFile: string;
    readonly mergedFile: string;
    readonly flatFile: string;
  },
): Promise<void> {
  const { sourceFile, messagesFile, mergedFile, flatFile } = files;
  // The authentication protocol fragment is added to the source form, so the
  // generated client keeps one set of shared component types.
  bundleContract(contractFile, sourceFile, false);
  const source = await readDocument(sourceFile);
  bundleContract(messageContractFile, messagesFile, false);
  const messages = await readDocument(messagesFile);
  // A source file that no root document references never reaches a bundle,
  // so no Redocly rule can see it. The check runs before the merge, because
  // the fragment below adds paths and schemas that no file holds.
  await assertContractLayout(source, messages);
  const merged = mergeAuthContract(source);
  // A component that nothing reaches would still reach the shipped client, so
  // it is a generation failure rather than a review matter.
  assertNoOrphanComponents(merged, messages);
  const messageContract = readMessageContract(messages, merged);
  await writeFile(mergedFile, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  bundleContract(mergedFile, flatFile, true);
  const flat = await readDocument(flatFile);
  const schemas = componentSchemas(flat);
  const shared = shareDefinitions(
    buildContractIndex(flat),
    schemas,
    channelSchemas(messageContract, schemas),
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
  // Hey API cleans its output directory, so the socket entry is written after
  // it. It imports the payload types that Hey API just wrote.
  await writeFile(
    resolve(directories.client, 'socket.gen.ts'),
    emitSocketModule(messageContract),
    'utf8',
  );
  // The addresses that a browser reads itself (record 0178).
  await writeFile(
    resolve(directories.client, 'addresses.gen.ts'),
    emitAddressModule(readBrowserAddresses(flat)),
    'utf8',
  );
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  await generateInto(repositoryRoot);
  process.stdout.write(
    'Generated the contract index, its validators, and the SDK.\n',
  );
}
