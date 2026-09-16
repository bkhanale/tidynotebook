/**
 * The publications repository: what one published link opens.
 *
 * It implements `PublicationReader` of `packages/core`, which declares read
 * methods only. Three rules hold the boundary of decision 0030 here.
 *
 * **The scope lives in the SQL.** `scopedNotes` is the one query of this file
 * that answers a note, and every method of the port reaches a note through it.
 * Its bound is not a parameter: it is a member of the record that the digest
 * lookup built, so a caller cannot widen it and a later author cannot forget
 * it. `publications-repository.test.ts` holds that shape.
 *
 * **A link record is not a key.** Every method after the lookup takes a
 * `PublishedLink`, as the port declares, but the repository uses that value
 * only to find the record that this transaction opened. A link that this
 * transaction did not open is refused, so a fabricated record reads nothing.
 *
 * **The token digest buys one row.** The lookup runs the SECURITY DEFINER
 * function of the migration, because the transaction holds no identity before
 * it: the row policies hide every link from a transaction with no account.
 * The function answers no token digest and no password digest, so neither can
 * travel with the answer.
 */
import { and, eq, inArray, isNotNull, like, type SQL } from 'drizzle-orm';
import {
  OperationalError,
  maxListedFiles,
  type PublicationReader,
  type PublishedAttachmentReference,
  type PublishedLink,
  type PublishedNote,
  type PublishedNoteContent,
  type ReadingTicket,
} from '@notesapp/core';
import { extractAttachmentRefs } from '@notesapp/markdown';
import { contents, files, readingTickets, revisions } from '../schema.ts';
import { isUuid } from './errors.ts';
import {
  isSecretDigest,
  likeEscape,
  parsePublicationRow,
  type PublicationLookupRow,
  type StoredPublication,
} from './publication-row.ts';
import type { PublicationSession } from './publication-transaction.ts';

/** One note row of the scoped query, before it becomes a domain record. */
type ScopedNoteRow = {
  readonly fileId: string;
  readonly path: string;
  readonly deleted: boolean;
  readonly revisionId: string;
  readonly updatedAt: Date;
  readonly text: string | null;
};

/** The note record of one scoped row. */
function publishedNote(row: ScopedNoteRow): PublishedNote {
  return {
    fileId: row.fileId,
    path: row.path,
    deleted: row.deleted,
    headRevisionId: row.revisionId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The Markdown of one scoped row.
 *
 * The content check constraint keeps the text of a Markdown content row, so a
 * row with no text is a defect of a writer and not an expected answer.
 */
function publishedText(row: ScopedNoteRow): string {
  if (row.text === null) {
    throw new OperationalError(
      'unexpected',
      'notesapp: a published note holds a head revision with no Markdown.',
    );
  }
  return row.text;
}

/** Builds the reader of the port over one open read-only transaction. */
export function publicationsRepository(
  session: PublicationSession,
): PublicationReader {
  const { db } = session;
  /** The links that this transaction opened, by their identifier. */
  const opened = new Map<string, StoredPublication>();

  /** The record of a link that this transaction opened, or a refusal. */
  const requireOpen = (link: PublishedLink): StoredPublication => {
    const open = opened.get(link.publicationId);
    if (open === undefined) {
      throw new OperationalError(
        'unexpected',
        'notesapp: a published read named a link that this transaction did not open.',
      );
    }
    return open;
  };

  /** The scope of one opened link, as one SQL condition. */
  const scopeBound = (open: StoredPublication): SQL => {
    if (open.scopeFileId !== null) return eq(files.id, open.scopeFileId);
    if (open.scopePrefix !== null)
      return like(files.path, `${likeEscape(open.scopePrefix)}%`);
    throw new OperationalError(
      'unexpected',
      'notesapp: an opened published link states no scope.',
    );
  };

  /**
   * The one query that answers a note of one link.
   *
   * The bound holds the workspace of the link, the scope of the link, the note
   * kind, and the live state, and it joins the current head only. A note in
   * the Trash, a note of another workspace, and a note beside the folder of a
   * folder link are all outside it.
   */
  const scopedNotes = async (
    open: StoredPublication,
    narrow: SQL | undefined,
    limit: number,
  ): Promise<readonly ScopedNoteRow[]> => {
    if (limit <= 0) return [];
    return db
      .select({
        fileId: files.id,
        path: files.path,
        deleted: files.deleted,
        revisionId: revisions.id,
        updatedAt: files.updatedAt,
        text: contents.markdown,
      })
      .from(files)
      .innerJoin(
        revisions,
        and(
          eq(revisions.workspaceId, files.workspaceId),
          eq(revisions.id, files.headRevisionId),
        ),
      )
      .innerJoin(
        contents,
        and(
          eq(contents.workspaceId, revisions.workspaceId),
          eq(contents.digest, revisions.contentDigest),
        ),
      )
      .where(
        and(
          eq(files.workspaceId, open.link.workspaceId),
          eq(files.kind, 'note'),
          eq(files.deleted, false),
          isNotNull(files.headRevisionId),
          eq(contents.kind, 'markdown'),
          scopeBound(open),
          narrow,
        ),
      )
      .orderBy(files.path)
      .limit(Math.min(Math.trunc(limit), maxListedFiles));
  };

  /** The head revision of each attachment file of these stored paths. */
  const attachmentHeads = async (
    open: StoredPublication,
    paths: readonly string[],
  ): Promise<
    readonly { readonly path: string; readonly revisionId: string }[]
  > => {
    if (paths.length === 0) return [];
    const rows = await db
      .select({ path: files.path, revisionId: revisions.id })
      .from(files)
      .innerJoin(
        revisions,
        and(
          eq(revisions.workspaceId, files.workspaceId),
          eq(revisions.id, files.headRevisionId),
        ),
      )
      .where(
        and(
          eq(files.workspaceId, open.link.workspaceId),
          eq(files.kind, 'attachment'),
          eq(files.deleted, false),
          isNotNull(files.headRevisionId),
          inArray(files.path, [...paths]),
        ),
      )
      .limit(maxListedFiles);
    return rows;
  };

  return {
    async linkByTokenDigest(
      tokenDigest: string,
    ): Promise<PublishedLink | null> {
      // A value of another shape is at rest nowhere, because both digest
      // columns carry the same rule as a check constraint.
      if (!isSecretDigest(tokenDigest)) return null;
      const answer = await session.client.query<PublicationLookupRow>(
        'select * from public.notesapp_publication_by_token($1)',
        [tokenDigest],
      );
      const row = answer.rows[0];
      if (row === undefined) return null;
      const open = parsePublicationRow(row);
      // The row policies of every workspace table read the identity of the
      // transaction, which is the owner of this one link from here on.
      await session.adoptOwner(open.ownerAccountId);
      opened.set(open.link.publicationId, open);
      return open.link;
    },

    async ticketOfLink(
      link: PublishedLink,
      ticketDigest: string,
    ): Promise<ReadingTicket | null> {
      const open = requireOpen(link);
      if (!isSecretDigest(ticketDigest)) return null;
      const rows = await db
        .select({
          publicationId: readingTickets.publicationId,
          issuedAt: readingTickets.issuedAt,
          expiresAt: readingTickets.expiresAt,
        })
        .from(readingTickets)
        .where(
          and(
            eq(readingTickets.ticketDigest, ticketDigest),
            eq(readingTickets.workspaceId, open.link.workspaceId),
            eq(readingTickets.publicationId, open.link.publicationId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      return {
        publicationId: row.publicationId,
        issuedAt: row.issuedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      };
    },

    async noteOfLink(
      link: PublishedLink,
      fileId: string,
    ): Promise<PublishedNoteContent | null> {
      const open = requireOpen(link);
      // An identifier of another shape names no note. It answers nothing, so
      // the reader takes the one refusal instead of a server problem.
      if (!isUuid(fileId)) return null;
      const rows = await scopedNotes(open, eq(files.id, fileId), 1);
      const row = rows[0];
      if (row === undefined) return null;
      return { ...publishedNote(row), text: publishedText(row) };
    },

    async notesOfLink(
      link: PublishedLink,
      limit: number,
    ): Promise<readonly PublishedNote[]> {
      const open = requireOpen(link);
      const rows = await scopedNotes(open, undefined, limit);
      return rows.map(publishedNote);
    },

    async attachmentsOfNote(
      link: PublishedLink,
      note: PublishedNote,
    ): Promise<readonly PublishedAttachmentReference[]> {
      const open = requireOpen(link);
      if (!isUuid(note.fileId)) return [];
      // The answer states what the current head names, so it reads the note
      // again through the one scoped query rather than trusting the record.
      const rows = await scopedNotes(open, eq(files.id, note.fileId), 1);
      const row = rows[0];
      if (row === undefined) return [];
      const references = extractAttachmentRefs(publishedText(row), row.path);
      // The written form of each reference keys the answer, because that is
      // the text that the renderer of a reader surface hands to its resolver.
      const named = new Map<string, string>();
      const paths = new Set<string>();
      for (const reference of references) {
        // A reference of version 0.1.0 names the revision itself. A portable
        // reference names a path, and the current head of that file is the
        // revision that a reader may read.
        if (reference.revisionId !== null)
          named.set(reference.revisionId, reference.revisionId);
        else if (reference.targetPath !== null) paths.add(reference.targetPath);
      }
      for (const head of await attachmentHeads(open, [...paths]))
        named.set(head.path, head.revisionId);
      return [...named].map(([reference, revisionId]) => ({
        reference,
        revisionId,
      }));
    },
  };
}
