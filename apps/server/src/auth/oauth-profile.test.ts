import assert from 'node:assert/strict';
import test from 'node:test';
import { oauthProvider } from '@better-auth/oauth-provider';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import {
  adaptOAuthProvider,
  boundedOAuthFetch,
  oauthRoutes,
  oauthMetadataPath,
  oauthRevocationAuthenticationRequest,
  oauthRevocationAuthenticationSucceeded,
} from './better-auth.ts';

test('the upstream type adapter changes only authorize OpenAPI parameters', () => {
  const original = oauthProvider({
    loginPage: '/sign-in',
    consentPage: '/oauth/consent',
    disableJwtPlugin: true,
  });
  const adapted = adaptOAuthProvider(original);
  const authorize = adapted.endpoints?.oauth2Authorize;
  assert.ok(authorize);
  const { parameters: _parameters, ...openapi } =
    original.endpoints.oauth2Authorize.options.metadata.openapi;
  assert.deepEqual(authorize.options, {
    ...original.endpoints.oauth2Authorize.options,
    metadata: {
      ...original.endpoints.oauth2Authorize.options.metadata,
      openapi,
    },
  });
  assert.equal(authorize.path, original.endpoints.oauth2Authorize.path);
  assert.deepEqual(
    Object.keys(authorize),
    Object.keys(original.endpoints.oauth2Authorize),
  );
  for (const name of Object.keys(original.endpoints.oauth2Authorize))
    if (name !== 'options')
      assert.equal(
        Reflect.get(authorize, name),
        Reflect.get(original.endpoints.oauth2Authorize, name),
        name,
      );
  for (const [name, endpoint] of Object.entries(original.endpoints))
    if (name !== 'oauth2Authorize')
      assert.equal(adapted.endpoints?.[name], endpoint, name);
  for (const [name, value] of Object.entries(original))
    if (name !== 'endpoints')
      assert.equal(Reflect.get(adapted, name), value, name);
});

test('OAuth discovery has one exact path and no OpenID path', () => {
  assert.deepEqual(
    oauthRoutes
      .filter((route) => route.path.includes('.well-known'))
      .map((route) => route.path),
    [oauthMetadataPath],
  );
});

test('the safe Node CIMD transport refuses special-use addresses', async () => {
  for (const host of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '[::1]',
    '[::ffff:127.0.0.1]',
  ])
    await assert.rejects(async () =>
      fetchClientMetadataResource(`https://${host}/client.json`),
    );
});

test('CIMD transport cancellation bounds a stalled lookup', async () => {
  const controller = new AbortController();
  const transport = boundedOAuthFetch(() => new Promise<Response>(() => {}));
  const pending = transport('https://client.example/client.json', {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(() => Promise.resolve(pending));
});

test('revocation sends one authentication request with no stored token or hint', async () => {
  const fields = new URLSearchParams({
    token: 'stored-token',
    token_type_hint: 'refresh_token',
    client_id: 'client',
    client_secret: 'secret',
  });
  const original = new Request('https://notes.example/api/auth/oauth2/revoke', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic credential',
    },
    body: fields.toString(),
  });
  const adapted = oauthRevocationAuthenticationRequest(original, fields);
  assert.equal(adapted.url, original.url);
  assert.equal(adapted.method, original.method);
  assert.deepEqual([...adapted.headers], [...original.headers]);
  const sent = new URLSearchParams(await adapted.text());
  assert.match(sent.get('token') ?? '', /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(sent.get('token'), fields.get('token'));
  assert.equal(sent.has('token_type_hint'), false);
  for (const name of ['client_id', 'client_secret'])
    assert.equal(sent.get(name), fields.get(name));
  assert.equal(fields.get('token'), 'stored-token');
});

test('only the exact post-authentication provider outcomes accept revocation', () => {
  assert.equal(oauthRevocationAuthenticationSucceeded(200, undefined), true);
  assert.equal(
    oauthRevocationAuthenticationSucceeded(400, {
      error: 'unsupported_token_type',
    }),
    true,
  );
  assert.equal(
    oauthRevocationAuthenticationSucceeded(400, {
      error: 'invalid_request',
      error_description: 'token not found',
    }),
    true,
  );
  for (const value of [
    { error: 'invalid_client' },
    {
      error: 'invalid_request',
      error_description: 'missing a required token for introspection',
    },
    { error: 'invalid_request' },
    null,
  ])
    assert.equal(oauthRevocationAuthenticationSucceeded(400, value), false);
  assert.equal(
    oauthRevocationAuthenticationSucceeded(500, {
      error: 'invalid_request',
      error_description: 'token not found',
    }),
    false,
  );
});
