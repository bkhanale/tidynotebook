/**
 * Maps a request to a verified actor.
 *
 * Two transports reach the same core rules. A browser session carries the full
 * role, so its grants are exactly the actions of the current role in every
 * workspace the account belongs to. An agent token carries an explicit scope,
 * so its grants are that scope intersected with the current role. Membership is
 * therefore checked again on every request, and a token can never outlive the
 * role that justified it.
 *
 * An actor is built only through `verifyActor`, so a parsed request object can
 * never be passed where the core expects a verified actor.
 */
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Actor } from '@notesapp/core';
import { sessionGrants, tokenGrants, verifyActor } from '@notesapp/core';
import type { IdentityStoreHandle } from '@notesapp/storage-server';
import type { IdentityResolver } from '../http/register.ts';
import { ForbiddenError, UnauthenticatedError } from '../http/problem.ts';
import { toRequestHeaders, type NotesappAuth } from './better-auth.ts';

/** Which transport proved the identity of a request. */
export type ActorSource = 'session' | 'token';

/** A verified actor and what the transport knows about it. */
export type ResolvedActor = {
  readonly actor: Actor;
  readonly source: ActorSource;
  /** Sign-in address of the account, when a session resolved it. */
  readonly email: string | null;
  /** Display name of the account, when a session resolved it. */
  readonly name: string | null;
};

/** The security scheme name that each transport satisfies. */
const schemeOf: Readonly<Record<ActorSource, string>> = {
  session: 'sessionCookie',
  token: 'agentToken',
};

/** Methods that change no state, so they need no origin check. */
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Actors of the requests that are being served.
 *
 * A weak map keeps the verified actor out of the request object, so no handler
 * can reach it without asking for it and nothing serializes it by accident.
 */
const actors = new WeakMap<FastifyRequest, ResolvedActor>();

/** The verified actor of a request, or undefined for a public operation. */
export function requestActor(
  request: FastifyRequest,
): ResolvedActor | undefined {
  return actors.get(request);
}

/**
 * The verified actor of a guarded operation.
 *
 * The identity hook has already run for such an operation, so a missing actor
 * here is a defect rather than an unauthenticated caller.
 */
export function requireActor(request: FastifyRequest): ResolvedActor {
  const resolved = actors.get(request);
  if (resolved === undefined)
    throw new UnauthenticatedError('This operation needs a verified actor.');
  return resolved;
}

/** The SHA-256 hash of an agent token secret, in lower case hexadecimal. */
export function agentTokenHash(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** The bearer credential of a request, or `null`. */
export function bearerSecret(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/.exec(header.trim());
  return match?.[1] ?? null;
}

/** What the identity adapter needs from the composition. */
export type IdentityDependencies = {
  readonly auth: NotesappAuth;
  readonly identity: IdentityStoreHandle;
  /** Public origin of the deployment, used for the cookie write check. */
  readonly origin: string;
  /** Clock, so a test can prove that an expired token stops working. */
  readonly now?: () => Date;
};

/** The identity adapter of one deployment. */
export type IdentityAdapter = {
  /** The verified actor of a request, or `null` when there is none. */
  resolveActor(request: FastifyRequest): Promise<ResolvedActor | null>;
  /** The hook that `registerOperations` runs before a guarded operation. */
  resolver: IdentityResolver;
};

/**
 * Reads the session of a request.
 *
 * The shape is narrowed by hand, because the session of a Better Auth instance
 * carries whatever its plugins add and the parts that matter here are only the
 * user identity and the address.
 */
function readSessionUser(
  value: unknown,
): { id: string; email: string; name: string } | null {
  if (value === null || typeof value !== 'object') return null;
  const record: Record<string, unknown> = Object.fromEntries(
    Object.entries(value),
  );
  const user = record.user;
  if (user === null || typeof user !== 'object') return null;
  const fields: Record<string, unknown> = Object.fromEntries(
    Object.entries(user),
  );
  const id = fields.id;
  if (typeof id !== 'string' || id === '') return null;
  return {
    id,
    email: typeof fields.email === 'string' ? fields.email : '',
    name: typeof fields.name === 'string' ? fields.name : '',
  };
}

/**
 * Rejects a cookie authenticated write that a foreign page started.
 *
 * A browser always sends `Origin` on a write, so a value that differs from the
 * configured origin is a cross-site request. A request without the header did
 * not come from a browser page, so it cannot be a cross-site request forgery;
 * it still needs its session cookie to be accepted at all.
 */
export function checkWriteOrigin(
  origin: string,
  method: string,
  headers: {
    readonly origin?: string | undefined;
    readonly site?: string | undefined;
  },
): boolean {
  if (safeMethods.has(method.toUpperCase())) return true;
  if (headers.origin !== undefined && headers.origin !== origin) return false;
  if (
    headers.site !== undefined &&
    headers.site !== 'same-origin' &&
    headers.site !== 'none'
  )
    return false;
  return true;
}

/** Reads one header as a single string. */
function headerValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/** Builds the identity adapter of a deployment. */
export function createIdentityAdapter(
  dependencies: IdentityDependencies,
): IdentityAdapter {
  const now = dependencies.now ?? ((): Date => new Date());

  /** Resolves a bearer agent token. */
  async function fromToken(secret: string): Promise<ResolvedActor | null> {
    const record = await dependencies.identity.agentToken(
      agentTokenHash(secret),
    );
    if (record === null) return null;
    if (record.revokedAt !== null) return null;
    const expiry = Date.parse(record.expiresAt);
    if (Number.isNaN(expiry) || expiry <= now().getTime()) return null;
    const memberships = await dependencies.identity.memberships(
      record.accountId,
    );
    const verified = verifyActor(
      record.accountId,
      tokenGrants(record.scopes, memberships),
    );
    if (!verified.ok) return null;
    return {
      actor: verified.value,
      source: 'token',
      email: null,
      name: null,
    };
  }

  /** Resolves a browser session cookie. */
  async function fromSession(
    request: FastifyRequest,
  ): Promise<ResolvedActor | null> {
    const session: unknown = await dependencies.auth.api.getSession({
      headers: toRequestHeaders(request),
    });
    const user = readSessionUser(session);
    if (user === null) return null;
    // The account identifier is created on first sign-in, together with the
    // personal workspace, in one database transaction. The call is idempotent,
    // so a repeated sign-in reuses the account it already created.
    const linked =
      (await dependencies.identity.accountOf(user.id)) ??
      (await dependencies.identity.linkAccount({
        authUserId: user.id,
        workspaceName: 'Personal',
      }));
    const memberships = await dependencies.identity.memberships(linked);
    const verified = verifyActor(linked, sessionGrants(memberships));
    if (!verified.ok) return null;
    return {
      actor: verified.value,
      source: 'session',
      email: user.email === '' ? null : user.email,
      name: user.name === '' ? null : user.name,
    };
  }

  async function resolveActor(
    request: FastifyRequest,
  ): Promise<ResolvedActor | null> {
    // An explicit bearer credential wins, so a browser that also holds a
    // session cannot silently widen an agent call.
    const secret = bearerSecret(request.headers.authorization);
    if (secret !== null) return fromToken(secret);
    return fromSession(request);
  }

  const resolver: IdentityResolver = async (request, operation) => {
    const resolved = await resolveActor(request);
    if (resolved === null)
      throw new UnauthenticatedError(
        'This operation needs a valid session cookie or agent token.',
      );
    const accepted = operation.security.flatMap((requirement) =>
      Object.keys(requirement),
    );
    if (!accepted.includes(schemeOf[resolved.source]))
      throw new UnauthenticatedError(
        'This operation does not accept the supplied credential.',
      );
    if (
      resolved.source === 'session' &&
      !checkWriteOrigin(dependencies.origin, request.method, {
        origin: headerValue(request.headers.origin),
        site: headerValue(request.headers['sec-fetch-site']),
      })
    )
      throw new ForbiddenError(
        'A cookie authenticated write must come from the configured origin.',
      );
    actors.set(request, resolved);
  };

  return { resolveActor, resolver };
}
