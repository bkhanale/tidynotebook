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
import type { FastifyRequest } from 'fastify';
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
import type { ProtocolAdapter, ProtocolResult } from '../http/register.ts';
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

/** One record that the protocol library wants to write. */
export type AuthLogRecord = {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
};

/** What the auth instance needs besides the validated configuration. */
export type AuthOptions = {
  /** Sends the password recovery message, or `null` when none is configured. */
  readonly mail: MailTransport | null;
  /**
   * Permits sign-up through the email and password endpoint.
   *
   * The running server never sets this. Only the one-time bootstrap command
   * and the invitation sign-up path build such an instance, and neither mounts
   * the sign-up route.
   */
  readonly allowSignUp?: boolean;
  /**
   * Receives the protocol library's own log records.
   *
   * The composition points this at the Fastify logger, so
   * `NOTESAPP_LOG_LEVEL` governs it and nothing writes to the console.
   */
  readonly log?: (record: AuthLogRecord) => void;
};

/** The protocol library's log level for one configured application level. */
function authLogLevel(level: ServerConfig['logLevel']): {
  disabled: boolean;
  level: 'debug' | 'info' | 'warn' | 'error';
} {
  if (level === 'silent') return { disabled: true, level: 'error' };
  if (level === 'debug') return { disabled: false, level: 'debug' };
  if (level === 'info') return { disabled: false, level: 'info' };
  if (level === 'warn') return { disabled: false, level: 'warn' };
  return { disabled: false, level: 'error' };
}

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
  const logging = authLogLevel(config.logLevel);
  const sink = options.log;
  return betterAuth({
    appName: 'notesapp',
    // The protocol library writes to the application log, so its records carry
    // the configured level and nothing reaches the console. The library's own
    // extra arguments are dropped: they can carry an address or a token.
    logger: {
      disabled: logging.disabled || sink === undefined,
      disableColors: true,
      level: logging.level,
      log: (level, message): void => {
        sink?.({ level, message });
      },
    },
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
 * The instance owns its own connection pool, and that pool connects as the
 * identity role. That role holds every right on the four Better Auth tables
 * and no right anywhere else, and the runtime role holds no right on those
 * four tables. A session token, a password hash, a reset token, and a provider
 * token are therefore unreachable from the application's own connection,
 * whatever identity it sets.
 */
export function createAuth(
  config: ServerConfig,
  options: AuthOptions,
): AuthHandle {
  const pool = new pg.Pool({
    connectionString: config.authDatabaseUrl,
    max: 5,
  });
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
const droppedResponseHeaders = new Set(['content-length', 'content-encoding']);

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

/**
 * Removes the session token from a get-session answer.
 *
 * Better Auth returns the raw session token inside the session object. The
 * browser already holds it in an HttpOnly cookie, so handing the same secret
 * to page script would only widen where it can leak. The contract declares the
 * session without a token, and this is what makes that declaration true.
 */
export function withoutSessionToken(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return value;
  const record: Record<string, unknown> = Object.fromEntries(
    Object.entries(value),
  );
  const session = record.session;
  if (session === null || typeof session !== 'object' || Array.isArray(session))
    return record;
  const stripped: Record<string, unknown> = Object.fromEntries(
    Object.entries(session).filter(([name]) => name !== 'token'),
  );
  return { ...record, session: stripped };
}

/** Reads a JSON answer without trusting that it is JSON. */
function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.trim() === '') return { ok: true, value: undefined };
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

/**
 * The protocol adapter that `register.ts` mounts.
 *
 * It serves exactly the routes of `authRoutes`, and startup fails when a
 * contract operation marked `better-auth` is not one of them. The answer is
 * returned rather than written, so the boundary can validate it against the
 * declared response schema first.
 */
export function createAuthProtocol(
  config: ServerConfig,
  auth: NotesappAuth,
): ProtocolAdapter {
  return {
    protocol: betterAuthProtocol,
    routes: authRoutes,
    handle: async (request): Promise<ProtocolResult> => {
      const response = await auth.handler(toWebRequest(config.origin, request));
      const headers: [string, string][] = [];
      for (const [name, value] of response.headers) {
        if (name.toLowerCase() === 'set-cookie') continue;
        if (droppedResponseHeaders.has(name.toLowerCase())) continue;
        headers.push([name, value]);
      }
      const cookies = response.headers.getSetCookie();
      const mediaType = (response.headers.get('content-type') ?? '')
        .split(';')[0]
        ?.trim()
        .toLowerCase();
      const text = await response.text();
      if (response.status >= 400) {
        return {
          status: response.status,
          mediaType: problemMediaType,
          headers: headers.filter(
            ([name]) => name.toLowerCase() !== 'content-type',
          ),
          cookies,
          body: createProblem({
            code: authProblemCode(response.status),
            status: response.status,
            detail: 'The authentication endpoint refused the request.',
            instance: request.url.split('?')[0] ?? request.url,
            requestId: request.id,
          }),
          bytes: null,
        };
      }
      if (mediaType !== 'application/json') {
        // A redirect and the reference page carry no JSON, so they travel
        // unchanged.
        return {
          status: response.status,
          mediaType:
            mediaType === undefined || mediaType === '' ? '' : mediaType,
          headers,
          cookies,
          body: undefined,
          bytes: Buffer.from(text, 'utf8'),
        };
      }
      const parsed = parseJson(text);
      if (!parsed.ok)
        throw new Error('notesapp: the auth endpoint answered invalid JSON.');
      const strip = request.url.startsWith(`${authBasePath}/get-session`);
      return {
        status: response.status,
        mediaType: 'application/json',
        headers: headers.filter(
          ([name]) => name.toLowerCase() !== 'content-type',
        ),
        cookies,
        body: strip ? withoutSessionToken(parsed.value) : parsed.value,
        bytes: null,
      };
    },
  };
}
