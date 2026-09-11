/**
 * Handlers of the operations that the contract declares today.
 *
 * A handler returns a status, a media type, and a body. The boundary validates
 * that body against the declared response schema before it is sent, so a
 * handler never has to repeat the contract shape.
 */
import { access, constants } from 'node:fs/promises';
import pg from 'pg';
import type { WorkspaceAdminStore, WorkspaceStore } from '@notesapp/core';
import type { ServerConfig } from '../config.ts';
import { readProperty } from '../values.ts';
import { createAccountHandlers } from './accounts.ts';
import { createExportHandlers } from './export.ts';
import { createFileHandlers, missingWorkspaceStore } from './files.ts';
import { createWorkspaceHandlers } from './workspaces.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';
import { createProblem, problemMediaType } from '../plugins/problem.ts';

import {
  requiredSchemaVersion,
  type AttachmentStore,
} from '@notesapp/storage-server';
import { createAttachmentHandlers } from './attachments.ts';
import { createHistoryHandlers } from './history.ts';
import { createSyncHandlers } from './sync.ts';
import { createSearchHandlers } from './search.ts';

/**
 * A store that is not there yet.
 *
 * Every deployment supplies the real store. A test that only checks the
 * service operations may leave it out, and then an account operation answers
 * with a generic server error instead of pretending to work.
 */
function missingStore(): WorkspaceAdminStore {
  const fail = (): never => {
    throw new Error('notesapp: the server was built without an account store.');
  };
  return { account: fail, workspace: fail };
}

function missingAttachmentStore(): AttachmentStore {
  const fail = (): never => {
    throw new Error(
      'notesapp: the server was built without an attachment store.',
    );
  };
  return {
    saveTemporaryAttachment: fail,
    getAttachmentObject: fail,
    finalizeAttachmentObject: fail,
    readAttachmentRevision: fail,
    reclaimAttachments: fail,
    temporaryPath: fail,
    immutablePath: fail,
  };
}

/** What the account and workspace handlers need from the composition. */
export type HandlerDependencies = {
  /** The account and workspace store of the deployment. */
  readonly store?: WorkspaceAdminStore;
  /** The workspace content store of the deployment. */
  readonly content?: WorkspaceStore;
  /** The attachment store of the deployment. */
  readonly attachments?: AttachmentStore;
};

const jsonMediaType = 'application/json';

/** Readiness of one startup requirement. */
export type ReadinessCheck = {
  readonly name: string;
  readonly status: 'ok' | 'degraded';
  readonly detail?: string;
};

/**
 * One startup requirement that readiness reports.
 *
 * The list is injectable, so the task that adds PostgreSQL adds a database
 * probe and the task that adds attachment storage adds a storage probe without
 * changing this module, and a test can force a degraded report.
 */
export type ReadinessProbe = () => Promise<ReadinessCheck>;

/** Amount of readiness information the caller asked for. */
function readDetailLevel(query: unknown): 'summary' | 'full' {
  return readProperty(query, 'detail') === 'summary' ? 'summary' : 'full';
}

/**
 * The only requirement this release can check.
 *
 * No database and no attachment storage exists yet, so nothing else is
 * checked. The tasks that add them add their own probes.
 */
export function configurationProbe(config: ServerConfig): ReadinessProbe {
  return () =>
    Promise.resolve(
      config.allowedHosts.length > 0
        ? {
            name: 'configuration',
            status: 'ok',
            detail: 'Configuration was validated at startup.',
          }
        : {
            name: 'configuration',
            status: 'degraded',
            detail: 'The deployment serves no Host value.',
          },
    );
}

/** Checks database connectivity and query response. */
export function databaseProbe(databaseUrl: string): ReadinessProbe {
  return async () => {
    const client = new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 3000,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return {
        name: 'database',
        status: 'ok',
        detail: 'Database connection is healthy.',
      };
    } catch {
      try {
        await client.end();
      } catch {
        // Ignore disconnect failure on already failed connection.
      }
      return {
        name: 'database',
        status: 'degraded',
        detail: 'Database connection failed.',
      };
    }
  };
}

/** Checks storage root accessibility and writability. */
export function storageProbe(storageRoot: string): ReadinessProbe {
  return async () => {
    try {
      await access(storageRoot, constants.R_OK | constants.W_OK);
      return {
        name: 'storage',
        status: 'ok',
        detail: 'Storage directory is accessible and writable.',
      };
    } catch {
      return {
        name: 'storage',
        status: 'degraded',
        detail: 'Storage directory is not accessible or writable.',
      };
    }
  };
}

/** Checks schema migration status. */
export function migrationProbe(databaseUrl: string): ReadinessProbe {
  return async () => {
    const client = new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 3000,
    });
    try {
      await client.connect();
      const result = await client.query<{ version: number }>(
        'SELECT public.notesapp_schema_version() AS version',
      );
      await client.end();
      const version = result.rows[0]?.version ?? 0;
      if (version >= requiredSchemaVersion) {
        return {
          name: 'migration',
          status: 'ok',
          detail: 'Database schema migrations are complete.',
        };
      }
      return {
        name: 'migration',
        status: 'degraded',
        detail: `Database schema version ${version} is incomplete; version ${requiredSchemaVersion} is required.`,
      };
    } catch {
      try {
        await client.end();
      } catch {
        // Ignore disconnect failure on already failed connection.
      }
      return {
        name: 'migration',
        status: 'degraded',
        detail: 'Failed to verify schema migrations.',
      };
    }
  };
}

/** Runs every probe and combines the result. */
export async function evaluateReadiness(
  probes: readonly ReadinessProbe[],
  level: 'summary' | 'full',
): Promise<{ status: 'ok' | 'degraded'; checks: readonly ReadinessCheck[] }> {
  const results = await Promise.all(probes.map((probe) => probe()));
  const checks = results.map((check) =>
    level === 'full' ? check : { name: check.name, status: check.status },
  );
  return {
    status: checks.some((check) => check.status === 'degraded')
      ? 'degraded'
      : 'ok',
    checks,
  };
}

/**
 * Builds the handler map for the operations in the contract.
 *
 * An operation that a protocol library serves has no entry here. The contract
 * marks such an operation, and `registerOperations` mounts it through that
 * adapter's exact path list instead.
 */
export function createHandlers(
  config: ServerConfig,
  probes: readonly ReadinessProbe[] = [configurationProbe(config)],
  dependencies: HandlerDependencies = {},
): HandlerMap {
  const store = dependencies.store ?? missingStore();
  return {
    ...createAccountHandlers(store),
    ...createFileHandlers(dependencies.content ?? missingWorkspaceStore()),
    ...createHistoryHandlers(dependencies.content ?? missingWorkspaceStore()),
    ...createSyncHandlers(dependencies.content ?? missingWorkspaceStore()),
    ...createSearchHandlers(dependencies.content ?? missingWorkspaceStore()),
    ...createAttachmentHandlers(
      dependencies.content ?? missingWorkspaceStore(),
      dependencies.attachments ?? missingAttachmentStore(),
    ),
    ...createExportHandlers(
      dependencies.content ?? missingWorkspaceStore(),
      dependencies.attachments ?? missingAttachmentStore(),
    ),
    ...createWorkspaceHandlers(store),
    getHealth: (): Promise<HandlerResult> =>
      Promise.resolve({
        status: 200,
        mediaType: jsonMediaType,
        body: { status: 'ok' },
      }),
    getReadiness: async (request): Promise<HandlerResult> => {
      const report = await evaluateReadiness(
        probes,
        readDetailLevel(request.query),
      );
      if (report.status === 'ok')
        return { status: 200, mediaType: jsonMediaType, body: report };
      return {
        status: 503,
        mediaType: problemMediaType,
        body: createProblem({
          code: 'not_ready',
          status: 503,
          detail: `Degraded checks: ${report.checks
            .filter((check) => check.status === 'degraded')
            .map((check) => check.name)
            .join(', ')}.`,
          instance: request.url.split('?')[0] ?? request.url,
          requestId: request.id,
        }),
      };
    },
  };
}
