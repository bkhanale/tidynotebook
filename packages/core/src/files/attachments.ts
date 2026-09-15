/**
 * Attachment domain types and operations.
 *
 * An attachment is an immutable binary object referenced by an immutable
 * attachment revision. Deduplication stays inside one workspace.
 */
import type { ChangesetInput, RevisionInput } from './model.ts';

/** Supported image media types. SVG is intentionally not accepted. */
export const allowedMediaTypes = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export type AttachmentMediaType = (typeof allowedMediaTypes)[number];

/** True when a media type is an accepted attachment image type. */
export function isAllowedMediaType(
  value: string,
): value is AttachmentMediaType {
  return allowedMediaTypes.some((allowed) => allowed === value);
}

/** The states that one immutable attachment object can hold. */
export const attachmentStates = [
  'temporary',
  'finalized',
  'unavailable',
] as const;

/** State of one immutable attachment object. */
export type AttachmentState = (typeof attachmentStates)[number];

/** True when a text names a state that an attachment object can hold. */
export function isAttachmentState(value: string): value is AttachmentState {
  return attachmentStates.some((state) => state === value);
}

/** One attachment object metadata record. */
export type AttachmentObjectRecord = {
  readonly workspaceId: string;
  readonly id: string;
  readonly digest: string;
  readonly size: number;
  readonly mediaType: AttachmentMediaType;
  readonly width: number | null;
  readonly height: number | null;
  readonly state: AttachmentState;
  readonly createdAt: string;
  readonly finalizedAt: string | null;
};

/**
 * Builds the ChangesetInput for an attachment revision.
 *
 * An attachment revision refers to a finalized attachment object by its
 * identifier and verified digest.
 */
export function createAttachmentChangeset(input: {
  readonly workspaceId: string;
  readonly fileId: string;
  readonly revisionId: string;
  readonly path: string;
  readonly objectId: string;
  readonly digest: string;
  readonly expectedHead: string | null;
  readonly message: string | null;
  readonly ids: {
    readonly mutationId: string;
    readonly deviceId: string;
    readonly clientTime: string;
  };
}): ChangesetInput {
  const revision: RevisionInput = {
    id: input.revisionId,
    fileId: input.fileId,
    parents: input.expectedHead === null ? [] : [input.expectedHead],
    path: input.path,
    deleted: false,
    content: {
      kind: 'attachment',
      digest: input.digest,
      objectId: input.objectId,
    },
    clientTime: input.ids.clientTime,
    message: input.message,
    restoredFrom: null,
  };
  return {
    workspaceId: input.workspaceId,
    mutationId: input.ids.mutationId,
    deviceId: input.ids.deviceId,
    expectedHeads: { [input.fileId]: input.expectedHead },
    revisions: [revision],
  };
}
