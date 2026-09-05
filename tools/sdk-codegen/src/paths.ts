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

/** Authoritative OpenAPI document. */
export const contractFile = resolve(
  repositoryRoot,
  'packages/api-contract/openapi.yaml',
);

/** Redocly rule configuration for the contract. */
export const redoclyConfigFile = resolve(
  repositoryRoot,
  'packages/api-contract/redocly.yaml',
);

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
