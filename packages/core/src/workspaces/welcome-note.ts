/** Durable completion of the first note in a personal workspace. */
import type { Actor } from '../identity/actor.ts';
import type { ControlStanding } from '../identity/controls.ts';
import { commitChangeset } from '../files/commit.ts';
import {
  fail,
  ok,
  type ChangesetInput,
  type DomainErrorCode,
  type Result,
} from '../files/model.ts';
import type { WorkspaceStore } from '../files/ports.ts';

/** All calls use one workspace lock and one database transaction. */
export type WelcomeNoteTransaction = {
  /** Null for an ineligible workspace, including another person's workspace. */
  state(): Promise<{
    readonly completed: boolean;
    readonly standing: ControlStanding;
  } | null>;
  /** A content store bound to this same transaction, with no nested commit. */
  readonly content: WorkspaceStore;
  /** Null completes the seed. A refusal leaves it pending for another attempt. */
  record(code: DomainErrorCode | 'unexpected' | null): Promise<void>;
};

/** The separate port leaves ordinary content transactions unchanged. */
export type WelcomeNoteStore = {
  /** A read without the workspace write lock. Completion checks again under the lock. */
  pendingWelcomeNote(actor: Actor, workspaceId: string): Promise<boolean>;
  welcomeNote<T>(
    actor: Actor,
    workspaceId: string,
    run: (tx: WelcomeNoteTransaction) => Promise<T>,
  ): Promise<T>;
};

export type WelcomeNoteOutcome = 'created' | 'pending' | 'unchanged';

/** Completes a pending note once. A deleted completed note stays deleted. */
export async function completeWelcomeNote(
  store: WelcomeNoteStore,
  actor: Actor,
  input: ChangesetInput,
  digest: string,
): Promise<Result<WelcomeNoteOutcome>> {
  if (!(await store.pendingWelcomeNote(actor, input.workspaceId)))
    return ok('unchanged');
  return store.welcomeNote(actor, input.workspaceId, async (tx) => {
    const state = await tx.state();
    if (state === null || state.completed) return ok('unchanged');
    if (state.standing === 'locked') return ok('pending');
    const written = await commitChangeset(tx.content, actor, input, digest);
    await tx.record(written.ok ? null : written.error.code);
    return written.ok ? ok('created') : fail(written.error.code);
  });
}
