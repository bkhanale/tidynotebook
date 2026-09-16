/**
 * Handlers of the operations that the contract declares today.
 *
 * A handler returns a status, a media type, and a body. The boundary validates
 * that body against the declared response schema before it is sent, so a
 * handler never has to repeat the contract shape. The body of each handler
 * lives in the file of its area, and this file only assembles the map.
 */
import type { WorkspaceAdminStore, WorkspaceStore } from '@notesapp/core';
import type { ServerConfig } from '../config.ts';
import type { ServiceLifecycle } from '../lifecycle.ts';
import { runningLifecycle } from '../lifecycle.ts';
import { createAccountHandlers } from './accounts.ts';
import { createExportHandlers } from './export.ts';
import { createFileHandlers, missingWorkspaceStore } from './files.ts';
import { createWorkspaceHandlers } from './workspaces.ts';
import type { ReadinessProbe } from './health.ts';
import { configurationProbe, createServiceHandlers } from './health.ts';
import type { HandlerMap } from '../plugins/register.ts';

import { type AttachmentStore } from '@notesapp/storage-server';
import { createAttachmentHandlers } from './attachments.ts';
import { createHistoryHandlers } from './history.ts';
import { createSyncHandlers } from './sync.ts';
import { createSearchHandlers } from './search.ts';
import { createImportHandlers } from './import.ts';
import { createBacklinkHandlers } from './backlinks.ts';
import { createPublicationHandlers } from './publications.ts';
import { createPublishedHandlers } from './published.ts';

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
    readPublishedAttachmentRevision: fail,
    reclaimAttachments: fail,
    temporaryPath: fail,
    immutablePath: fail,
  };
}

/** What the handlers need from the composition. */
export type HandlerDependencies = {
  /** The account and workspace store of the deployment. */
  readonly store?: WorkspaceAdminStore;
  /** The workspace content store of the deployment. */
  readonly content?: WorkspaceStore;
  /** The attachment store of the deployment. */
  readonly attachments?: AttachmentStore;
  /**
   * The lifecycle state of the process, which the readiness answer reads.
   *
   * `main.ts` owns it and the stop moves it. A server that owns no signal
   * handler leaves it out and always reports that it runs.
   */
  readonly lifecycle?: ServiceLifecycle;
};

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
  const lifecycle = dependencies.lifecycle ?? runningLifecycle;
  return {
    ...createAccountHandlers(store),
    ...createFileHandlers(dependencies.content ?? missingWorkspaceStore()),
    ...createHistoryHandlers(dependencies.content ?? missingWorkspaceStore()),
    ...createSyncHandlers(dependencies.content ?? missingWorkspaceStore()),
    ...createSearchHandlers(dependencies.content ?? missingWorkspaceStore()),
    ...createBacklinkHandlers(dependencies.content ?? missingWorkspaceStore()),
    ...createAttachmentHandlers(
      dependencies.content ?? missingWorkspaceStore(),
      dependencies.attachments ?? missingAttachmentStore(),
      config.limits.uploadIdleTimeoutMs,
    ),
    ...createExportHandlers(
      dependencies.content ?? missingWorkspaceStore(),
      dependencies.attachments ?? missingAttachmentStore(),
    ),
    ...createImportHandlers(
      dependencies.content ?? missingWorkspaceStore(),
      dependencies.attachments ?? missingAttachmentStore(),
    ),
    ...createWorkspaceHandlers(store),
    ...createPublicationHandlers(),
    ...createPublishedHandlers(),
    ...createServiceHandlers(probes, lifecycle),
  };
}
