/**
 * Handlers of the workspace, membership, and invitation operations.
 *
 * A workspace that the actor cannot see answers 404, because storage cannot
 * tell a missing workspace from a hidden one and must not try: the answer
 * would disclose that the workspace exists.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type {
  InvitationSummary,
  Member,
  Role,
  WorkspaceAdminStore,
  WorkspaceSummary,
} from '@notesapp/core';
import {
  acceptInvitation,
  createWorkspace,
  deleteWorkspace,
  invitationLifetimeMs,
  inviteMember,
  listMembers,
  listWorkspaces,
  removeMember,
  transferOwnership,
  updateMember,
  updateWorkspace,
} from '@notesapp/core';
import { WorkspaceUnavailableError } from '@notesapp/storage-server';
import { requireActor, requireWriteOrigin } from '../auth/actor.ts';
import type { InvitationAccounts } from '../auth/invitations.ts';
import type { MailTransport } from '../auth/mail.ts';
import { readProperty } from '../values.ts';
import { readBoolean, readParameter, readString, unwrap } from './accounts.ts';
import type { HandlerMap, HandlerResult } from './register.ts';
import {
  ForbiddenError,
  NotFoundError,
  OidcRequiredError,
  UnauthenticatedError,
} from './problem.ts';

const jsonMediaType = 'application/json';

/** Length of the random part of an invitation token, in bytes. */
const invitationBytes = 32;

/** The SHA-256 hash of an invitation token, in lower case hexadecimal. */
export function invitationTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** A new invitation token and the hash that storage keeps. */
export function issueInvitationToken(): { token: string; hash: string } {
  const token = Buffer.from(randomBytes(invitationBytes)).toString('base64url');
  return { token, hash: invitationTokenHash(token) };
}

/**
 * Runs a workspace use case and maps a hidden workspace to 404.
 *
 * The store throws when the workspace does not exist or the actor is not a
 * member, and both answers must look the same from outside.
 */
async function inWorkspace<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof WorkspaceUnavailableError) throw new NotFoundError();
    throw error;
  }
}

/** Narrows a validated role member of a request body. */
function readRole(body: unknown): Role {
  const value = readString(body, 'role');
  if (value !== 'admin' && value !== 'editor' && value !== 'viewer')
    throw new ForbiddenError('The role is not one that this operation grants.');
  return value;
}

function workspaceBody(summary: WorkspaceSummary): Record<string, unknown> {
  return {
    workspaceId: summary.workspaceId,
    name: summary.name,
    role: summary.role,
    personal: summary.personal,
  };
}

function memberBody(member: Member): Record<string, unknown> {
  return {
    accountId: member.accountId,
    role: member.role,
    email: member.email,
    name: member.name,
  };
}

function invitationBody(
  invitation: InvitationSummary,
): Record<string, unknown> {
  return {
    id: invitation.id,
    workspaceId: invitation.workspaceId,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    state: invitation.state,
  };
}

/** What the workspace handlers need besides the store. */
export type WorkspaceHandlerOptions = {
  /** Clock, so a test can decide the expiry of an invitation. */
  readonly now?: () => Date;
  /** Mail transport, or `null` when the deployment has none. */
  readonly mail?: MailTransport | null;
  /** The invitation sign-up path, when the composition supplies one. */
  readonly invitations?: InvitationAccounts;
};

/** Builds the workspace, membership, and invitation handlers. */
export function createWorkspaceHandlers(
  store: WorkspaceAdminStore,
  options: WorkspaceHandlerOptions = {},
  origin = '',
): HandlerMap {
  const now = options.now ?? ((): Date => new Date());
  const mail = options.mail ?? null;
  const invitations = options.invitations;
  return {
    listWorkspaces: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      const workspaces = unwrap(await listWorkspaces(store, resolved.actor));
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: { workspaces: workspaces.map(workspaceBody) },
      };
    },

    createWorkspace: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      const created = unwrap(
        await createWorkspace(store, resolved.actor, {
          workspaceId: randomUUID(),
          name: readString(request.body, 'name'),
        }),
      );
      return {
        status: 201,
        mediaType: jsonMediaType,
        body: workspaceBody(created),
      };
    },

    updateWorkspace: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      const updated = unwrap(
        await inWorkspace(() =>
          updateWorkspace(
            store,
            resolved.actor,
            readParameter(request, 'workspaceId'),
            readString(request.body, 'name'),
          ),
        ),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: workspaceBody(updated),
      };
    },

    deleteWorkspace: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      unwrap(
        await inWorkspace(() =>
          deleteWorkspace(
            store,
            resolved.actor,
            readParameter(request, 'workspaceId'),
          ),
        ),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: { removed: true },
      };
    },

    listMembers: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      const listed = unwrap(
        await inWorkspace(() =>
          listMembers(
            store,
            resolved.actor,
            readParameter(request, 'workspaceId'),
          ),
        ),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: {
          members: listed.members.map(memberBody),
          invitations: listed.invitations.map(invitationBody),
        },
      };
    },

    inviteMember: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      const issued = issueInvitationToken();
      const created = unwrap(
        await inWorkspace(() =>
          inviteMember(
            store,
            resolved.actor,
            readParameter(request, 'workspaceId'),
            {
              id: randomUUID(),
              email: readString(request.body, 'email').toLowerCase(),
              role: readRole(request.body),
              tokenHash: issued.hash,
              expiresAt: new Date(
                now().getTime() + invitationLifetimeMs,
              ).toISOString(),
            },
          ),
        ),
      );
      // A deployment with a mail transport sends the token and keeps it out of
      // the answer, so it never reaches a browser log or a shared screen. One
      // without a transport hands it to the inviting administrator instead.
      if (mail !== null) {
        await mail.send({
          to: created.email,
          subject: 'You are invited to a notesapp workspace',
          text: [
            'Open this link to join the workspace.',
            `${origin}/invitations/${issued.token}`,
            'The invitation expires in fourteen days and works once.',
          ].join('\n'),
        });
        return {
          status: 201,
          mediaType: jsonMediaType,
          body: { invitation: invitationBody(created), delivered: true },
        };
      }
      return {
        status: 201,
        mediaType: jsonMediaType,
        body: {
          invitation: invitationBody(created),
          delivered: false,
          token: issued.token,
        },
      };
    },

    updateMember: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      const member = unwrap(
        await inWorkspace(() =>
          updateMember(
            store,
            resolved.actor,
            readParameter(request, 'workspaceId'),
            readParameter(request, 'accountId'),
            readRole(request.body),
          ),
        ),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: memberBody(member),
      };
    },

    removeMember: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      unwrap(
        await inWorkspace(() =>
          removeMember(
            store,
            resolved.actor,
            readParameter(request, 'workspaceId'),
            readParameter(request, 'accountId'),
          ),
        ),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: { removed: true },
      };
    },

    transferOwnership: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      const members = unwrap(
        await inWorkspace(() =>
          transferOwnership(
            store,
            resolved.actor,
            readParameter(request, 'workspaceId'),
            {
              accountId: readString(request.body, 'accountId'),
              leave: readBoolean(request.body, 'leave'),
            },
          ),
        ),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: { members: members.map(memberBody), invitations: [] },
      };
    },

    acceptInvitation: async (request, reply): Promise<HandlerResult> => {
      if (invitations === undefined)
        throw new UnauthenticatedError(
          'This deployment cannot accept an invitation.',
        );
      const tokenHash = invitationTokenHash(readString(request.body, 'token'));
      const password = readProperty(request.body, 'password');
      const resolved = await invitations.resolveActor(request);
      if (resolved !== null) {
        // This operation declares no security requirement, because its second
        // form has no session yet. The identity hook therefore does not run,
        // so the cookie write check runs here instead.
        if (resolved.source === 'session') requireWriteOrigin(origin, request);
        // A signed in account accepts with its own address. A password would
        // be a second identity for the same request, so it is refused.
        if (password !== undefined)
          throw new ForbiddenError(
            'A signed in account accepts an invitation without a password.',
          );
        if (resolved.email === null)
          throw new ForbiddenError(
            'An invitation is accepted by a browser session only.',
          );
        const membership = unwrap(
          await acceptInvitation(store, resolved.actor, {
            tokenHash,
            email: resolved.email.toLowerCase(),
          }),
        );
        return {
          status: 200,
          mediaType: jsonMediaType,
          body: {
            workspaceId: membership.workspaceId,
            role: membership.role,
          },
        };
      }
      if (typeof password !== 'string')
        throw new UnauthenticatedError(
          'Sign in first, or supply a password to create the invited account.',
        );
      if (!invitations.passwordSignUpEnabled) throw new OidcRequiredError();
      const open = await invitations.openInvitation(tokenHash);
      if (open === null) throw new NotFoundError();
      // The claim runs inside `register`, so a failure removes the account
      // that the attempt created rather than leaving it behind.
      const created = await invitations.register({
        email: open.email,
        password,
        claim: (actor) =>
          acceptInvitation(store, actor, {
            tokenHash,
            email: open.email.toLowerCase(),
          }),
      });
      if (created.kind === 'taken')
        throw new ForbiddenError(
          'That address already has an account. Sign in and accept again.',
        );
      if (created.kind === 'refused') throw new NotFoundError();
      if (created.cookies.length > 0)
        reply.header('set-cookie', [...created.cookies]);
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: {
          workspaceId: created.value.workspaceId,
          role: created.value.role,
        },
      };
    },
  };
}
