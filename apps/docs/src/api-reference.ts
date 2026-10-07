/**
 * API reference pages from the merged OpenAPI document of the client.
 *
 * This module reads data and returns Markdown. It has no endpoint list, no
 * credential matrix, no transport, and no renderer (record 0209). Reference
 * objects stay in schema code, while links lead to their complete definitions.
 */
import { headingSlug } from '@notesapp/markdown';
import { readGuidePage, type GuideGroup, type GuidePage } from './guide.ts';
import { apiDocumentFile } from './links.ts';

type Json = Record<string, unknown>;

/** The generated pages and their navigation group. */
export type ApiReference = {
  readonly pages: readonly GuidePage[];
  readonly group: GuideGroup;
};

export { apiContractSource, apiDocumentFile, apiDownload } from './links.ts';

const methods = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, where: string): Json {
  if (!isRecord(value))
    throw new Error(`API reference: ${where} must be an object.`);
  return value;
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string')
    throw new Error(`API reference: ${where} must be text.`);
  return value;
}

function list(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value))
    throw new Error(`API reference: ${where} must be a list.`);
  return value;
}

/** A JSON pointer, with a loud refusal for an external or missing target. */
function pointer(document: Json, reference: string): unknown {
  if (!reference.startsWith('#/'))
    throw new Error(`API reference: external reference ${reference}.`);
  let value: unknown = document;
  for (const part of reference.slice(2).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    const object = record(value, reference);
    if (!(key in object))
      throw new Error(`API reference: missing reference ${reference}.`);
    value = object[key];
  }
  return value;
}

/** Resolve non-schema reference objects. Schemas keep their references. */
function target(
  document: Json,
  value: unknown,
  seen = new Set<string>(),
): Json {
  const object = record(value, 'reference target');
  if (typeof object.$ref !== 'string') return object;
  if (seen.has(object.$ref))
    throw new Error(`API reference: reference cycle ${object.$ref}.`);
  seen.add(object.$ref);
  const { $ref, ...siblings } = object;
  return { ...target(document, pointer(document, $ref), seen), ...siblings };
}

/** Plain text inside a Markdown label, heading, or table cell. */
function label(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[\\`*_{}[\]<>|#]/g, '\\$&');
}

/** A code fence that cannot be closed by contract text. */
function code(value: unknown): string {
  const body = JSON.stringify(value, null, 2);
  const longest = Math.max(
    2,
    ...[...body.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const fence = '`'.repeat(longest + 1);
  return `${fence}json\n${body}\n${fence}`;
}

function page(
  file: string,
  name: string,
  sections: readonly string[],
): GuidePage {
  return readGuidePage(
    file,
    [
      `# ${label(name)}`,
      '',
      'This page is for the person who connects a program to the API.',
      '',
      ...sections,
      '',
    ].join('\n\n'),
  );
}

/** The actual heading identifier, including the renderer's duplicate suffix. */
function heading(page: GuidePage, name: string): string {
  const found = page.headings.find((entry) => entry.text === name);
  if (found === undefined)
    throw new Error(`API reference: no heading for ${name}.`);
  return `#${found.id.slice('user-content-'.length)}`;
}

/** All schema references in one shape, with their target checked. */
function schemaLinks(
  document: Json,
  value: unknown,
  schemas: GuidePage,
): string {
  const names = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isRecord(node)) return;
    if (typeof node.$ref === 'string') {
      pointer(document, node.$ref);
      const prefix = '#/components/schemas/';
      if (node.$ref.startsWith(prefix))
        names.add(
          node.$ref
            .slice(prefix.length)
            .replaceAll('~1', '/')
            .replaceAll('~0', '~'),
        );
    }
    Object.values(node).forEach(visit);
  };
  visit(value);
  return [...names]
    .sort()
    .map(
      (name) =>
        `[${label(name)}](${`${schemas.file}${heading(schemas, name)}`})`,
    )
    .join(', ');
}

/** Security alternatives preserve OR between rows and AND within a row. */
function security(value: unknown, overview: GuidePage): string {
  const alternatives = list(value, 'security');
  if (alternatives.length === 0)
    return 'No security scheme is declared. See the operation description.';
  return [
    'Use one of these options:',
    ...alternatives.map((alternative) => {
      const required = record(alternative, 'security requirement');
      const entries = Object.entries(required);
      if (entries.length === 0) return '- No security scheme is declared.';
      return `- ${entries
        .map(([name, scopes]) => {
          const link = `[${label(name)}](${`${overview.file}${heading(overview, name)}`})`;
          const names = list(scopes, `${name} scopes`).map((scope) =>
            text(scope, 'scope'),
          );
          return `${link}${names.length === 0 ? '' : ` with scopes ${names.map(label).join(', ')}`}`;
        })
        .join(' + ')}`;
    }),
  ].join('\n');
}

/** Parameters of the path and operation, with operation overrides by name/in. */
function parameters(
  document: Json,
  item: Json,
  operation: Json,
): readonly Json[] {
  const found = new Map<string, Json>();
  for (const raw of [
    ...list(item.parameters ?? [], 'path parameters'),
    ...list(operation.parameters ?? [], 'operation parameters'),
  ]) {
    const parameter = target(document, raw);
    found.set(
      `${text(parameter.in, 'parameter location')}:${text(parameter.name, 'parameter name')}`,
      parameter,
    );
  }
  return [...found.values()];
}

/** One tag page, including every request and response in contract order. */
function operationSections(
  document: Json,
  path: string,
  method: string,
  item: Json,
  operation: Json,
  overview: GuidePage,
  schemas: GuidePage,
): readonly string[] {
  const id = text(operation.operationId, 'operationId');
  const parts = [
    `## ${label(id)}`,
    `\`${method.toUpperCase()} ${path}\``,
    text(operation.summary, `${id} summary`),
    text(operation.description, `${id} description`),
  ];
  if (operation.deprecated === true)
    parts.push('This operation is deprecated.');
  parts.push(
    '### Authentication',
    security(operation.security ?? document.security ?? [], overview),
  );
  const params = parameters(document, item, operation);
  if (params.length > 0) {
    parts.push('### Parameters');
    for (const parameter of params) {
      parts.push(
        `#### ${label(text(parameter.name, 'parameter name'))}`,
        code(parameter),
      );
      const links = schemaLinks(document, parameter, schemas);
      if (links !== '') parts.push(`Schemas: ${links}.`);
    }
  }
  if (operation.requestBody !== undefined) {
    const body = target(document, operation.requestBody);
    parts.push('### Request body', code(body));
    const links = schemaLinks(document, body, schemas);
    if (links !== '') parts.push(`Schemas: ${links}.`);
  }
  parts.push('### Responses');
  for (const [status, raw] of Object.entries(
    record(operation.responses, `${id} responses`),
  )) {
    const response = target(document, raw);
    parts.push(
      `#### ${label(status)}`,
      text(response.description, `${id} ${status} description`),
      code(response),
    );
    const links = schemaLinks(document, response, schemas);
    if (links !== '') parts.push(`Schemas: ${links}.`);
  }
  return parts;
}

/** Generate the complete reference with no file access. */
export function apiReference(value: unknown): ApiReference {
  const document = record(value, 'OpenAPI document');
  if (
    typeof document.openapi !== 'string' ||
    !document.openapi.startsWith('3.1.')
  )
    throw new Error('API reference: OpenAPI 3.1 is required.');
  const components = record(document.components, 'components');
  const schemaEntries = Object.entries(record(components.schemas, 'schemas'));
  const schemas = page(
    'api-schemas.md',
    'API schemas',
    schemaEntries.flatMap(([name, shape]) => [
      `## ${label(name)}`,
      code(shape),
    ]),
  );
  // Links follow the heading ids that the shared parser actually assigned.
  const schemasWithLinks = page(
    'api-schemas.md',
    'API schemas',
    schemaEntries.flatMap(([name, shape]) => {
      const links = schemaLinks(document, shape, schemas);
      return [
        `## ${label(name)}`,
        code(shape),
        ...(links === '' ? [] : [`Schemas: ${links}.`]),
      ];
    }),
  );
  const schemeEntries = Object.entries(
    record(components.securitySchemes ?? {}, 'security schemes'),
  );
  const servers = list(document.servers ?? [], 'servers');
  const overview = page('api-reference.md', 'API reference', [
    text(record(document.info, 'info').description, 'API description'),
    `[Download OpenAPI JSON](../../${apiDocumentFile}).`,
    ...(servers.length === 0
      ? []
      : [
          '## Server address',
          ...servers.flatMap((raw) => {
            const server = record(raw, 'server');
            return [
              ...(server.description === undefined
                ? []
                : [text(server.description, 'server description')]),
              code(server),
            ];
          }),
        ]),
    '## Authentication',
    ...schemeEntries.flatMap(([name, raw]) => {
      const scheme = target(document, raw);
      return [
        `### ${label(name)}`,
        text(scheme.description, `${name} description`),
        code(scheme),
        ...(scheme.type === 'http' && scheme.scheme === 'bearer'
          ? ['```http\nAuthorization: Bearer <key>\n```']
          : []),
      ];
    }),
  ]);
  const tags = list(document.tags, 'tags').map((raw) => record(raw, 'tag'));
  const byTag = new Map<string, string[]>();
  for (const tag of tags) byTag.set(text(tag.name, 'tag name'), []);
  const seen = new Set<string>();
  for (const [path, raw] of Object.entries(record(document.paths, 'paths'))) {
    const item = target(document, raw);
    for (const [method, rawOperation] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      const operation = record(rawOperation, `${method} ${path}`);
      const id = text(operation.operationId, 'operationId');
      if (seen.has(id))
        throw new Error(`API reference: duplicate operation ${id}.`);
      seen.add(id);
      const tag = text(list(operation.tags, `${id} tags`)[0], `${id} tag`);
      const sections = byTag.get(tag);
      if (sections === undefined)
        throw new Error(`API reference: unknown tag ${tag}.`);
      sections.push(
        ...operationSections(
          document,
          path,
          method,
          item,
          operation,
          overview,
          schemas,
        ),
      );
    }
  }
  const pages = [
    overview,
    ...tags.map((tag) => {
      const name = text(tag.name, 'tag name');
      return page(`api-reference-${headingSlug(name)}.md`, `API ${name}`, [
        text(tag.description, `${name} description`),
        ...(byTag.get(name) ?? []),
      ]);
    }),
    schemasWithLinks,
  ];
  if (new Set(pages.map((entry) => entry.file)).size !== pages.length)
    throw new Error('API reference: page names collide.');
  const group: GuideGroup = {
    title: 'API reference',
    pages: pages.map((entry) => ({
      file: entry.file,
      title: entry.title,
      summary: entry.description,
    })),
  };
  const operationsIndex = pages
    .slice(1, -1)
    .map((entry) => `- [${label(entry.title)}](${entry.file})`)
    .join('\n');
  const completeOverview = readGuidePage(
    overview.file,
    `${overview.source}\n## Operations\n\n${operationsIndex}\n\n[API schemas](${schemas.file}).\n`,
  );
  return { pages: [completeOverview, ...pages.slice(1)], group };
}
