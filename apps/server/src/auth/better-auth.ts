/**
 * Better Auth protocol adapter.
 *
 * This is the one file that translates between Fastify and the Web standard
 * `Request` and `Response` that Better Auth's handler uses. It is listed in
 * the exact protocol-file exemption of `tools/check-boundaries.mjs`, because a
 * maintained protocol library owns its own transport shapes. Every other rule,
 * including package direction and deep imports, still applies here.
 *
 * The configuration below is the pinned identity policy of the deployment:
 *
 *   * Email and password sign-in, with public registration disabled. Only the
 *     one-time bootstrap command and an invitation create an account.
 *   * Secure, HttpOnly, SameSite cookies, a session that expires, and a
 *     session that refreshes while it is used.
 *   * Origin and Fetch Metadata checks against the configured origin, which is
 *     the only trusted origin.
 *   * Password hashing and token lifetime owned by Better Auth.
 *   * An administrator configured OpenID Connect provider through the generic
 *     OAuth plugin: discovery, authorization code with PKCE, state, nonce, and
 *     a verified ID token signature, issuer, and audience. The account key is
 *     the issuer and the subject.
 *   * No automatic account linking. Two identities with the same address are
 *     two accounts, so a provider that reports a familiar address can never
 *     take over a local account.
 *   * SMTP password recovery when a transport is configured, and the operator
 *     recovery command when none is.
 */
import { Buffer } from 'node:buffer';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { FastifyReply, FastifyRequest } from 'fastify';
import pg from 'pg';
import {
  authAccount,
  authSession,
  authUser,
  authVerification,
} from '@notesapp/storage-server';
import type { ServerConfig } from '../config.ts';
import type { ProblemCode } from '../http/problem.ts';
import { createProblem, problemMediaType } from '../http/problem.ts';
import type { ProtocolAdapter } from '../http/register.ts';
import type { MailTransport } from './mail.ts';

/** Base path of every Better Auth route. */
export const authBasePath = '/api/auth';

/**
 * Marker value that the contract fragment writes on every Better Auth
 * operation. `tools/sdk-codegen/src/auth-contract.ts` writes the same value.
 */
export const betterAuthProtocol = 'better-auth';

/** The identity of the configured OpenID Connect provider. */
export const oidcProviderId = 'oidc';

/**
 * The exact paths that the Better Auth handler serves.
 *
 * `register.ts` mounts this list and nothing else, so a Better Auth release
 * that adds an endpoint cannot widen this deployment's surface without a
 * reviewed change. The contract fragment in `tools/sdk-codegen/src/
 * auth-contract.ts` describes the JSON endpoints of this same list; the two
 * browser navigation endpoints carry no contract operation, because a redirect
 * is not a generated call.
 */
export const authRoutes: readonly {
  readonly method: 'GET' | 'POST';
  readonly path: string;
}[] = [
  { method: 'POST', path: `${authBasePath}/sign-in/email` },
  { method: 'POST', path: `${authBasePath}/sign-in/social` },
  { method: 'POST', path: `${authBasePath}/sign-out` },
  { method: 'GET', path: `${authBasePath}/get-session` },
  { method: 'POST', path: `${authBasePath}/request-password-reset` },
  { method: 'POST', path: `${authBasePath}/reset-password` },
  // Browser navigation. The provider redirects here with the authorization
  // code, and the reset link opens here before the application screen.
  { method: 'GET', path: `${authBasePath}/callback/:id` },
  { method: 'GET', path: `${authBasePath}/reset-password/:token` },
  { method: 'GET', path: `${authBasePath}/error` },
];

/** What the auth instance needs besides the validated configuration. */
export type AuthOptions = {
  /** Sends the password recovery message, or `null` when none is configured. */
  readonly mail: MailTransport | null;
  /** Permits sign-up through the email and password endpoint. */
  readonly allowSignUp?: boolean;
};

/**
 * Builds the configured instance over an open pool.
 *
 * The exact option object decides the type of the instance, so the type is
 * inferred from this function rather than written out.
 */
function buildAuth(
  config: ServerConfig,
  options: AuthOptions,
  database: ReturnType<typeof drizzle>,
) {
  const mail = options.mail;
  const oidc = config.oidc;
  const secure = config.origin.startsWith('https://');
  return betterAuth({
    appName: 'notesapp',
    baseURL: config.origin,
    basePath: authBasePath,
    secret: config.authSecret,
    telemetry: { enabled: false },
    database: drizzleAdapter(database, {
      provider: 'pg',
      transaction: true,
      schema: {
        user: authUser,
        session: authSession,
        account: authAccount,
        verification: authVerification,
      },
    }),
    // The configured origin is the only trusted origin. Better Auth checks the
    // Origin header and the Fetch Metadata headers of every cookie
    // authenticated write against this list, and it rejects a redirect target
    // outside it.
    trustedOrigins: [config.origin],
    emailAndPassword: {
      // An installation that requires the provider has no password sign-in at
      // all, so a local password cannot be used to bypass the provider.
      enabled: !config.oidcRequired,
      disableSignUp: options.allowSignUp !== true,
      minPasswordLength: 12,
      maxPasswordLength: 512,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      ...(mail === null
        ? {}
        : {
            sendResetPassword: async (data: {
              user: { email: string };
              url: string;
            }): Promise<void> => {
              await mail.send({
                to: data.user.email,
                subject: 'Reset your notesapp password',
                text: [
                  'Open this link to choose a new password.',
                  data.url,
                  'The link expires in one hour. Ignore this message if you',
                  'did not ask for a new password.',
                ].join('\n'),
              });
            },
          }),
    },
    session: {
      expiresIn: config.sessionMaxAgeSeconds,
      // The session is extended while it is used, so an active browser keeps
      // working and an idle one expires.
      updateAge: Math.max(60, Math.floor(config.sessionMaxAgeSeconds / 7)),
    },
    account: {
      accountLinking: {
        // Two identities are never joined because their addresses match. A
        // provider identity is keyed by issuer and subject only.
        enabled: false,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        trustedProviders: [],
      },
    },
    advanced: {
      useSecureCookies: secure,
      cookiePrefix: 'notesapp',
      cookies: { session_token: { name: 'notesapp_session' } },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure,
      },
    },
    plugins:
      oidc === null
        ? []
        : [
            genericOAuth({
              config: [
                {
                  providerId: oidcProviderId,
                  clientId: oidc.clientId,
                  clientSecret: oidc.clientSecret,
                  discoveryUrl: `${oidc.issuerUrl}/.well-known/openid-configuration`,
                  scopes: ['openid', 'profile', 'email'],
                  responseType: 'code',
                  pkce: true,
                  // Without a verified ID token the provider identity would be
                  // an unverified claim, so registration stops instead.
                  requireIdTokenVerification: true,
                },
              ],
            }),
          ],
  });
}

/** The configured Better Auth instance of this deployment. */
export type NotesappAuth = ReturnType<typeof buildAuth>;

/** One Better Auth instance and the pool it owns. */
export type AuthHandle = {
  /** The configured instance. */
  readonly auth: NotesappAuth;
  /** Closes the connection pool of the identity tables. */
  close(): Promise<void>;
};

/**
 * Builds the configured Better Auth instance.
 *
 * The instance owns its own connection pool. That pool never sets a
 * transaction identity, which is exactly what the row policies of the identity
 * tables expect: only an identity free connection may read a session row, a
 * password hash, or a reset token.
 */
export function createAuth(
  config: ServerConfig,
  options: AuthOptions,
): AuthHandle {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
  return {
    auth: buildAuth(config, options, drizzle({ client: pool })),
    close: async (): Promise<void> => {
      await pool.end();
    },
  };
}

/** Header names that never travel to the protocol handler. */
const droppedRequestHeaders = new Set(['content-length', 'connection']);

/**
 * The headers of a Fastify request as a Web standard `Headers` object.
 *
 * The identity adapter passes them to `auth.api.getSession`, which reads the
 * session cookie from them.
 */
export function toRequestHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (droppedRequestHeaders.has(name)) continue;
    if (typeof value === 'string') headers.append(name, value);
    else if (Array.isArray(value))
      for (const entry of value) headers.append(name, entry);
  }
  return headers;
}

/**
 * Converts a Fastify request into the Web standard request that Better Auth
 * reads.
 *
 * The body arrives as raw bytes, because `register.ts` gives the auth routes
 * their own content type parser. Re-serializing a parsed body would change it,
 * and Better Auth signs and checks some of these bodies.
 */
export function toWebRequest(origin: string, request: FastifyRequest): Request {
  const url = new URL(request.url, origin);
  const headers = toRequestHeaders(request);
  const method = request.method.toUpperCase();
  const body = request.body;
  const carries =
    method !== 'GET' && method !== 'HEAD' && Buffer.isBuffer(body);
  return new Request(url, {
    method,
    headers,
    ...(carries ? { body: new Uint8Array(body) } : {}),
  });
}

/** Header names that Fastify sets itself when the reply is written. */
const droppedResponseHeaders = new Set(['content-length']);

/**
 * The stable application error code of a refused protocol request.
 *
 * Better Auth answers a failure with its own JSON body. The deployment answers
 * RFC 9457 problem details everywhere, so the status becomes one of the
 * documented codes and the library's message is dropped: it can name an
 * address, and no failure answer should confirm that one exists.
 */
export function authProblemCode(status: number): ProblemCode {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 413) return 'payload_too_large';
  if (status === 415) return 'unsupported_media_type';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'internal_error';
  return 'invalid_request';
}

/** What a problem answer needs besides the status. */
export type ProblemContext = {
  readonly instance: string;
  readonly requestId: string;
};

/**
 * Writes a Web standard response through a Fastify reply.
 *
 * A refused request is rewritten as problem details. A redirect and every
 * successful answer travel unchanged, so the protocol keeps working.
 */
export async function sendWebResponse(
  reply: FastifyReply,
  response: Response,
  context: ProblemContext,
): Promise<void> {
  const cookies = response.headers.getSetCookie();
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === 'set-cookie') continue;
    if (droppedResponseHeaders.has(name.toLowerCase())) continue;
    reply.header(name, value);
  }
  if (cookies.length > 0) reply.header('set-cookie', cookies);
  if (response.status >= 400) {
    const code = authProblemCode(response.status);
    reply.header('content-type', `${problemMediaType}; charset=utf-8`);
    await reply.status(response.status).send(
      JSON.stringify(
        createProblem({
          code,
          status: response.status,
          detail: 'The authentication endpoint refused the request.',
          instance: context.instance,
          requestId: context.requestId,
        }),
      ),
    );
    return;
  }
  const body = Buffer.from(await response.arrayBuffer());
  await reply.status(response.status).send(body);
}

/**
 * The protocol adapter that `register.ts` mounts.
 *
 * It serves exactly the routes of `authRoutes`, and startup fails when a
 * contract operation marked `better-auth` is not one of them.
 */
export function createAuthProtocol(
  config: ServerConfig,
  auth: NotesappAuth,
): ProtocolAdapter {
  return {
    protocol: betterAuthProtocol,
    routes: authRoutes,
    handler: async (request, reply): Promise<void> => {
      const response = await auth.handler(toWebRequest(config.origin, request));
      await sendWebResponse(reply, response, {
        instance: request.url.split('?')[0] ?? request.url,
        requestId: request.id,
      });
    },
  };
}
