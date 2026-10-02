/**
 * The addresses that a browser reads itself (record 0178).
 *
 * A browser saves a download to its disk as it arrives only when it reads the
 * address itself, for example through an anchor with `download`. The feature
 * code writes no request URL, so the generator writes a typed builder of the
 * address for each operation that the contract marks with
 * `x-notesapp-browser-address: true`, from the path that the contract states.
 *
 * Only a `GET` with no request body and no required query or header
 * parameter may carry the mark: the browser sends its cookie and nothing else,
 * so the address alone must be the whole request.
 */

/** The extension that marks an operation that a browser reads itself. */
export const browserAddressExtension = 'x-notesapp-browser-address';

/** One operation that a browser reads itself. */
export type BrowserAddress = {
  readonly id: string;
  readonly path: string;
  /** The path parameters, in the order of the path. */
  readonly pathParameters: readonly string[];
};

const methods = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

function fail(message: string): never {
  throw new Error(`Browser address: ${message}`);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The parameters of an operation that a browser could not send. */
function requiredOutsideThePath(
  parameters: readonly unknown[],
): readonly string[] {
  return parameters.flatMap((parameter) => {
    const entry = record(parameter);
    if (entry === null) return [];
    const where = entry['in'];
    return entry['required'] === true && where !== 'path'
      ? [`${String(where)} ${String(entry['name'])}`]
      : [];
  });
}

/**
 * Every operation of a dereferenced document that a browser reads itself, in
 * the order of the paths, or a refusal that names the operation.
 */
export function readBrowserAddresses(
  document: Record<string, unknown>,
): readonly BrowserAddress[] {
  const addresses: BrowserAddress[] = [];
  for (const [path, item] of Object.entries(record(document['paths']) ?? {})) {
    const pathItem = record(item) ?? {};
    for (const method of methods) {
      const operation = record(pathItem[method]);
      if (operation === null) continue;
      const mark = operation[browserAddressExtension];
      if (mark === undefined) continue;
      const id = String(operation['operationId']);
      if (mark !== true)
        fail(`${id} states ${browserAddressExtension} as other than true.`);
      if (method !== 'get')
        fail(`${id} is a ${method.toUpperCase()}, and a browser reads a GET.`);
      if (operation['requestBody'] !== undefined)
        fail(`${id} takes a request body, which a browser does not send.`);
      const required = requiredOutsideThePath([
        ...list(pathItem['parameters']),
        ...list(operation['parameters']),
      ]);
      if (required.length > 0)
        fail(
          `${id} requires ${required.join(', ')}, which a browser does not send.`,
        );
      addresses.push({
        id,
        path,
        pathParameters: [...path.matchAll(/\{([^}]+)\}/g)].map(
          (match) => match[1] ?? '',
        ),
      });
    }
  }
  return addresses;
}

/** The TypeScript of the builders of the given addresses. */
export function emitAddressModule(
  addresses: readonly BrowserAddress[],
): string {
  const builders = addresses.map((address) => {
    const parameters =
      address.pathParameters.length === 0
        ? ''
        : `path: { ${address.pathParameters
            .map((name) => `readonly ${name}: string`)
            .join('; ')} }`;
    const template = address.path.replace(
      /\{([^}]+)\}/g,
      (_match, name: string) => `\${segment(path.${name})}`,
    );
    return `
/**
 * The address of \`${address.id}\`, which a browser reads itself (record
 * 0178), from the base URL of the client.
 */
export function ${address.id}Address(${parameters}): string {
  return \`\${client.getConfig().baseUrl ?? ''}${template}\`;
}
`;
  });
  return `/*
 * Generated from packages/api-contract/openapi.yaml by tools/sdk-codegen.
 * Do not edit by hand. Run \`pnpm generate\` after a contract change.
 */

${
  addresses.length === 0
    ? ''
    : `import { client } from './client.gen.js';

/** One path parameter of an address, encoded. */
const segment = (value: string): string => encodeURIComponent(value);
`
}${builders.join('')}`;
}
