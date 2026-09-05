/**
 * A small OpenID Connect provider for the identity integration tests.
 *
 * The provider is a real listening service, because the server performs
 * discovery, key retrieval, and the token exchange over HTTP through its own
 * protocol library. It serves a discovery document, a JWKS with one test RSA
 * key, an authorization endpoint that redirects with an authorization code,
 * and a token endpoint that issues a signed ID token.
 *
 * The key pair is created for each run and never leaves the test process. The
 * provider can also be told to answer with a wrong nonce, a wrong issuer, a
 * wrong audience, or a broken signature, so the tests can prove that each of
 * those checks actually rejects a sign-in.
 */
import { Buffer } from 'node:buffer';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

/** The failure that the provider produces on its next token answer. */
export type ProviderMode =
  | 'valid'
  | 'wrong-nonce'
  | 'wrong-issuer'
  | 'wrong-audience'
  | 'bad-signature'
  | 'expired-token';

/** The identity that the provider reports for the next sign-in. */
export type ProviderIdentity = {
  readonly subject: string;
  readonly email: string;
  readonly name: string;
};

/** A listening test provider and the calls that steer it. */
export type TestIdentityProvider = {
  /** Issuer URL, which is also the discovery base. */
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** The instance, so a test can follow a redirect without a real browser. */
  readonly app: FastifyInstance;
  /** Chooses what the next token answer contains. */
  setMode(mode: ProviderMode): void;
  /** Chooses the identity that the next sign-in reports. */
  setIdentity(identity: ProviderIdentity): void;
  close(): Promise<void>;
};

/** One issued authorization code and what it was issued for. */
type PendingCode = {
  readonly nonce: string | null;
  readonly challenge: string | null;
  readonly redirectUri: string;
  readonly identity: ProviderIdentity;
};

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

/** Reads one query value without trusting the parsed shape. */
function queryValue(query: unknown, key: string): string | null {
  if (query === null || typeof query !== 'object') return null;
  const record: Record<string, unknown> = Object.fromEntries(
    Object.entries(query),
  );
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

/** Starts the provider on an ephemeral loopback port. */
export async function startIdentityProvider(): Promise<TestIdentityProvider> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const keyId = 'notesapp-test-key';
  const clientId = 'notesapp-test-client';
  const clientSecret = 'notesapp-test-client-secret';
  let mode: ProviderMode = 'valid';
  let identity: ProviderIdentity = {
    subject: 'subject-1',
    email: 'oidc@notes.invalid',
    name: 'Oidc Person',
  };
  const codes = new Map<string, PendingCode>();
  let issued = 0;

  const app = Fastify({ logger: false });
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body: string, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body).entries()));
    },
  );

  let issuer = '';

  app.get('/.well-known/openid-configuration', (_request, reply) => {
    reply.header('content-type', 'application/json').send({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'profile', 'email'],
      token_endpoint_auth_methods_supported: [
        'client_secret_post',
        'client_secret_basic',
      ],
    });
  });

  app.get('/jwks', (_request, reply) => {
    reply
      .header('content-type', 'application/json')
      .send({ keys: [{ ...jwk, kid: keyId, alg: 'RS256', use: 'sig' }] });
  });

  app.get('/authorize', (request, reply) => {
    const redirectUri = queryValue(request.query, 'redirect_uri');
    const state = queryValue(request.query, 'state');
    if (redirectUri === null) {
      reply.status(400).send({ error: 'invalid_request' });
      return;
    }
    issued += 1;
    const code = `code-${String(issued)}`;
    codes.set(code, {
      nonce: queryValue(request.query, 'nonce'),
      challenge: queryValue(request.query, 'code_challenge'),
      redirectUri,
      identity,
    });
    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    if (state !== null) target.searchParams.set('state', state);
    reply.redirect(target.toString(), 302);
  });

  app.post('/token', (request, reply) => {
    const body = request.body;
    const read = (key: string): string | null => queryValue(body, key);
    const code = read('code');
    const pending = code === null ? undefined : codes.get(code);
    if (pending === undefined) {
      reply.status(400).send({ error: 'invalid_grant' });
      return;
    }
    codes.delete(code ?? '');
    // Proof key for code exchange. A missing or wrong verifier is refused, so
    // a stolen code alone cannot be exchanged.
    if (pending.challenge !== null) {
      const verifier = read('code_verifier');
      const expected =
        verifier === null
          ? ''
          : createHash('sha256').update(verifier).digest('base64url');
      if (expected !== pending.challenge) {
        reply.status(400).send({ error: 'invalid_grant' });
        return;
      }
    }
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: mode === 'wrong-issuer' ? 'https://other.invalid' : issuer,
      sub: pending.identity.subject,
      aud: mode === 'wrong-audience' ? 'another-client' : clientId,
      exp: mode === 'expired-token' ? now - 300 : now + 300,
      iat: mode === 'expired-token' ? now - 600 : now,
      email: pending.identity.email,
      email_verified: true,
      name: pending.identity.name,
    };
    if (pending.nonce !== null)
      claims.nonce =
        mode === 'wrong-nonce' ? 'a-different-nonce' : pending.nonce;
    const header = base64url(
      JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: keyId }),
    );
    const payload = base64url(JSON.stringify(claims));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const signature =
      mode === 'bad-signature'
        ? base64url('not-a-signature')
        : signer.sign(privateKey).toString('base64url');
    reply.header('content-type', 'application/json').send({
      access_token: `access-${pending.identity.subject}`,
      token_type: 'Bearer',
      expires_in: 300,
      scope: 'openid profile email',
      id_token: `${header}.${payload}.${signature}`,
    });
  });

  app.get('/userinfo', (_request, reply) => {
    reply.header('content-type', 'application/json').send({
      sub: identity.subject,
      email: identity.email,
      email_verified: true,
      name: identity.name,
    });
  });

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address: string | AddressInfo | null = app.server.address();
  if (address === null || typeof address === 'string') {
    await app.close();
    throw new Error('The identity provider did not bind a TCP port.');
  }
  issuer = `http://127.0.0.1:${String(address.port)}`;

  return {
    issuer,
    clientId,
    clientSecret,
    app,
    setMode: (next: ProviderMode): void => {
      mode = next;
    },
    setIdentity: (next: ProviderIdentity): void => {
      identity = next;
    },
    close: async (): Promise<void> => {
      await app.close();
    },
  };
}
