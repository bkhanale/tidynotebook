/**
 * Handlers of the account, settings, and agent token operations.
 *
 * The boundary has already validated the request against the contract and the
 * identity hook has already verified the actor, so a handler maps validated
 * input to a use case and maps the domain result back to a declared response.
 * No handler repeats a contract shape and no handler reads the database.
 */
import { Buffer } from 'node:buffer';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type {
  AgentTokenSummary,
  Preferences,
  Result,
  ThemeChoice,
  TokenScope,
  WorkspaceAdminStore,
} from '@notesapp/core';
import {
  createAgentToken,
  listAgentTokens,
  readPreferences,
  revokeAgentToken,
  themeChoices,
  updatePreferences,
} from '@notesapp/core';
import { agentTokenHash, requireActor } from '../auth/actor.ts';
import { readProperty } from '../values.ts';
import type { HandlerMap, HandlerResult } from './register.ts';
import { ForbiddenError, NotFoundError } from './problem.ts';

/** Media type of every answer in this module. */
const jsonMediaType = 'application/json';

/** Length of the random part of a secret, in bytes. */
const secretBytes = 32;

/** Prefix that marks a notesapp agent token secret. */
const secretPrefix = 'nsk_';

/**
 * Turns a domain result into a value or the matching problem.
 *
 * `not_found` is the only code that names a missing record. Every other
 * expected failure of these use cases is a denied permission or a denied rule,
 * and both answer 403 so the answer never says which rule applied.
 */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  if (result.error.code === 'not_found') throw new NotFoundError();
  throw new ForbiddenError();
}

/** Reads a validated string member of a request body. */
export function readString(body: unknown, key: string): string {
  const value = readProperty(body, key);
  if (typeof value !== 'string')
    throw new ForbiddenError(`The request body has no ${key}.`);
  return value;
}

/** Reads a validated boolean member of a request body. */
export function readBoolean(body: unknown, key: string): boolean {
  return readProperty(body, key) === true;
}

/** Reads a validated path parameter. */
export function readParameter(request: FastifyRequest, key: string): string {
  const value = readProperty(request.params, key);
  if (typeof value !== 'string')
    throw new NotFoundError(`The request names no ${key}.`);
  return value;
}

/** Narrows the validated theme member. */
function readTheme(body: unknown): ThemeChoice {
  const value = readString(body, 'theme');
  const choice = themeChoices.find((entry) => entry === value);
  if (choice === undefined)
    throw new ForbiddenError('The theme choice is not one of the known ones.');
  return choice;
}

/**
 * Reads the validated scope list of a new agent token.
 *
 * The contract already checked the shape. The use case checks that the scope
 * fits inside the current role, which is the rule that matters.
 */
function readScopes(body: unknown): readonly TokenScope[] {
  const value = readProperty(body, 'scopes');
  if (!Array.isArray(value))
    throw new ForbiddenError('The request body has no scope list.');
  return value.map((entry: unknown) => {
    const workspaceId = readString(entry, 'workspaceId');
    const actions = readProperty(entry, 'actions');
    if (!Array.isArray(actions))
      throw new ForbiddenError('A scope entry has no action list.');
    return {
      workspaceId,
      actions: actions.map((action: unknown) => {
        if (typeof action !== 'string')
          throw new ForbiddenError('A scope action is not a string.');
        // The contract enum already limited the value; the core rejects an
        // action the role does not permit.
        return action;
      }),
    } as TokenScope;
  });
}

/** A new token secret and the values that storage keeps. */
export function issueSecret(): {
  secret: string;
  prefix: string;
  hash: string;
} {
  const secret = `${secretPrefix}${Buffer.from(randomBytes(secretBytes)).toString('base64url')}`;
  return {
    secret,
    prefix: secret.slice(0, secretPrefix.length + 8),
    hash: agentTokenHash(secret),
  };
}

/** The public shape of one stored agent token. */
function tokenBody(token: AgentTokenSummary): Record<string, unknown> {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes.map((scope) => ({
      workspaceId: scope.workspaceId,
      actions: [...scope.actions],
    })),
    expiresAt: token.expiresAt,
    createdAt: token.createdAt,
    revokedAt: token.revokedAt,
  };
}

/** The public shape of stored settings. */
function preferencesBody(preferences: Preferences): Record<string, unknown> {
  return { theme: preferences.theme };
}

/** Builds the account, settings, and token handlers. */
export function createAccountHandlers(
  store: WorkspaceAdminStore,
  now: () => Date = () => new Date(),
): HandlerMap {
  return {
    getAccount: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      const preferences = unwrap(await readPreferences(store, resolved.actor));
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: {
          accountId: resolved.actor.accountId,
          email: resolved.email,
          name: resolved.name,
          preferences: preferencesBody(preferences),
        },
      };
    },

    updatePreferences: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      const stored = unwrap(
        await updatePreferences(store, resolved.actor, {
          theme: readTheme(request.body),
        }),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: preferencesBody(stored),
      };
    },

    listAgentTokens: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      const tokens = unwrap(await listAgentTokens(store, resolved.actor));
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: { tokens: tokens.map(tokenBody) },
      };
    },

    createAgentToken: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      const issued = issueSecret();
      const created = unwrap(
        await createAgentToken(store, resolved.actor, {
          id: randomUUID(),
          name: readString(request.body, 'name'),
          prefix: issued.prefix,
          secretHash: issued.hash,
          scopes: readScopes(request.body),
          expiresAt: readString(request.body, 'expiresAt'),
          now: now(),
        }),
      );
      // The secret is in this answer and nowhere else. It is never logged and
      // never stored, because storage keeps only its hash.
      return {
        status: 201,
        mediaType: jsonMediaType,
        body: { token: tokenBody(created), secret: issued.secret },
      };
    },

    revokeAgentToken: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      unwrap(
        await revokeAgentToken(
          store,
          resolved.actor,
          readParameter(request, 'tokenId'),
        ),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: { removed: true },
      };
    },
  };
}
