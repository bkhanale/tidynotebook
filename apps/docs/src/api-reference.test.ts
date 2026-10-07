import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from '@notesapp/markdown';
import { apiReference } from './api-reference.ts';
import { htmlDestination } from './links.ts';
import { markdownCopy } from './agents.ts';

function fixture() {
  const response = {
    description: 'The result.',
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/Result' } },
    },
  };
  const operation = (
    operationId: string,
    extra: Record<string, unknown> = {},
  ) => ({
    operationId,
    summary: `Run ${operationId}.`,
    description: 'The contract description.',
    tags: ['accounts'],
    responses: { '200': response, '204': { description: 'No body.' } },
    ...extra,
  });
  return {
    openapi: '3.1.2',
    info: { description: 'The generated API.' },
    security: [{ session: [] }, { key: [] }],
    tags: [{ name: 'accounts', description: 'Account operations.' }],
    components: {
      schemas: {
        Result: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name: { type: 'string', maxLength: 12 } },
        },
      },
      securitySchemes: {
        session: {
          type: 'apiKey',
          in: 'cookie',
          name: 'session',
          description: 'A browser session.',
        },
        key: { type: 'http', scheme: 'bearer', description: 'A personal key.' },
      },
      parameters: {
        Name: {
          name: 'name',
          in: 'query',
          required: true,
          style: 'form',
          explode: true,
          schema: { type: 'string' },
        },
      },
      requestBodies: {
        Input: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Result' },
            },
          },
        },
      },
    },
    paths: {
      '/account': {
        parameters: [{ $ref: '#/components/parameters/Name' }],
        get: operation('getAccount', {
          parameters: [
            {
              name: 'name',
              in: 'query',
              required: false,
              style: 'form',
              explode: false,
              schema: { type: 'string', maxLength: 5 },
            },
          ],
        }),
        post: operation('writeAccount', {
          requestBody: { $ref: '#/components/requestBodies/Input' },
          deprecated: true,
        }),
      },
      '/public': { get: operation('readPublic', { security: [] }) },
      '/session': {
        get: operation('readSession', { security: [{ session: [] }] }),
      },
    },
  };
}

const reference = apiReference(fixture());
const accounts = reference.pages.find(
  (page) => page.file === 'api-reference-accounts.md',
);
if (accounts === undefined) throw new Error('No account page.');

await test('the overview renders server guidance and variables from the contract', () => {
  const input = fixture();
  Object.assign(input, {
    servers: [
      {
        url: 'https://{host}',
        description: 'Use the HTTPS origin of your own installation.',
        variables: { host: { default: 'notes.invalid' } },
      },
      { url: '/api' },
    ],
  });
  const overview = apiReference(input).pages[0];
  assert.ok(overview);
  assert.match(overview.source, /## Server address/);
  assert.match(
    overview.source,
    /Use the HTTPS origin of your own installation/,
  );
  assert.match(overview.source, /"url": "https:\/\/{host}"/);
  assert.match(overview.source, /"default": "notes.invalid"/);
  assert.match(overview.source, /"url": "\/api"/);
});

await test('the reference inherits security and keeps explicit public and session requirements', () => {
  const inherited =
    accounts.source.split('## getAccount')[1]?.split('## writeAccount')[0] ??
    '';
  assert.match(inherited, /\[session\]\(api-reference\.md#session\)/);
  assert.match(inherited, /\[key\]\(api-reference\.md#key\)/);
  const open =
    accounts.source.split('## readPublic')[1]?.split('## readSession')[0] ?? '';
  assert.match(open, /No security scheme is declared/);
  assert.doesNotMatch(open, /\[key\]/);
  const session = accounts.source.split('## readSession')[1] ?? '';
  assert.match(session, /\[session\]/);
  assert.doesNotMatch(session, /\[key\]/);
});

await test('security preserves AND, OR, scopes, and an anonymous alternative', () => {
  const input = fixture();
  Object.assign(input.paths['/public'].get, {
    security: [{ session: ['read'], key: [] }, {}],
  });
  const source =
    apiReference(input).pages.find((page) => page.file === accounts.file)
      ?.source ?? '';
  assert.match(source, /\[session\].*with scopes read \+ \[key\]/);
  assert.match(source, /- No security scheme is declared/);
});

await test('parameters override the path entry and bodies, response media, and schemas keep all metadata', () => {
  assert.match(accounts.source, /"maxLength": 5/);
  const get =
    accounts.source.split('## getAccount')[1]?.split('## writeAccount')[0] ??
    '';
  assert.doesNotMatch(get, /"required": true/);
  assert.match(accounts.source, /"explode": false/);
  assert.match(accounts.source, /This operation is deprecated/);
  assert.match(accounts.source, /### Request body/);
  assert.match(accounts.source, /application\/json/);
  assert.match(accounts.source, /#### 204/);
  assert.match(accounts.source, /\[Result\]\(api-schemas\.md#result\)/);
  const schemas = reference.pages.at(-1)?.source ?? '';
  assert.match(schemas, /"additionalProperties": false/);
  assert.match(schemas, /"maxLength": 12/);
});

await test('generated links render under the base and Markdown copies name their copies', async () => {
  const settings = {
    base: '/nested/docs/',
    origin: 'https://docs.example.com',
  };
  const files = new Set(reference.pages.map((page) => page.file));
  const html = await renderMarkdown(accounts.source, {
    sourcePath: `docs/guide/${accounts.file}`,
    noteHref: (target) => htmlDestination(settings, files, target),
  });
  assert.match(
    html,
    /href="\/nested\/docs\/api-schemas\/#user-content-result"/,
  );
  assert.match(html, /href="\/nested\/docs\/api-reference\/#user-content-key"/);
  const markdown = markdownCopy(settings, files, accounts);
  assert.match(
    markdown,
    /https:\/\/docs\.example\.com\/nested\/docs\/api-schemas\.md#result/,
  );
});

await test('unknown tags, missing schema references, duplicate operations, and reference cycles stop generation', () => {
  const unknown = fixture();
  unknown.paths['/public'].get.tags = ['unknown'];
  assert.throws(() => apiReference(unknown), /unknown tag/);
  const missing = fixture();
  missing.paths['/public'].get.responses['200'].content[
    'application/json'
  ].schema.$ref = '#/components/schemas/Missing';
  assert.throws(() => apiReference(missing), /missing reference/);
  const duplicate = fixture();
  duplicate.paths['/public'].get.operationId = 'getAccount';
  assert.throws(() => apiReference(duplicate), /duplicate operation/);
  const cycle = fixture();
  Object.assign(cycle.components.parameters.Name, {
    $ref: '#/components/parameters/Name',
  });
  assert.throws(() => apiReference(cycle), /reference cycle/);
});

await test('contract text cannot close its schema fence or add a heading through a name', async () => {
  const input = fixture();
  input.paths['/public'].get.operationId = 'name\n# injected';
  Object.assign(input.components.schemas.Result, {
    description: '```\n# fake heading\n```',
  });
  const built = apiReference(input);
  const schemas = built.pages.at(-1);
  assert.ok(schemas);
  assert.equal(schemas.headings.length, 1);
  const html = await renderMarkdown(schemas.source);
  assert.match(html, /fake heading/);
  assert.equal(html.match(/<h2 /g)?.length, 1);
});
