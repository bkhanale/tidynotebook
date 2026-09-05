/**
 * The invitation sign-up path.
 *
 * Public registration is disabled, so an invited person who has no account yet
 * cannot create one. This module is the one product path that does: the
 * invitation token proves control of the invited address, so the server
 * creates the local account for exactly that address, marks the address
 * verified, and signs the new account in.
 *
 * The sign-up route itself stays unmounted. `authRoutes` is the exact list of
 * paths that the protocol adapter serves, and `/api/auth/sign-up/email` is not
 * in it, so nothing outside this module can reach registration.
 */
import type { FastifyRequest } from 'fastify';
import type { Actor } from '@notesapp/core';
import { sessionGrants, verifyActor } from '@notesapp/core';
import type { IdentityStoreHandle } from '@notesapp/storage-server';
import type { ServerConfig } from '../config.ts';
import type { ResolvedActor } from './actor.ts';
import type { NotesappAuth } from './better-auth.ts';

/** One invitation that has not been consumed yet. */
export type OpenInvitation = {
  readonly workspaceId: string;
  readonly email: string;
};

/** A local account that the invitation path created. */
export type RegisteredAccount = {
  readonly actor: Actor;
  readonly email: string;
  /** Complete `set-cookie` values of the new session. */
  readonly cookies: readonly string[];
};

/** What the acceptance handler needs besides the workspace store. */
export type InvitationAccounts = {
  /** Whether this installation still accepts a local password at all. */
  readonly passwordSignUpEnabled: boolean;
  /** The verified actor of a request, or `null` when there is none. */
  resolveActor(request: FastifyRequest): Promise<ResolvedActor | null>;
  /** The workspace and the address of one open invitation, or `null`. */
  openInvitation(tokenHash: string): Promise<OpenInvitation | null>;
  /**
   * Creates the local account of an invited address and signs it in.
   *
   * Returns `null` when the address already has an account, because that
   * person signs in instead of registering again.
   */
  register(input: {
    readonly email: string;
    readonly password: string;
  }): Promise<RegisteredAccount | null>;
};

/** Reads one property of an unknown value without asserting its shape. */
function property(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value))[key];
}

/** Builds the invitation sign-up path of one deployment. */
export function createInvitationAccounts(
  config: ServerConfig,
  dependencies: {
    readonly auth: NotesappAuth;
    readonly identity: IdentityStoreHandle;
    readonly resolveActor: (
      request: FastifyRequest,
    ) => Promise<ResolvedActor | null>;
  },
): InvitationAccounts {
  return {
    passwordSignUpEnabled: !config.oidcRequired,

    resolveActor: dependencies.resolveActor,

    openInvitation: (tokenHash: string) =>
      dependencies.identity.openInvitation(tokenHash),

    async register(input): Promise<RegisteredAccount | null> {
      const context = await dependencies.auth.$context;
      const existing = await context.internalAdapter.findUserByEmail(
        input.email,
      );
      if (existing !== null) return null;
      // The instance permits sign-up through its server API only. The route
      // that would expose it is not mounted, so this call is the whole path.
      const answer: unknown = await dependencies.auth.api.signUpEmail({
        body: {
          email: input.email,
          name: input.email,
          password: input.password,
        },
        asResponse: true,
      });
      if (!(answer instanceof Response) || !answer.ok) return null;
      const cookies = answer.headers.getSetCookie();
      const created = await context.internalAdapter.findUserByEmail(
        input.email,
      );
      const authUserId = property(created?.user, 'id');
      if (typeof authUserId !== 'string' || authUserId === '') return null;
      // The invitation token proved control of the address, so it is verified.
      await context.internalAdapter.updateUser(authUserId, {
        emailVerified: true,
      });
      const accountId = await dependencies.identity.linkAccount({
        authUserId,
        workspaceName: 'Personal',
      });
      const memberships = await dependencies.identity.memberships(accountId);
      const verified = verifyActor(accountId, sessionGrants(memberships));
      if (!verified.ok) return null;
      return { actor: verified.value, email: input.email, cookies };
    },
  };
}
