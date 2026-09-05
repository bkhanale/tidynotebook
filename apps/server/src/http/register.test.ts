import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import type { ProtocolResult } from './register.ts';
import {
  baseMediaType,
  checkBodyMediaType,
  checkRegistration,
  isJsonPayload,
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
  method: 'get' as const,
  path: '/api/health',
  protocol: null,
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

await test('a JSON payload must be an object or an array', () => {
  assert.equal(isJsonPayload({ status: 'ok' }), true);
  assert.equal(isJsonPayload([{ status: 'ok' }]), true);
  // A handler that serialized its own answer has left the contract.
  assert.equal(isJsonPayload('{"status":"ok"}'), false);
  assert.equal(isJsonPayload(Buffer.from('{"status":"ok"}')), false);
  assert.equal(isJsonPayload(new Uint8Array([1, 2, 3])), false);
  assert.equal(isJsonPayload(new ArrayBuffer(4)), false);
  assert.equal(isJsonPayload(Readable.from(['a'])), false);
  assert.equal(isJsonPayload(null), false);
  assert.equal(isJsonPayload(undefined), false);
  assert.equal(isJsonPayload(42), false);
});

await test('an operation without a body rejects every request body', () => {
  assert.equal(checkBodyMediaType(null, undefined, false), null);
  assert.equal(
    checkBodyMediaType(null, 'application/json', true),
    'no_body_allowed',
  );
});

await test('an operation with a body accepts only its media type', () => {
  const declared = 'application/json';
  assert.equal(checkBodyMediaType(declared, undefined, false), null);
  assert.equal(
    checkBodyMediaType(declared, 'application/json; charset=utf-8', true),
    null,
  );
  assert.equal(checkBodyMediaType(declared, 'Application/JSON', true), null);
  assert.equal(
    checkBodyMediaType(declared, 'text/plain', true),
    'unsupported_media_type',
  );
  assert.equal(
    checkBodyMediaType(declared, undefined, true),
    'unsupported_media_type',
  );
});

await test('a protocol operation needs no contract handler', () => {
  const protocolEntry = {
    ...publicEntry,
    id: 'signInWithPassword',
    method: 'post' as const,
    path: '/api/auth/sign-in/email',
    protocol: 'better-auth',
  };
  const adapter = {
    protocol: 'better-auth',
    routes: [{ method: 'POST' as const, path: '/api/auth/sign-in/email' }],
    handle: (): Promise<ProtocolResult> =>
      Promise.resolve({
        status: 200,
        mediaType: 'application/json',
        headers: [],
        cookies: [],
        body: {},
        bytes: null,
      }),
  };
  assert.doesNotThrow(() =>
    checkRegistration([publicEntry, protocolEntry], ['getHealth'], false, [
      adapter,
    ]),
  );
  // A handler for a protocol operation is an unknown handler.
  assert.throws(
    () =>
      checkRegistration(
        [publicEntry, protocolEntry],
        ['getHealth', 'signInWithPassword'],
        false,
        [adapter],
      ),
    /Handler signInWithPassword has no operation/,
  );
});

await test('a protocol operation outside the adapter path list stops startup', () => {
  const protocolEntry = {
    ...publicEntry,
    id: 'signOut',
    method: 'post' as const,
    path: '/api/auth/sign-out',
    protocol: 'better-auth',
  };
  assert.throws(
    () => checkRegistration([protocolEntry], [], false, []),
    /names protocol better-auth, which no adapter serves/,
  );
  assert.throws(
    () =>
      checkRegistration([protocolEntry], [], false, [
        {
          protocol: 'better-auth',
          routes: [
            { method: 'POST' as const, path: '/api/auth/sign-in/email' },
          ],
          handle: (): Promise<ProtocolResult> =>
            Promise.resolve({
              status: 200,
              mediaType: 'application/json',
              headers: [],
              cookies: [],
              body: {},
              bytes: null,
            }),
        },
      ]),
    /is not in the exact path list of protocol better-auth/,
  );
});
