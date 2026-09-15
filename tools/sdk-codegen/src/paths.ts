import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory of the `@notesapp/sdk-codegen` package. */
export const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** Repository root that owns the contract and the generated output. */
export const repositoryRoot = resolve(packageRoot, '../..');

/** Redocly executable installed by this package. */
export const redoclyBin = resolve(packageRoot, 'node_modules/.bin/redocly');

/** Directory that holds the contract source files. */
export const contractDirectory = resolve(
  repositoryRoot,
  'packages/api-contract',
);

/** Root document of the contract. Redocly bundles its files into one. */
export const contractFile = resolve(contractDirectory, 'openapi.yaml');

/** Redocly rule configuration for the contract. */
export const redoclyConfigFile = resolve(contractDirectory, 'redocly.yaml');

/**
 * Output directories relative to a repository-like root. `check-generated`
 * passes a temporary root so it can compare bytes with the committed output.
 */
export function outputDirectories(root: string): {
  contract: string;
  client: string;
} {
  return {
    contract: resolve(root, 'packages/api-contract/src/generated'),
    client: resolve(root, 'packages/api-client/src/generated'),
  };
}
