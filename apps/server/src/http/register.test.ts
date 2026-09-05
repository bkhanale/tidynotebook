import assert from 'node:assert/strict';
import test from 'node:test';
import {
  baseMediaType,
  checkRegistration,
  mediaTypeHandling,
  toRoutePath,
} from './register.ts';

await test('a path template becomes a Fastify route path', () => {
  assert.equal(toRoutePath('/api/health'), '/api/health');
  assert.equal(toRoutePath('/api/files/{fileId}'), '/api/files/:fileId');
  assert.equal(
    toRoutePath('/api/files/{fileId}/revisions/{revisionId}'),
    '/api/files/:fileId/revisions/:revisionId',
  );
});

await test('a media type loses its parameters and its case', () => {
  assert.equal(
    baseMediaType('Application/Problem+JSON; charset=utf-8'),
    'application/problem+json',
  );
  assert.equal(baseMediaType('application/json'), 'application/json');
  assert.equal(baseMediaType(undefined), '');
  assert.equal(baseMediaType(42), '');
});

await test('only the JSON media types are validated as JSON', () => {
  assert.equal(mediaTypeHandling['application/json'], 'json');
  assert.equal(mediaTypeHandling['application/problem+json'], 'json');
  assert.equal(mediaTypeHandling['text/html'], 'html');
  assert.equal(mediaTypeHandling['image/png'], 'binary');
  assert.equal(mediaTypeHandling['application/vnd.notes+json'], undefined);
});

const publicEntry = {
  id: 'getHealth',
  parameters: [
    {
      name: 'x-request-id',
      location: 'header',
      style: 'simple',
      explode: false,
    },
  ],
  security: [],
};

await test('a matching handler map registers', () => {
  assert.doesNotThrow(() =>
    checkRegistration([publicEntry], ['getHealth'], false),
  );
});

await test('a missing or unknown handler stops startup', () => {
  assert.throws(
    () => checkRegistration([publicEntry], [], false),
    /Missing handler for operation getHealth/,
  );
  assert.throws(
    () => checkRegistration([publicEntry], ['getHealth', 'getGhost'], false),
    /Handler getGhost has no operation/,
  );
});

await test('an operation with a security requirement needs a resolver', () => {
  const guarded = {
    ...publicEntry,
    security: [{ sessionCookie: [] }, { agentToken: ['files:read'] }],
  };
  assert.throws(
    () => checkRegistration([guarded], ['getHealth'], false),
    /declares a security requirement, but no identity resolver was supplied/,
  );
  assert.doesNotThrow(() => checkRegistration([guarded], ['getHealth'], true));
});

await test('an unsupported parameter serialization stops startup', () => {
  const query = (style: string, explode: boolean) => ({
    ...publicEntry,
    parameters: [{ name: 'detail', location: 'query', style, explode }],
  });
  assert.doesNotThrow(() =>
    checkRegistration([query('form', true)], ['getHealth'], false),
  );
  assert.throws(
    () => checkRegistration([query('form', false)], ['getHealth'], false),
    /must use style form with explode true/,
  );
  assert.throws(
    () =>
      checkRegistration([query('spaceDelimited', true)], ['getHealth'], false),
    /must use style form with explode true/,
  );
  assert.throws(
    () =>
      checkRegistration(
        [
          {
            ...publicEntry,
            parameters: [
              {
                name: 'fileId',
                location: 'path',
                style: 'label',
                explode: false,
              },
            ],
          },
        ],
        ['getHealth'],
        false,
      ),
    /must use style simple/,
  );
  assert.throws(
    () =>
      checkRegistration(
        [
          {
            ...publicEntry,
            parameters: [
              {
                name: 'session',
                location: 'cookie',
                style: 'form',
                explode: true,
              },
            ],
          },
        ],
        ['getHealth'],
        false,
      ),
    /cookie parameter, which is not served/,
  );
});
