/** The served OAuth flow and the built consent screen (record 0226). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  configureClient,
  continueOAuthAuthorization,
  exchangeOAuthToken,
  getAccount,
  getOAuthClient,
  giveOAuthConsent,
  registerOAuthClient,
  signInWithPassword,
} from '@notesapp/api-client';
import { bootstrapOwner, createApp, loadServerConfig } from '@notesapp/server';
import {
  oauthAcceptedScope,
  oauthConsentFacts,
  oauthConsentRoute,
  oauthPageStep,
  oauthRequest,
  oauthSignInRoute,
  type OAuthConsentFacts,
} from '../../apps/web/src/lib/oauth-consent.ts';
import { returnOf } from '../../apps/web/src/lib/sign-in-return.ts';
import { createDisposableDatabase, openSession } from './support/database.ts';
import { testEnvironment } from './support/server.ts';
import { webRequire } from './support/tailwind.ts';

const root = resolve(import.meta.dirname, '../..');
const database = await createDisposableDatabase();
const storageRoot = await mkdtemp(join(tmpdir(), 'notesapp-consent-'));
const config = loadServerConfig({
  ...testEnvironment(storageRoot),
  NOTESAPP_DATABASE_URL: database.runtimeUrl,
  NOTESAPP_AUTH_DATABASE_URL: database.authUrl,
  NOTESAPP_MCP_ORIGIN: 'https://mcp.notes.invalid',
  NOTESAPP_MAX_BODY_BYTES: '1048576',
  NOTESAPP_RATE_LIMIT_MAX: '2000',
  NOTESAPP_BREACH_CHECK: 'off',
});
const email = 'consent@notes.invalid';
const password = 'consent-owner-password-safe';
const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const resource = `${config.mcpOrigin}/mcp`;
const callback = 'http://127.0.0.1:49152/callback';
const brand = '<img src=x onerror=alert(1)> ChatGPT';
await bootstrapOwner({ config, email, name: 'Consent owner', password });
const app = await createApp(config, {
  webDist: resolve(root, 'apps/web/dist/web'),
  oauthFetch: (input) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          client_id:
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
          client_name: brand,
          redirect_uris: [callback],
          application_type: 'native',
          token_endpoint_auth_method: 'none',
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ),
});
const admin = await openSession(database.migrationUrl);
await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address();
assert.ok(address && typeof address !== 'string');
configureClient(`http://127.0.0.1:${String(address.port)}`, undefined);
let cookie = '';

function authorization(
  clientId: string,
  scope = 'notes:read notes:write offline_access',
): string {
  return `/api/auth/oauth2/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callback,
    scope,
    resource,
    state: 'one + two & three',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
  })}`;
}

async function register(name = brand): Promise<string> {
  const result = await registerOAuthClient({
    body: {
      client_name: name,
      client_uri: 'https://openai.com',
      logo_uri: 'https://openai.com/logo.png',
      redirect_uris: [callback],
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  });
  assert.equal(result.response?.status, 201, JSON.stringify(result.error));
  assert.ok(result.data);
  return result.data.client_id;
}

async function consentRequest(clientId: string, scope?: string) {
  const result = await app.inject({
    url: authorization(clientId, scope),
    headers: { cookie },
  });
  assert.equal(result.statusCode, 302, result.body);
  const location = new URL(String(result.headers.location), config.origin);
  assert.equal(location.pathname, oauthConsentRoute);
  const request = oauthRequest(location.search);
  assert.ok(request);
  return request;
}

/** Render the built component with the renderer of the web build, with no browser gate. */
async function markup(facts: OAuthConsentFacts): Promise<string> {
  const { OAuthConsentView } =
    await import('../../apps/web/dist/features/oauth/consent-view.js');
  const renderer: unknown = webRequire('react-dom/server');
  assert.ok(renderer !== null && typeof renderer === 'object');
  const render: unknown = Object.fromEntries(Object.entries(renderer))[
    'renderToStaticMarkup'
  ];
  assert.ok(typeof render === 'function');
  const html: unknown = render(
    OAuthConsentView({
      facts,
      access: 'read',
      busy: false,
      error: '',
      onAccess: () => {},
      onAnswer: () => {},
    }),
  );
  assert.ok(typeof html === 'string');
  return html;
}

try {
  await test('an absent session signs in with the signed request and reaches consent and the client', async () => {
    const id = await register();
    const start = await app.inject({ url: authorization(id) });
    assert.equal(start.statusCode, 302, start.body);
    const signIn = new URL(String(start.headers.location), config.origin);
    assert.equal(signIn.pathname, oauthSignInRoute);
    for (const url of [
      `${oauthSignInRoute}${signIn.search}`,
      oauthConsentRoute,
    ]) {
      const page = await app.inject({ url });
      assert.equal(page.statusCode, 200);
      assert.match(page.headers['content-type'] ?? '', /text\/html/);
      assert.match(page.body, /id="root"/);
    }
    const next = await signInWithPassword({
      body: { email, password, oauth_query: signIn.search.slice(1) },
      headers: { origin: config.origin },
    });
    assert.equal(next.response?.status, 200, JSON.stringify(next.error));
    assert.ok(next.response);
    assert.ok(next.data);
    assert.equal(next.data.redirect, true);
    assert.ok(next.data.url);
    assert.equal('token' in next.data, false);
    cookie = next.response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const consent = new URL(next.data.url, config.origin);
    assert.equal(consent.pathname, oauthConsentRoute);
    const page = await app.inject({
      url: `${consent.pathname}${consent.search}`,
      headers: { cookie },
    });
    assert.equal(page.statusCode, 200);
    const request = oauthRequest(consent.search);
    assert.ok(request);
    const client = await getOAuthClient({
      query: { client_id: request.clientId },
      headers: { cookie },
    });
    assert.ok(client.data);
    const facts = oauthConsentFacts(request, client.data);
    assert.ok(facts);
    assert.equal(facts.clientHost, null);
    assert.equal(facts.redirectHost, '127.0.0.1:49152');
    const html = await markup(facts);
    assert.match(html, /The client calls itself/);
    assert.match(html, /Not verified/);
    assert.match(html, /&lt;img/);
    assert.doesNotMatch(html, /<img|openai\.com|oauth-state/);
    assert.match(html, /Your answer goes to an app on this computer\./);
    assert.match(html, /<option value="read" selected="">Read only/);
    assert.match(html, />Allow</);
    assert.match(html, />Deny</);
    const answer = await giveOAuthConsent({
      headers: { cookie, origin: config.origin },
      body: {
        accept: true,
        oauth_query: request.query,
        scope: oauthAcceptedScope(request, 'read'),
      },
    });
    assert.equal(answer.response?.status, 200, JSON.stringify(answer.error));
    assert.ok(answer.data);
    const redirect = new URL(answer.data.url);
    assert.equal(redirect.origin, new URL(callback).origin);
    assert.equal(redirect.searchParams.get('state'), 'one + two & three');
    assert.equal(redirect.searchParams.get('iss'), `${config.origin}/api/auth`);
    const code = redirect.searchParams.get('code');
    assert.ok(code);
    const token = await exchangeOAuthToken({
      body: {
        grant_type: 'authorization_code',
        client_id: id,
        code,
        code_verifier: verifier,
        redirect_uri: callback,
        resource,
      },
    });
    assert.equal(token.response?.status, 200, JSON.stringify(token.error));
    assert.equal(token.data?.scope, 'notes:read offline_access');
  });

  await test('CIMD identity comes from its document host, with markup kept as text', async () => {
    const id = 'https://metadata.example/client.json';
    const request = await consentRequest(id);
    const client = await getOAuthClient({
      query: { client_id: id },
      headers: { cookie },
    });
    assert.ok(client.data);
    const facts = oauthConsentFacts(request, client.data);
    assert.ok(facts);
    assert.equal(facts.clientHost, 'metadata.example');
    const html = await markup(facts);
    assert.match(html, /metadata\.example/);
    assert.match(html, /&lt;img/);
    assert.doesNotMatch(html, /Not verified|<img|openai\.com/);
    const denied = await giveOAuthConsent({
      body: { accept: false, oauth_query: request.query },
      headers: { cookie, origin: config.origin },
    });
    assert.equal(denied.response?.status, 200);
    assert.ok(denied.data);
    const answer = new URL(denied.data.url);
    assert.equal(answer.searchParams.get('error'), 'access_denied');
    assert.equal(answer.searchParams.get('code'), null);
    assert.equal(answer.searchParams.get('state'), 'one + two & three');
  });

  await test('read-only requests offer no write choice and explicit write consent keeps write', async () => {
    const id = await register('Read client');
    const request = await consentRequest(id, 'notes:read');
    const client = await getOAuthClient({
      query: { client_id: id },
      headers: { cookie },
    });
    assert.ok(client.data);
    const facts = oauthConsentFacts(request, client.data);
    assert.ok(facts);
    assert.doesNotMatch(await markup(facts), /<select|Read and write/);
    const write = await consentRequest(id);
    const answer = await giveOAuthConsent({
      body: {
        accept: true,
        oauth_query: write.query,
        scope: oauthAcceptedScope(write, 'write'),
      },
      headers: { cookie, origin: config.origin },
    });
    assert.equal(answer.response?.status, 200);
    assert.ok(answer.data);
    const code = new URL(answer.data.url).searchParams.get('code');
    assert.ok(code);
    const token = await exchangeOAuthToken({
      body: {
        grant_type: 'authorization_code',
        client_id: id,
        code,
        code_verifier: verifier,
        redirect_uri: callback,
        resource,
      },
    });
    assert.equal(token.data?.scope, 'notes:read notes:write offline_access');
  });

  await test('a tampered signed query cannot continue or give consent', async () => {
    const id = await register();
    const start = await app.inject({ url: authorization(id) });
    const query = new URL(
      String(start.headers.location),
      config.origin,
    ).search.slice(1);
    const tampered = new URLSearchParams(query);
    tampered.set('redirect_uri', 'https://evil.example/callback');
    const next = await continueOAuthAuthorization({
      body: { oauth_query: tampered.toString(), selected: true },
      headers: { cookie, origin: config.origin },
    });
    assert.equal(next.data, undefined);
    assert.ok((next.response?.status ?? 0) >= 400);
    const request = await consentRequest(id);
    const altered = new URLSearchParams(request.query);
    altered.set('scope', 'notes:read');
    const answer = await giveOAuthConsent({
      body: { accept: true, oauth_query: altered.toString() },
      headers: { cookie, origin: config.origin },
    });
    assert.equal(answer.data, undefined);
    assert.ok((answer.response?.status ?? 0) >= 400);
    const grants = await admin.query<{ count: number }>(
      'select count(*)::int as count from auth_oauth_consent where client_id=$1',
      [id],
    );
    assert.equal(grants[0]?.count, 0);
  });

  await test('continuation without the selected confirmation is an OAuth contract refusal', async () => {
    const id = await register();
    const request = await consentRequest(id);
    for (const body of [
      { oauth_query: request.query },
      { oauth_query: request.query, selected: false },
      { oauth_query: request.query, selected: true, created: true },
      { oauth_query: request.query, selected: true, postLogin: true },
    ]) {
      const answer = await app.inject({
        method: 'POST',
        url: '/api/auth/oauth2/continue',
        headers: { cookie, origin: config.origin },
        payload: body,
      });
      assert.equal(answer.statusCode, 400, answer.body);
      assert.deepEqual(answer.json(), { error: 'invalid_request' });
    }
  });

  for (const parameter of ['prompt', 'max_age']) {
    await test(`a fresh sign-in satisfies ${parameter} and returns consent to the client`, async () => {
      const id = await register('Fresh sign-in client');
      const url = new URL(authorization(id), config.origin);
      url.searchParams.set(
        parameter,
        parameter === 'prompt' ? 'login consent' : '0',
      );
      const start = await app.inject({
        url: `${url.pathname}${url.search}`,
        headers: { cookie },
      });
      assert.equal(start.statusCode, 302, start.body);
      const loginPage = new URL(String(start.headers.location), config.origin);
      assert.equal(loginPage.pathname, oauthSignInRoute);
      const login = await signInWithPassword({
        body: { email, password, oauth_query: loginPage.search.slice(1) },
        headers: { origin: config.origin },
      });
      assert.equal(login.response?.status, 200);
      assert.ok(login.response);
      cookie = login.response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
      assert.ok(login.data?.url);
      const consent = new URL(login.data.url, config.origin);
      assert.equal(
        consent.pathname,
        oauthConsentRoute,
        'fresh sign-in must not loop to the login page',
      );
      const answer = await giveOAuthConsent({
        body: {
          accept: true,
          oauth_query: consent.search.slice(1),
          scope: 'notes:read',
        },
        headers: { cookie, origin: config.origin },
      });
      assert.equal(answer.response?.status, 200, JSON.stringify(answer.error));
      assert.ok(answer.data);
      const destination = new URL(answer.data.url, config.origin);
      assert.equal(
        destination.origin,
        new URL(callback).origin,
        'consent must not loop to the login page',
      );
      assert.ok(destination.searchParams.get('code'));
    });
  }

  await test('create refuses before sign-in through the validated client callback', async () => {
    const id = await register('Unsupported account creation');
    const before = await admin.query(
      `select (select count(*) from auth_session) as sessions,
              (select count(*) from auth_oauth_consent) as consents,
              (select count(*) from auth_verification) as codes`,
    );
    for (const clientId of [id, 'https://client.notes.invalid/create.json']) {
      for (const sessionCookie of ['', cookie]) {
        for (const prompt of [
          'create',
          'login create consent',
          ' create  ',
          'create\n',
          ...[
            ' ',
            '\t',
            '\n',
            '\r',
            '\v',
            '\f',
            '\u00a0',
            '\u1680',
            '\u2000',
            '\u2001',
            '\u2002',
            '\u2003',
            '\u2004',
            '\u2005',
            '\u2006',
            '\u2007',
            '\u2008',
            '\u2009',
            '\u200a',
            '\u2028',
            '\u2029',
            '\u202f',
            '\u205f',
            '\u3000',
            '\ufeff',
          ].flatMap((space) => [
            `${space}create${space}`,
            `login ${space}create consent`,
          ]),
        ]) {
          const url = new URL(authorization(clientId), config.origin);
          url.searchParams.set('prompt', prompt);
          const answer = await app.inject({
            url: `${url.pathname}${url.search}`,
            headers: { cookie: sessionCookie },
          });
          assert.equal(answer.statusCode, 302, answer.body);
          const destination = new URL(
            String(answer.headers.location),
            config.origin,
          );
          assert.equal(destination.origin, new URL(callback).origin);
          assert.equal(destination.pathname, new URL(callback).pathname);
          assert.equal(
            destination.searchParams.get('error'),
            'invalid_request',
          );
          assert.equal(
            destination.searchParams.get('state'),
            'one + two & three',
          );
          assert.equal(
            destination.searchParams.get('iss'),
            `${config.origin}/api/auth`,
          );
          assert.equal(destination.searchParams.has('code'), false);
          assert.equal(answer.headers['set-cookie'], undefined);
          assert.equal(
            destination.searchParams.get('error_description'),
            'Account creation is not supported.',
          );
        }
      }
    }
    for (const mode of ['query', 'fragment']) {
      const url = new URL(authorization(id), config.origin);
      url.searchParams.set('prompt', 'create');
      url.searchParams.set('response_mode', mode);
      const answer = await app.inject({
        url: `${url.pathname}${url.search}`,
        headers: { accept: 'application/json' },
      });
      assert.equal(answer.statusCode, 200, answer.body);
      assert.equal(answer.json().redirect, true);
      const destination = new URL(answer.json().url);
      assert.equal(destination.origin, new URL(callback).origin);
      const fields =
        mode === 'fragment'
          ? new URLSearchParams(destination.hash.slice(1))
          : destination.searchParams;
      assert.equal(fields.get('error'), 'invalid_request');
      assert.equal(fields.get('state'), 'one + two & three');
      assert.equal(fields.get('iss'), `${config.origin}/api/auth`);
      assert.equal(
        fields.get('error_description'),
        'Account creation is not supported.',
      );
    }
    for (const change of [
      { field: 'client_id', value: 'unknown-client' },
      {
        field: 'redirect_uri',
        value: 'https://unregistered.notes.invalid/callback',
      },
    ]) {
      const url = new URL(authorization(id), config.origin);
      url.searchParams.set('prompt', 'create');
      url.searchParams.set(change.field, change.value);
      const answer = await app.inject({ url: `${url.pathname}${url.search}` });
      assert.equal(answer.statusCode, 302, answer.body);
      const destination = new URL(
        String(answer.headers.location),
        config.origin,
      );
      assert.equal(destination.origin, config.origin);
      assert.notEqual(destination.pathname, oauthSignInRoute);
    }
    for (const prompt of ['creates', 'Create']) {
      const url = new URL(authorization(id), config.origin);
      url.searchParams.set('prompt', prompt);
      const answer = await app.inject({ url: `${url.pathname}${url.search}` });
      assert.equal(answer.statusCode, 302, answer.body);
      const destination = new URL(
        String(answer.headers.location),
        config.origin,
      );
      assert.equal(destination.origin, new URL(callback).origin);
      assert.equal(destination.searchParams.get('error'), 'invalid_request');
      assert.equal(destination.searchParams.get('state'), 'one + two & three');
      assert.equal(
        destination.searchParams.get('iss'),
        `${config.origin}/api/auth`,
      );
      assert.match(
        destination.searchParams.get('error_description') ?? '',
        /unsupported prompt value/,
      );
      assert.notEqual(
        destination.searchParams.get('error_description'),
        'Account creation is not supported.',
      );
    }
    const after = await admin.query(
      `select (select count(*) from auth_session) as sessions,
              (select count(*) from auth_oauth_consent) as consents,
              (select count(*) from auth_verification) as codes`,
    );
    assert.deepEqual(after, before);
    const metadata = await app.inject({
      url: '/.well-known/oauth-authorization-server/api/auth',
    });
    assert.equal(metadata.statusCode, 200);
    assert.equal('prompt_values_supported' in metadata.json(), false);
  });

  await test('a consent page whose session ended returns through the plain login page', async () => {
    const id = await register();
    const request = await consentRequest(id);
    const step = oauthPageStep(
      { status: 'signed-out', account: null },
      oauthConsentRoute,
      `?${request.query}`,
    );
    assert.equal(step.kind, 'sign-in');
    if (step.kind !== 'sign-in') throw new Error('Expected login.');
    assert.equal((await app.inject({ url: step.address })).statusCode, 200);
    assert.equal(
      returnOf(new URL(step.address, config.origin).search),
      `${oauthConsentRoute}?${request.query}`,
    );
    const login = await signInWithPassword({
      body: { email, password },
      headers: { origin: config.origin },
    });
    assert.equal(login.response?.status, 200);
    assert.ok(login.data);
    assert.equal(login.data.redirect, false);
    assert.ok(login.data.user);
    assert.equal('token' in login.data, false);
    assert.ok(login.response);
    cookie = login.response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const answer = await giveOAuthConsent({
      body: { accept: false, oauth_query: request.query },
      headers: { cookie, origin: config.origin },
    });
    assert.equal(answer.response?.status, 200);
  });

  await test('a tampered OAuth sign-in is a problem refusal and makes no session', async () => {
    const id = await register();
    const start = await app.inject({ url: authorization(id) });
    const query = new URL(String(start.headers.location), config.origin)
      .searchParams;
    query.set('scope', 'notes:read');
    const before = await admin.query<{ count: number }>(
      'select count(*)::int as count from auth_session',
    );
    const answer = await signInWithPassword({
      body: { email, password, oauth_query: query.toString() },
      headers: { origin: config.origin },
    });
    assert.equal(answer.response?.status, 400);
    assert.match(
      answer.response?.headers.get('content-type') ?? '',
      /application\/problem\+json/,
    );
    assert.equal(answer.error?.code, 'oauth_request_invalid');
    assert.deepEqual(answer.response?.headers.getSetCookie(), []);
    const after = await admin.query<{ count: number }>(
      'select count(*)::int as count from auth_session',
    );
    assert.deepEqual(after, before);
    const plain = await signInWithPassword({
      body: { email, password: 'wrong-password' },
      headers: { origin: config.origin },
    });
    assert.equal(plain.response?.status, 401);
    assert.equal(plain.error?.code, 'unauthenticated');
  });

  await test('a signed request that expires during a reset makes no session', async (context) => {
    const id = await register();
    const start = await app.inject({ url: authorization(id) });
    const query = new URL(
      String(start.headers.location),
      config.origin,
    ).search.slice(1);
    const before = await admin.query<{ count: number }>(
      'select count(*)::int as count from auth_session',
    );
    context.mock.timers.enable({
      apis: ['Date'],
      now: Date.now() + 20 * 60 * 1000,
    });
    const answer = await signInWithPassword({
      body: { email, password, oauth_query: query },
      headers: { origin: config.origin },
    });
    assert.equal(answer.response?.status, 400);
    assert.equal(answer.error?.code, 'oauth_request_invalid');
    assert.deepEqual(answer.response?.headers.getSetCookie(), []);
    const after = await admin.query<{ count: number }>(
      'select count(*)::int as count from auth_session',
    );
    assert.deepEqual(after, before);
  });

  await test('the locked account refusal holds at the page and at the served consent boundary', async () => {
    const id = await register();
    const request = await consentRequest(id);
    // Keep an enabled administrator so the standing write can make the owner a member.
    await admin.query(
      "insert into accounts(id,installation_role,limit_bytes) values(gen_random_uuid(),'administrator',10000000)",
    );
    await admin.query(
      "update accounts set standing='locked',installation_role='member' where id=(select account_id from account_identities where auth_user_id=(select id from auth_user where email=$1))",
      [email],
    );
    const account = await getAccount({ headers: { cookie } });
    assert.ok(account.data);
    const step = oauthPageStep(
      { status: 'signed-in', account: account.data },
      oauthConsentRoute,
      `?${request.query}`,
    );
    assert.equal(step.kind, 'locked');
    if (step.kind !== 'locked') throw new Error('Expected the locked refusal.');
    assert.match(step.message, /administrator/);
    const answer = await giveOAuthConsent({
      body: { accept: true, oauth_query: request.query },
      headers: { cookie, origin: config.origin },
    });
    assert.equal(answer.response?.status, 403);
    assert.equal(answer.data, undefined);
  });

  await test('the built routes use the pure decisions and generated operations', async () => {
    const route = await readFile(
      resolve(root, 'apps/web/dist/router.js'),
      'utf8',
    );
    const pages = await readFile(
      resolve(root, 'apps/web/dist/features/oauth/oauth-pages.js'),
      'utf8',
    );
    assert.match(route, /path: oauthSignInRoute/);
    assert.match(route, /path: oauthConsentRoute/);
    assert.match(pages, /oauthPageStep/);
    assert.doesNotMatch(pages, /continueOAuthAuthorization/);
    assert.match(pages, /oauthQuery: request.query/);
    assert.match(pages, /oauth_query: request.query/);
    const login = await readFile(
      resolve(root, 'apps/web/dist/features/accounts/accounts.js'),
      'utf8',
    );
    assert.match(login, /oauth_query: oauthQuery/);
    assert.match(
      login,
      /session.status === 'signed-in' && oauthQuery === undefined/,
    );
    assert.match(login, /to: forgotPasswordRoute/);
    assert.match(login, /oauthResetSentence/);
    assert.match(login, /to: forgotPasswordRoute, children: "Forgot password"/);
  });
} finally {
  await app.close();
  await admin.close();
  await database.destroy();
  await rm(storageRoot, { recursive: true, force: true });
}
