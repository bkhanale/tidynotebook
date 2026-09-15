/**
 * The message shape of the cross-tab invalidation channel.
 *
 * Every open tab of one origin shares a `BroadcastChannel`, and a message on
 * it arrives as `unknown`: an older tab of this application, a newer one, or
 * another page of the same origin can post anything. A message that reaches a
 * listener would tell a screen to read a file again, so the parser here is the
 * boundary that proves the shape first.
 *
 * A bad message is not a defect of this application, so it is dropped rather
 * than thrown. The other tab keeps its own state, and this tab shows what it
 * already read.
 */
import type { LocalChange } from '@notesapp/sync';

/** The kinds of change that one tab announces to the others. */
const changeKinds = [
  'draft',
  'queue',
  'file',
  'purge',
  'conflict',
  'cursor',
  'reset',
] as const;

/** One change that the channel carries, or `null` for a message to drop. */
export function localChangeOf(value: unknown): LocalChange | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;
  // Only own enumerable members count, so an inherited member of a value that
  // another page of this origin posted cannot pass a check.
  const record: Record<string, unknown> = Object.fromEntries(
    Object.entries(value),
  );
  const accountId: unknown = record['accountId'];
  const workspaceId: unknown = record['workspaceId'];
  const fileId: unknown = record['fileId'];
  const kind: unknown = record['kind'];
  if (typeof accountId !== 'string' || accountId === '') return null;
  if (typeof workspaceId !== 'string' || workspaceId === '') return null;
  if (fileId !== null && typeof fileId !== 'string') return null;
  const known = changeKinds.find((entry) => entry === kind);
  if (known === undefined) return null;
  return { accountId, workspaceId, fileId, kind: known };
}
