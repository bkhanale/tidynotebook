/** First-run setup for the single-user installation. */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { IdentityStoreHandle } from '@notesapp/storage-server';
import type { HandlerMap, HandlerResult } from '../http/register.ts';
import { ForbiddenError } from '../http/problem.ts';
import { readProperty } from '../values.ts';
import type { NotesappAuth } from './better-auth.ts';

const jsonMediaType = 'application/json';

/** Removes an auth user when application account linking cannot finish. */
async function deleteUnlinkedUser(
  auth: NotesappAuth,
  authUserId: string,
): Promise<void> {
  const context = await auth.$context;
  await context.internalAdapter.deleteUser(authUserId);
}

function text(value: unknown, key: string): string {
  const member = readProperty(value, key);
  if (typeof member !== 'string' || member === '')
    throw new Error(`notesapp: validated setup input has no ${key}.`);
  return member;
}

/** Builds the two public operations used before the first sign-in. */
export function createSetupHandlers(
  auth: NotesappAuth,
  identity: IdentityStoreHandle,
): HandlerMap {
  return {
    getSetupStatus: async (): Promise<HandlerResult> => ({
      status: 200,
      mediaType: jsonMediaType,
      body: { initialized: await identity.hasAccount() },
    }),

    createOwner: async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<HandlerResult> => {
      if (await identity.hasAccount())
        throw new ForbiddenError('The single user already exists.');

      const email = text(request.body, 'email').toLowerCase();
      const password = text(request.body, 'password');
      const response: unknown = await auth.api.signUpEmail({
        body: { email, name: email, password },
        asResponse: true,
      });
      if (!(response instanceof Response) || !response.ok)
        throw new ForbiddenError('The single user could not be created.');

      const payload: unknown = await response.clone().json();
      const user = readProperty(payload, 'user');
      const authUserId = readProperty(user, 'id');
      if (typeof authUserId !== 'string' || authUserId === '')
        throw new Error('notesapp: the identity provider returned no user.');

      let accountId: string | null;
      try {
        accountId = await identity.linkFirstAccount({
          authUserId,
          workspaceName: 'Personal',
        });
      } catch (error) {
        await deleteUnlinkedUser(auth, authUserId);
        throw error;
      }
      if (accountId === null) {
        await deleteUnlinkedUser(auth, authUserId);
        throw new ForbiddenError('The single user already exists.');
      }

      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return {
        status: 201,
        mediaType: jsonMediaType,
        body: { initialized: true },
      };
    },
  };
}
