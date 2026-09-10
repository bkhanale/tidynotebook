/**
 * Builders for the changesets that the single file operations submit.
 *
 * A create, an edit, a rename, a delete, and a folder rename are all one
 * changeset. These builders keep the shape of that changeset in one place, so
 * an HTTP handler and the browser sync engine cannot each invent a different
 * one. They perform no permission check and no storage lookup;
 * `commitChangeset` owns every rule.
 */
import { contentDigest } from './digest.ts';
import {
  fail,
  ok,
  type ChangesetInput,
  type ContentRef,
  type Result,
  type RevisionInput,
} from './model.ts';
import { maxFilesPerChangeset } from './commit.ts';

/** The identity and the timestamps that a client assigns to one submission. */
export type SubmissionIds = {
  /** Identifier of this operation, which makes a retry safe. */
  readonly mutationId: string;
  /** The device that submitted it. */
  readonly deviceId: string;
  /** The client clock, which stays informational. */
  readonly clientTime: string;
};

/** Markdown content and its digest. */
export async function markdownContent(text: string): Promise<ContentRef> {
  return { kind: 'markdown', digest: await contentDigest(text), text };
}

/**
 * The content of a tombstone revision.
 *
 * A deletion stores no note text: the revision before it still holds the
 * content, and history keeps it. An attachment tombstone keeps the object
 * reference of its parent, because an attachment revision has no other way to
 * name content.
 */
export async function tombstoneContent(
  parent: ContentRef,
): Promise<ContentRef> {
  if (parent.kind === 'attachment') return parent;
  return markdownContent('');
}

/** What a new file carries. */
export type CreateFileInput = {
  readonly workspaceId: string;
  readonly fileId: string;
  readonly revisionId: string;
  readonly path: string;
  readonly content: ContentRef;
  readonly message: string | null;
  readonly ids: SubmissionIds;
};

/**
 * The changeset of a new file.
 *
 * The expected head is `null`, which states that the file must not exist in
 * accepted state. The revision is a root: it has no parent.
 */
export function createFileChangeset(input: CreateFileInput): ChangesetInput {
  return {
    workspaceId: input.workspaceId,
    mutationId: input.ids.mutationId,
    deviceId: input.ids.deviceId,
    expectedHeads: { [input.fileId]: null },
    revisions: [
      {
        id: input.revisionId,
        fileId: input.fileId,
        parents: [],
        path: input.path,
        deleted: false,
        content: input.content,
        clientTime: input.ids.clientTime,
        message: input.message,
        restoredFrom: null,
      },
    ],
  };
}

/** What a change of an existing file carries. */
export type UpdateFileInput = {
  readonly workspaceId: string;
  readonly fileId: string;
  readonly revisionId: string;
  /** The accepted head that the client saw. */
  readonly expectedHead: string;
  readonly path: string;
  readonly content: ContentRef;
  readonly deleted: boolean;
  readonly message: string | null;
  readonly ids: SubmissionIds;
};

/**
 * The changeset of a change to one existing file.
 *
 * The same builder serves an edit, a rename, an edit with a rename, and a
 * deletion, because all four are one revision with the expected head as its
 * only parent. A named checkpoint is an edit that carries a message.
 */
export function updateFileChangeset(input: UpdateFileInput): ChangesetInput {
  return {
    workspaceId: input.workspaceId,
    mutationId: input.ids.mutationId,
    deviceId: input.ids.deviceId,
    expectedHeads: { [input.fileId]: input.expectedHead },
    revisions: [
      {
        id: input.revisionId,
        fileId: input.fileId,
        parents: [input.expectedHead],
        path: input.path,
        deleted: input.deleted,
        content: input.content,
        clientTime: input.ids.clientTime,
        message: input.message,
        restoredFrom: null,
      },
    ],
  };
}

/** One file that a folder rename moves. */
export type FolderMember = {
  readonly fileId: string;
  /** The accepted head that the client saw. */
  readonly expectedHead: string;
  readonly revisionId: string;
  readonly path: string;
  /** The content of the head, which a rename keeps unchanged. */
  readonly content: ContentRef;
};

/** What a folder rename carries. */
export type RenameFolderInput = {
  readonly workspaceId: string;
  /** The folder prefix to replace, without a trailing separator. */
  readonly from: string;
  /** The folder prefix to write instead, without a trailing separator. */
  readonly to: string;
  readonly files: readonly FolderMember[];
  readonly message: string | null;
  readonly ids: SubmissionIds;
};

/**
 * The changeset that moves every file of one folder.
 *
 * A folder is a path prefix, so the move rewrites that prefix in the path of
 * every member and keeps the content. All members travel in one changeset, so
 * either the whole folder moves or nothing does. The file limit is the
 * design's limit for one operation.
 *
 * The caller supplies the members. It has to, because the set of files under a
 * prefix is a read of accepted state and this builder performs no read.
 */
export function renameFolderChangeset(
  input: RenameFolderInput,
): Result<ChangesetInput> {
  if (input.files.length === 0) return fail('invalid_graph');
  if (input.files.length > maxFilesPerChangeset)
    return fail(
      'invalid_graph',
      input.files.map((member) => member.fileId),
    );
  if (input.from === '' || input.to === '') return fail('invalid_path');
  const prefix = `${input.from}/`;
  const revisions: RevisionInput[] = [];
  const expectedHeads: Record<string, string | null> = {};
  for (const member of input.files) {
    if (!member.path.startsWith(prefix))
      return fail('invalid_path', [member.fileId]);
    expectedHeads[member.fileId] = member.expectedHead;
    revisions.push({
      id: member.revisionId,
      fileId: member.fileId,
      parents: [member.expectedHead],
      path: `${input.to}/${member.path.slice(prefix.length)}`,
      deleted: false,
      content: member.content,
      clientTime: input.ids.clientTime,
      message: input.message,
      restoredFrom: null,
    });
  }
  return ok({
    workspaceId: input.workspaceId,
    mutationId: input.ids.mutationId,
    deviceId: input.ids.deviceId,
    expectedHeads,
    revisions,
  });
}
