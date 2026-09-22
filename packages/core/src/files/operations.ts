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
  type DocumentSave,
  type Result,
  type RevisionInput,
} from './model.ts';
import { maxFilesPerChangeset } from './commit.ts';
import { isBelowFolder, normalizePath } from './path.ts';

/** The identity and the timestamps that a client assigns to one submission. */
export type SubmissionIds = {
  /** Identifier of this operation, which makes a retry safe. */
  readonly mutationId: string;
  /** The device that submitted it. */
  readonly deviceId: string;
  /** The client clock, which stays informational. */
  readonly clientTime: string;
};

/** The content of one note revision, from the document work of a save. */
export function markdownContent(document: DocumentSave): ContentRef {
  return { kind: 'markdown', document };
}

/**
 * The content of a tombstone revision.
 *
 * A deletion stores no note text: the revision before it still holds the
 * content, and history keeps it. An attachment tombstone keeps the object
 * reference of its parent, because an attachment revision has no other way to
 * name content.
 */
export function tombstoneContent(
  parent: ContentRef,
  document: DocumentSave,
): ContentRef {
  if (parent.kind === 'attachment') return parent;
  return markdownContent({ ...document, work: { kind: 'none' } });
}

/** The content that the workspace writes when it authors the text itself. */
export function workspaceText(text: string, epoch: number): ContentRef {
  return {
    kind: 'markdown',
    document: { work: { kind: 'text', text }, epoch, observed: null },
  };
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
 *
 * Every path here passes `normalizePath` first, and the comparison runs over
 * segments through `isBelowFolder`. Both matter. A stored path is in composed
 * form, so a folder name that a client sends in decomposed form matched no
 * stored path and the whole rename was refused as an invalid path. And a
 * folder `notes/trip` must not take `notes/trips-2026/x.md` with it, which a
 * plain prefix test would do.
 */
export function renameFolderChangeset(
  input: RenameFolderInput,
): Result<ChangesetInput> {
  if (input.files.length === 0) return fail('invalid_graph');
  if (input.files.length > maxFilesPerChangeset)
    return fail(
      'too_many_files',
      input.files.map((member) => member.fileId),
    );
  const from = normalizePath(input.from, 'folder');
  if (!from.ok) return from;
  const to = normalizePath(input.to, 'folder');
  if (!to.ok) return to;
  const fromSegments = from.value.split('/');
  const toSegments = to.value.split('/');
  const revisions: RevisionInput[] = [];
  const expectedHeads: Record<string, string | null> = {};
  for (const member of input.files) {
    const path = normalizePath(member.path, 'note');
    if (!path.ok) return fail('invalid_path', [member.fileId]);
    const segments = path.value.split('/');
    if (!isBelowFolder(fromSegments, segments))
      return fail('invalid_path', [member.fileId]);
    expectedHeads[member.fileId] = member.expectedHead;
    revisions.push({
      id: member.revisionId,
      fileId: member.fileId,
      parents: [member.expectedHead],
      path: [...toSegments, ...segments.slice(fromSegments.length)].join('/'),
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
