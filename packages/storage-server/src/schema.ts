/**
 * PostgreSQL schema of the accepted workspace state.
 *
 * Every table that holds workspace content carries `workspace_id`, and every
 * child reference is a composite foreign key `(workspace_id, ...)` to its
 * parent. A row therefore cannot point at a row of another workspace, because
 * the pair would not exist in the parent table.
 *
 * Drizzle owns the tables, columns, keys, and indexes below. It cannot express
 * roles, row level security, immutability triggers, or a deferrable unique
 * constraint. The handwritten half of the single migration
 * `migrations/0000_initial.sql` carries those statements. See
 * `docs/development/database.md`.
 */
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * A workspace membership role.
 *
 * The product serves one account, so `owner` is the only role. The enum stays
 * because the policies and the owner guard read it.
 */
export const membershipRole = pgEnum('membership_role', ['owner']);

/** Whether a file holds Markdown or an attachment. */
export const fileKind = pgEnum('file_kind', ['note', 'attachment']);

/** Whether stored content holds Markdown text or an attachment reference. */
export const contentKind = pgEnum('content_kind', ['markdown', 'attachment']);

/** The transfer state of an immutable attachment object. */
export const attachmentState = pgEnum('attachment_state', [
  'temporary',
  'finalized',
  'unavailable',
]);

/** The kind of entity that one incremental sync record refers to. */
export const syncEntityKind = pgEnum('sync_entity_kind', [
  'file',
  'membership',
]);

/**
 * Application owned account identity.
 *
 * The row carries no personal data. Task 5 adds the configured Better Auth
 * tables and maps a verified user to one of these identifiers.
 */
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** One workspace. Every content row below belongs to exactly one of these. */
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  /** True for the workspace that was created together with its account. */
  personal: boolean('personal').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Stored bytes and the operator configured limit of one workspace. */
export const workspaceUsage = pgTable('workspace_usage', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id),
  bytesUsed: bigint('bytes_used', { mode: 'bigint' }).notNull(),
  quotaBytes: bigint('quota_bytes', { mode: 'bigint' }).notNull(),
});

/**
 * The last allocated commit ordered cursor of one workspace.
 *
 * A plain sequence can skip a transaction that commits late, so the cursor is
 * allocated under the workspace row lock instead.
 */
export const workspaceCursors = pgTable('workspace_cursors', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id),
  lastCursor: bigint('last_cursor', { mode: 'bigint' }).notNull(),
});

/** One role of one account in one workspace. */
export const memberships = pgTable(
  'memberships',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    role: membershipRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.accountId] }),
    index('memberships_account_idx').on(table.accountId),
  ],
);

/**
 * One file and its accepted state.
 *
 * `head_revision_id` is null while a file has no accepted revision. Such a
 * file holds no row in `live_paths`, so it cannot occupy an accepted path.
 */
export const files = pgTable(
  'files',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    id: uuid('id').notNull(),
    path: text('path').notNull(),
    kind: fileKind('kind').notNull(),
    headRevisionId: uuid('head_revision_id'),
    deleted: boolean('deleted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    index('files_live_idx').on(table.workspaceId, table.deleted),
  ],
);

/** One immutable attachment object on the private server volume. */
export const attachmentObjects = pgTable(
  'attachment_objects',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    id: uuid('id').notNull(),
    digest: text('digest').notNull(),
    size: bigint('size', { mode: 'bigint' }).notNull(),
    mediaType: text('media_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    state: attachmentState('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    /** When the reclaim handled the bytes of this object. */
    reclaimedAt: timestamp('reclaimed_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    index('attachment_objects_digest_idx').on(table.workspaceId, table.digest),
    check('attachment_objects_size_check', sql`${table.size} >= 0`),
  ],
);

/**
 * Attachment bytes that wait for the reclaim after a workspace deletion.
 *
 * A workspace deletion removes the attachment rows, so the digests move here
 * first. The row outlives the workspace row and therefore carries no foreign
 * key. Only the SECURITY DEFINER reclaim functions reach this table.
 */
export const attachmentReclaimQueue = pgTable(
  'attachment_reclaim_queue',
  {
    workspaceId: uuid('workspace_id').notNull(),
    objectId: uuid('object_id').notNull(),
    digest: text('digest').notNull(),
    queuedAt: timestamp('queued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'attachment_reclaim_queue_pk',
      columns: [table.workspaceId, table.objectId],
    }),
  ],
);

/**
 * Immutable content, addressed by its digest inside one workspace.
 *
 * Deduplication stays inside a workspace, so one workspace cannot learn that
 * another holds the same bytes.
 */
export const contents = pgTable(
  'contents',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    digest: text('digest').notNull(),
    kind: contentKind('kind').notNull(),
    size: bigint('size', { mode: 'bigint' }).notNull(),
    markdown: text('markdown'),
    objectId: uuid('object_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.digest] }),
    foreignKey({
      name: 'contents_object_fk',
      columns: [table.workspaceId, table.objectId],
      foreignColumns: [attachmentObjects.workspaceId, attachmentObjects.id],
    }),
    check(
      'contents_body_check',
      sql`(${table.kind} = 'markdown' and ${table.markdown} is not null and ${table.objectId} is null)
        or (${table.kind} = 'attachment' and ${table.objectId} is not null and ${table.markdown} is null)`,
    ),
    check('contents_size_check', sql`${table.size} >= 0`),
  ],
);

/**
 * One atomic operation over one or more files.
 *
 * The mutation identity is bound to the actor, so a replay cannot reuse the
 * identity of another account. `server_time` is the acceptance time. It uses
 * `clock_timestamp()`, not `now()`, so two changesets of one transaction keep
 * the order of their cursors.
 */
export const changesets = pgTable(
  'changesets',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    id: uuid('id').notNull(),
    mutationId: uuid('mutation_id').notNull(),
    actorAccountId: uuid('actor_account_id')
      .notNull()
      .references(() => accounts.id),
    deviceId: text('device_id').notNull(),
    requestDigest: text('request_digest').notNull(),
    serverTime: timestamp('server_time', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    cursor: bigint('cursor', { mode: 'bigint' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    unique('changesets_mutation_key').on(
      table.workspaceId,
      table.actorAccountId,
      table.mutationId,
    ),
    unique('changesets_cursor_key').on(table.workspaceId, table.cursor),
  ],
);

/**
 * One immutable revision of one file.
 *
 * `client_time` stays informational. `server_time` is the acceptance time and
 * uses `clock_timestamp()`, so it is monotone with the cursor order.
 */
export const revisions = pgTable(
  'revisions',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    id: uuid('id').notNull(),
    fileId: uuid('file_id').notNull(),
    contentDigest: text('content_digest').notNull(),
    path: text('path').notNull(),
    deleted: boolean('deleted').notNull(),
    changesetId: uuid('changeset_id').notNull(),
    actorAccountId: uuid('actor_account_id')
      .notNull()
      .references(() => accounts.id),
    clientTime: timestamp('client_time', { withTimezone: true }).notNull(),
    serverTime: timestamp('server_time', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    message: text('message'),
    restoredFrom: uuid('restored_from'),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      name: 'revisions_file_fk',
      columns: [table.workspaceId, table.fileId],
      foreignColumns: [files.workspaceId, files.id],
    }),
    foreignKey({
      name: 'revisions_content_fk',
      columns: [table.workspaceId, table.contentDigest],
      foreignColumns: [contents.workspaceId, contents.digest],
    }),
    foreignKey({
      name: 'revisions_changeset_fk',
      columns: [table.workspaceId, table.changesetId],
      foreignColumns: [changesets.workspaceId, changesets.id],
    }),
    foreignKey({
      name: 'revisions_restored_from_fk',
      columns: [table.workspaceId, table.restoredFrom],
      foreignColumns: [table.workspaceId, table.id],
    }),
    index('revisions_file_idx').on(table.workspaceId, table.fileId),
    index('revisions_changeset_idx').on(table.workspaceId, table.changesetId),
    index('revisions_restored_from_idx').on(
      table.workspaceId,
      table.restoredFrom,
    ),
  ],
);

/**
 * The parents of one revision, in submitted order.
 *
 * A first revision has no row, a normal revision has one, and an explicit
 * merge has two.
 */
export const revisionParents = pgTable(
  'revision_parents',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    childId: uuid('child_id').notNull(),
    parentId: uuid('parent_id').notNull(),
    ordinal: integer('ordinal').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.childId, table.ordinal],
    }),
    foreignKey({
      name: 'revision_parents_child_fk',
      columns: [table.workspaceId, table.childId],
      foreignColumns: [revisions.workspaceId, revisions.id],
    }),
    foreignKey({
      name: 'revision_parents_parent_fk',
      columns: [table.workspaceId, table.parentId],
      foreignColumns: [revisions.workspaceId, revisions.id],
    }),
    unique('revision_parents_edge_key').on(
      table.workspaceId,
      table.childId,
      table.parentId,
    ),
    index('revision_parents_parent_idx').on(table.workspaceId, table.parentId),
    check('revision_parents_ordinal_check', sql`${table.ordinal} >= 0`),
    check(
      'revision_parents_self_check',
      sql`${table.childId} <> ${table.parentId}`,
    ),
  ],
);

/**
 * The accepted live path of one file.
 *
 * A partial unique index cannot be deferred, so accepted path uniqueness uses
 * this table instead. Its unique constraint on `(workspace_id, path)` is
 * `DEFERRABLE INITIALLY DEFERRED`, which permits an atomic swap of two paths
 * inside one transaction. A row exists only while the file is live, so a
 * deleted file holds no accepted path.
 */
export const livePaths = pgTable(
  'live_paths',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    fileId: uuid('file_id').notNull(),
    path: text('path').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.fileId] }),
    foreignKey({
      name: 'live_paths_file_fk',
      columns: [table.workspaceId, table.fileId],
      foreignColumns: [files.workspaceId, files.id],
    }),
  ],
);

/**
 * The stored outcome of an accepted mutation.
 *
 * A retry with the same identity and the same request digest returns this
 * outcome. A retry with a different digest is rejected. The record is bound to
 * the actor.
 */
export const mutationReceipts = pgTable(
  'mutation_receipts',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    actorAccountId: uuid('actor_account_id')
      .notNull()
      .references(() => accounts.id),
    mutationId: uuid('mutation_id').notNull(),
    requestDigest: text('request_digest').notNull(),
    outcome: jsonb('outcome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.actorAccountId, table.mutationId],
    }),
  ],
);

/**
 * A content free marker of a permanently deleted file.
 *
 * The marker has no foreign key to `files`, because purge removes that row.
 * It stays until the workspace is deleted, so a late offline write cannot
 * recreate the identifier.
 */
export const purgeMarkers = pgTable(
  'purge_markers',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    fileId: uuid('file_id').notNull(),
    purgedAt: timestamp('purged_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.fileId] })],
);

/** One commit ordered incremental change record. */
export const syncChanges = pgTable(
  'sync_changes',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    cursor: bigint('cursor', { mode: 'bigint' }).notNull(),
    entityKind: syncEntityKind('entity_kind').notNull(),
    entityId: uuid('entity_id').notNull(),
    revisionId: uuid('revision_id'),
    deleted: boolean('deleted').notNull().default(false),
    committedAt: timestamp('committed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.workspaceId,
        table.cursor,
        table.entityKind,
        table.entityId,
      ],
    }),
  ],
);

/** A bounded materialized download snapshot, addressed by its token hash. */
export const snapshots = pgTable(
  'snapshots',
  {
    tokenHash: text('token_hash').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    cursor: bigint('cursor', { mode: 'bigint' }).notNull(),
    itemCount: integer('item_count').notNull(),
    pageSize: integer('page_size').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('snapshots_expiry_idx').on(table.workspaceId, table.expiresAt),
  ],
);

/** One pinned revision inside a snapshot page. */
export const snapshotItems = pgTable(
  'snapshot_items',
  {
    tokenHash: text('token_hash')
      .notNull()
      .references(() => snapshots.tokenHash, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    fileId: uuid('file_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tokenHash, table.ordinal] }),
    foreignKey({
      name: 'snapshot_items_revision_fk',
      columns: [table.workspaceId, table.revisionId],
      foreignColumns: [revisions.workspaceId, revisions.id],
    }),
    index('snapshot_items_workspace_idx').on(table.workspaceId),
  ],
);

/** One link found in an accepted revision. */
export const linkIndex = pgTable(
  'link_index',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    sourceFileId: uuid('source_file_id').notNull(),
    sourceRevisionId: uuid('source_revision_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    targetFileId: uuid('target_file_id'),
    sourceText: text('source_text').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.sourceRevisionId, table.ordinal],
    }),
    foreignKey({
      name: 'link_index_source_file_fk',
      columns: [table.workspaceId, table.sourceFileId],
      foreignColumns: [files.workspaceId, files.id],
    }),
    foreignKey({
      name: 'link_index_source_revision_fk',
      columns: [table.workspaceId, table.sourceRevisionId],
      foreignColumns: [revisions.workspaceId, revisions.id],
    }),
    index('link_index_target_idx').on(table.workspaceId, table.targetFileId),
  ],
);

/** The current accepted searchable text of one live note. */
export const searchIndex = pgTable(
  'search_index',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    fileId: uuid('file_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    path: text('path').notNull(),
    searchText: text('search_text').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.fileId] }),
    foreignKey({
      name: 'search_index_file_fk',
      columns: [table.workspaceId, table.fileId],
      foreignColumns: [files.workspaceId, files.id],
    }),
    foreignKey({
      name: 'search_index_revision_fk',
      columns: [table.workspaceId, table.revisionId],
      foreignColumns: [revisions.workspaceId, revisions.id],
    }),
    index('search_index_document_idx').using(
      'gin',
      sql`to_tsvector('simple', ${table.searchText})`,
    ),
  ],
);

/**
 * Better Auth tables.
 *
 * Better Auth owns the shape of the four tables below. The column names use
 * the field names of the pinned Better Auth configuration, because its Drizzle
 * adapter reads a field through the property of this table object. The table
 * names carry an `auth_` prefix, so the identity tables never collide with the
 * application's own `accounts` table and `user` stays a reserved word that
 * this schema does not use.
 *
 * These tables are not scoped by a workspace. Sign-in has to find a user by an
 * address before any identity exists, so no row policy can narrow them by the
 * account of the transaction. `docs/development/identity.md` records that
 * exception and the table rights that bound it.
 */
export const authUser = pgTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** One browser session of one Better Auth user. */
export const authSession = pgTable(
  'auth_session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('auth_session_user_idx').on(table.userId)],
);

/**
 * One credential or one external identity of a Better Auth user.
 *
 * An external identity is keyed by `issuer` and `account_id`, which are the
 * OpenID Connect issuer and subject. Two identities of different issuers are
 * therefore never the same account, and a matching address alone never joins
 * them.
 */
export const authAccount = pgTable(
  'auth_account',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('auth_account_user_idx').on(table.userId),
    unique('auth_account_key').on(
      table.issuer,
      table.providerId,
      table.accountId,
    ),
  ],
);

/** One short lived verification value, for example a password reset token. */
export const authVerification = pgTable(
  'auth_verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('auth_verification_identifier_idx').on(table.identifier)],
);

/**
 * The map from a Better Auth user to an application account.
 *
 * The application identifies an account by a UUID that never changes, so the
 * identity provider can change without rewriting every workspace row. One
 * Better Auth user maps to exactly one account and back.
 */
export const accountIdentities = pgTable('account_identities', {
  authUserId: text('auth_user_id')
    .primaryKey()
    .references(() => authUser.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id')
    .notNull()
    .unique()
    .references(() => accounts.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A content free record of a protected action of one account.
 *
 * The trail belongs to an account and not to a workspace, so it can hold the
 * record of a workspace deletion and of a password recovery. The first removes
 * every row of the workspace it describes, and the second belongs to no
 * workspace at all.
 */
export const accountAuditEvents = pgTable(
  'account_audit_events',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    action: text('action').notNull(),
    targetKind: text('target_kind').notNull(),
    targetId: uuid('target_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('account_audit_events_account_idx').on(
      table.accountId,
      table.createdAt,
    ),
  ],
);

/** Settings that follow one account to every device. */
export const accountPreferences = pgTable('account_preferences', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.id),
  theme: text('theme').notNull().default('system'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
