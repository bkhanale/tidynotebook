/**
 * Handlers of the account and settings operations.
 *
 * The boundary has already validated the request against the contract and the
 * identity hook has already verified the actor, so a handler maps validated
 * input to a use case and maps the domain result back to a declared response.
 * No handler repeats a contract shape and no handler reads the database.
 */
import type { FastifyRequest } from 'fastify';
import type {
  AppearanceChoice,
  Preferences,
  Result,
  WorkspaceAdminStore,
} from '@notesapp/core';
import {
  appearanceChoices,
  isThemeFamilyId,
  readPreferences,
  updatePreferences,
} from '@notesapp/core';
import { requireActor } from '../auth/actor.ts';
import { readProperty } from '../values.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';
import { ForbiddenError, NotFoundError } from '../plugins/problem.ts';

/** Media type of every answer in this module. */
const jsonMediaType = 'application/json';

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

/** Narrows the validated appearance member. */
function readAppearance(body: unknown): AppearanceChoice {
  const value = readString(body, 'appearance');
  const choice = appearanceChoices.find((entry) => entry === value);
  if (choice === undefined)
    throw new ForbiddenError('The appearance is not one of the known ones.');
  return choice;
}

/** Narrows the validated theme family member. */
function readThemeFamily(body: unknown): string {
  const value = readString(body, 'themeFamily');
  if (!isThemeFamilyId(value))
    throw new ForbiddenError('The theme family is not a known identifier.');
  return value;
}

/** The public shape of stored settings. */
function preferencesBody(preferences: Preferences): Record<string, unknown> {
  return {
    appearance: preferences.appearance,
    themeFamily: preferences.themeFamily,
  };
}

/** Builds the account and settings handlers. */
export function createAccountHandlers(store: WorkspaceAdminStore): HandlerMap {
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
          appearance: readAppearance(request.body),
          themeFamily: readThemeFamily(request.body),
        }),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: preferencesBody(stored),
      };
    },
  };
}
