/**
 * The invitation sign-up path.
 *
 * Public registration is disabled, so an invited person who has no account yet
 * cannot create one. This module is the one product path that does: the
 * invitation token proves control of the invited address, so the server
 * creates the local account for exactly that address, marks the address
 * verified, and signs the new account in.
 *
 * The instance that serves requests keeps `disableSignUp` on. This module
 * builds a separate instance over the same connection pool with sign-up
 * permitted, so the second control stays in place on the served surface. The
 * sign-up route is not in `authRoutes` either, so nothing outside this module
 * can register.
 *
 * Creating the account and consuming the invitation cannot be one database
 * transaction, because the two live behind different credentials. The order is
 * therefore create, then claim, then compensate: a claim that fails removes the
 * account, its personal workspace, and its identity again, so a failed
 * acceptance leaves nothing behind.
 */
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Actor, Result } from '@notesapp/core';
import { sessionGrants, verifyActor } from '@notesapp/core';
import type { IdentityStoreHandle } from '@notesapp/storage-server';
import type { ServerConfig } from '../config.ts';
import type { ResolvedActor } from './actor.ts';
import { createAuth, type NotesappAuth } from './better-auth.ts';

/** One invitation that has not been consumed yet. */
export type OpenInvitation = {
  readonly workspaceId: string;
  readonly email: string;
};

/** What one attempt to register an invited address produced. */
export type RegistrationOutcome<T> =
  /** The account was created and the invitation was consumed. */
  | {
      readonly kind: 'claimed';
      readonly value: T;
      readonly cookies: readonly string[];
    }
  /** The address already has an account, so that person signs in instead. */
  | { readonly kind: 'taken' }
  /** The claim failed, and everything the attempt created was removed again. */
  | { readonly kind: 'refused' };

/** What the acceptance handler needs besides the workspace store. */
export type InvitationAccounts = {
  /** Whether this installation still accepts a local password at all. */
  readonly passwordSignUpEnabled: boolean;
  /** The verified actor of a request, or `null` when there is none. */
  resolveActor(request: FastifyRequest): Promise<ResolvedActor | null>;
  /** The workspace and the address of one open invitation, or `null`. */
  openInvitation(tokenHash: string): Promise<OpenInvitation | null>;
  /**
   * Creates the local account of an invited address, runs `claim`, and signs
   * the account in when the claim succeeded.
   *
   * The claim runs inside this call so that a failure can be compensated here.
   * The caller never sees a half created account.
   */
  register<T>(input: {
    readonly email: string;
    readonly password: string;
    readonly claim: (actor: Actor) => Promise<Result<T>>;
  }): Promise<RegistrationOutcome<T>>;
  /** Closes the instance that this module owns. */
  close(): Promise<void>;
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
    readonly identity: IdentityStoreHandle;
    readonly pool: pg.Pool;
    readonly resolveActor: (
      request: FastifyRequest,
    ) => Promise<ResolvedActor | null>;
  },
): InvitationAccounts {
  // A separate instance over the same pool. The served instance keeps
  // `disableSignUp` on, so sign-up is not reachable through anything that is
  // mounted.
  const signUp = createAuth(
    config,
    { mail: null, allowSignUp: true },
    dependencies.pool,
  );
  const auth: NotesappAuth = signUp.auth;

  /** Removes everything that a failed attempt created. */
  async function discard(authUserId: string): Promise<void> {
    await dependencies.identity.discardAccount(authUserId);
    const context = await auth.$context;
    await context.internalAdapter.deleteUser(authUserId);
  }

  return {
    passwordSignUpEnabled: !config.oidcRequired,

    resolveActor: dependencies.resolveActor,

    openInvitation: (tokenHash: string) =>
      dependencies.identity.openInvitation(tokenHash),

    async register<T>(input: {
      readonly email: string;
      readonly password: string;
      readonly claim: (actor: Actor) => Promise<Result<T>>;
    }): Promise<RegistrationOutcome<T>> {
      const context = await auth.$context;
      const existing = await context.internalAdapter.findUserByEmail(
        input.email,
      );
      if (existing !== null) return { kind: 'taken' };
      const answer: unknown = await auth.api.signUpEmail({
        body: {
          email: input.email,
          name: input.email,
          password: input.password,
        },
        asResponse: true,
      });
      if (!(answer instanceof Response) || !answer.ok) return { kind: 'taken' };
      const cookies = answer.headers.getSetCookie();
      const created = await context.internalAdapter.findUserByEmail(
        input.email,
      );
      const authUserId = property(created?.user, 'id');
      if (typeof authUserId !== 'string' || authUserId === '')
        return { kind: 'refused' };
      try {
        // The invitation token proved control of the address, so it is
        // verified.
        await context.internalAdapter.updateUser(authUserId, {
          emailVerified: true,
        });
        const accountId = await dependencies.identity.linkAccount({
          authUserId,
          workspaceName: 'Personal',
        });
        const memberships = await dependencies.identity.memberships(accountId);
        const verified = verifyActor(accountId, sessionGrants(memberships));
        if (!verified.ok) {
          await discard(authUserId);
          return { kind: 'refused' };
        }
        const claimed = await input.claim(verified.value);
        if (!claimed.ok) {
          await discard(authUserId);
          return { kind: 'refused' };
        }
        return { kind: 'claimed', value: claimed.value, cookies };
      } catch (error) {
        await discard(authUserId);
        throw error;
      }
    },

    close: () => signUp.close(),
  };
}
