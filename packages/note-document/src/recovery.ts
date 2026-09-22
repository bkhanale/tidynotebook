/**
 * Bounded recovery of legacy text (record 0084).
 *
 * This is not the normal merge. A document merges by identity; three text
 * values have no identities, so placement can be ambiguous. Migration and
 * repair are the only callers: they hold a base text, the local text, and the
 * accepted text, and nothing else.
 *
 * The rule is careful on purpose. It joins two changes only when each one
 * sits in its own region of the base and its placement is the only one that
 * the texts allow. Anything else is reported as ambiguous, and the caller
 * keeps the original work and offers Review. Nothing here normalizes a line
 * ending or a Unicode form.
 */
import { diffArrays } from 'diff';
import { documentBounds, type DocumentBounds } from './bounds.ts';

/** Why a recovery cannot place work by text alone. */
export type RecoveryAmbiguity =
  /** Both texts changed the same region of the base. */
  | 'overlapping-change'
  /** Both texts made the same change, which may be one change twice. */
  | 'duplicate-change'
  /** The base repeats the text around a change, so its place is not fixed. */
  | 'repeated-text';

/** The outcome of one recovery. */
export type RecoveryOutcome =
  /** The two changes joined, and this is the text they produce. */
  | { readonly kind: 'merged'; readonly text: string }
  /** The texts do not state where the work belongs. */
  | { readonly kind: 'ambiguous'; readonly reason: RecoveryAmbiguity }
  /** The work is past a recovery bound. */
  | { readonly kind: 'too-large' };

/** The three texts of one recovery. */
export type RecoveryInput = {
  /** The text that both sides started from. */
  readonly base: string;
  /** The text of this device. */
  readonly local: string;
  /** The accepted text of the server. */
  readonly accepted: string;
};

/** One replaced range of the base, in lines. */
type Hunk = {
  readonly start: number;
  readonly deleted: number;
  readonly inserted: readonly string[];
};

/**
 * Splits text into lines that keep their terminator.
 *
 * A carriage return stays with its line, so no line ending changes, and text
 * without a final terminator keeps its last line as it is.
 */
export function splitLines(text: string): string[] {
  return text === '' ? [] : text.split(/(?<=\n)/u);
}

/** Reads the changes of one text against the base, as hunks of base lines. */
function hunksOf(
  base: readonly string[],
  other: readonly string[],
  bounds: DocumentBounds,
): Hunk[] | null {
  const parts = diffArrays<string, string>([...base], [...other], {
    maxEditLength: bounds.maxRecoveryEdits,
  });
  if (parts === undefined) return null;
  const hunks: Hunk[] = [];
  let position = 0;
  let pending: { start: number; deleted: number; inserted: string[] } | null =
    null;
  for (const part of parts) {
    if (part.added === true) {
      pending ??= { start: position, deleted: 0, inserted: [] };
      pending.inserted.push(...part.value);
      continue;
    }
    if (part.removed === true) {
      pending ??= { start: position, deleted: 0, inserted: [] };
      pending.deleted += part.value.length;
      position += part.value.length;
      continue;
    }
    if (pending !== null) {
      hunks.push(pending);
      pending = null;
    }
    position += part.value.length;
  }
  if (pending !== null) hunks.push(pending);
  return hunks;
}

/** Whether two hunks hold the same change. */
function sameHunk(one: Hunk, other: Hunk): boolean {
  return (
    one.start === other.start &&
    one.deleted === other.deleted &&
    one.inserted.length === other.inserted.length &&
    one.inserted.every((line, index) => line === other.inserted[index])
  );
}

/** Whether two hunks touch or overlap the same region of the base. */
function touches(one: Hunk, other: Hunk): boolean {
  const oneEnd = one.start + one.deleted;
  const otherEnd = other.start + other.deleted;
  return one.start <= otherEnd && other.start <= oneEnd;
}

/**
 * Whether the same result could come from placing the hunk one line earlier
 * or one line later.
 *
 * This is the repeated passage of the design: the texts alone do not say
 * which copy the work belongs to, so the recovery refuses to guess.
 */
function slides(base: readonly string[], hunk: Hunk): boolean {
  const first = hunk.inserted[0];
  const last = hunk.inserted[hunk.inserted.length - 1];
  const before = base[hunk.start - 1];
  const after = base[hunk.start + hunk.deleted];
  if (hunk.inserted.length > 0) {
    if (before !== undefined && before === last) return true;
    if (after !== undefined && after === first) return true;
  }
  if (hunk.deleted > 0) {
    const firstDeleted = base[hunk.start];
    const lastDeleted = base[hunk.start + hunk.deleted - 1];
    if (before !== undefined && before === lastDeleted) return true;
    if (after !== undefined && after === firstDeleted) return true;
  }
  return false;
}

/** Applies hunks that do not touch each other, in base order. */
function applyHunks(base: readonly string[], hunks: readonly Hunk[]): string {
  const ordered = [...hunks].sort((one, other) => one.start - other.start);
  const out: string[] = [];
  let position = 0;
  for (const hunk of ordered) {
    out.push(...base.slice(position, hunk.start), ...hunk.inserted);
    position = hunk.start + hunk.deleted;
  }
  out.push(...base.slice(position));
  return out.join('');
}

/**
 * Joins local work and accepted work over one base text, or reports why it
 * cannot.
 *
 * The answer is the same for the same three texts, on every device.
 */
export function recoverLegacyText(
  input: RecoveryInput,
  bounds: DocumentBounds = documentBounds,
): RecoveryOutcome {
  if (input.local === input.accepted)
    return { kind: 'merged', text: input.local };
  if (input.local === input.base)
    return { kind: 'merged', text: input.accepted };
  if (input.accepted === input.base)
    return { kind: 'merged', text: input.local };
  const base = splitLines(input.base);
  const local = splitLines(input.local);
  const accepted = splitLines(input.accepted);
  if (
    base.length > bounds.maxRecoveryLines ||
    local.length > bounds.maxRecoveryLines ||
    accepted.length > bounds.maxRecoveryLines
  )
    return { kind: 'too-large' };
  const localHunks = hunksOf(base, local, bounds);
  const acceptedHunks = hunksOf(base, accepted, bounds);
  if (localHunks === null || acceptedHunks === null)
    return { kind: 'too-large' };
  for (const hunk of [...localHunks, ...acceptedHunks])
    if (slides(base, hunk))
      return { kind: 'ambiguous', reason: 'repeated-text' };
  for (const hunk of localHunks)
    for (const other of acceptedHunks) {
      if (sameHunk(hunk, other))
        return { kind: 'ambiguous', reason: 'duplicate-change' };
      if (touches(hunk, other))
        return { kind: 'ambiguous', reason: 'overlapping-change' };
    }
  return {
    kind: 'merged',
    text: applyHunks(base, [...localHunks, ...acceptedHunks]),
  };
}
