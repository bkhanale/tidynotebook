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
import { requireActor } from '../auth/actor.ts';
import { readBoolean, readParameter, readString, unwrap } from './accounts.ts';
import type { HandlerMap, HandlerResult } from './register.ts';
import { ForbiddenError, NotFoundError } from './problem.ts';

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

/** Builds the workspace, membership, and invitation handlers. */
export function createWorkspaceHandlers(
  store: WorkspaceAdminStore,
  now: () => Date = () => new Date(),
): HandlerMap {
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
      // The token is in this answer and nowhere else. A deployment with a mail
      // transport also sends it; one without hands it to the administrator.
      return {
        status: 201,
        mediaType: jsonMediaType,
        body: { invitation: invitationBody(created), token: issued.token },
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

    acceptInvitation: async (request): Promise<HandlerResult> => {
      const resolved = requireActor(request);
      if (resolved.email === null)
        throw new ForbiddenError(
          'An invitation is accepted by a signed in account only.',
        );
      const membership = unwrap(
        await acceptInvitation(store, resolved.actor, {
          tokenHash: invitationTokenHash(readString(request.body, 'token')),
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
    },
  };
}
