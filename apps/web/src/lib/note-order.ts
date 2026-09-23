/**
 * The order of the notes inside each folder of the tree.
 *
 * A person chooses one of three orders from the Sort notes menu of the
 * sidebar, and the device keeps it until the person chooses another
 * (decision 0093). Folders have no date, so a folder always takes the name
 * order, and the tree puts folders before notes whatever the order is.
 *
 * Everything here is a pure function, so the orders and the parse of the
 * stored value are tested without a browser. `shell/files.tsx` keeps the
 * choice and `note-list.ts` applies it.
 */
import type { NoteSummary } from './note-list.ts';
import { baseNameOf, displayNoteName } from './note-name.ts';

/** The orders a person can choose, in the order the menu shows them. */
export const noteOrders = ['name', 'created', 'updated'] as const;

/** One order of the notes. */
export type NoteOrder = (typeof noteOrders)[number];

/** The order a new installation opens with. */
export const defaultNoteOrder: NoteOrder = 'name';

/** The local settings key of the order. One choice for every workspace. */
export const noteOrderStorageKey = 'notesapp.note-order';

/** What the menu row of each order reads: its name and its direction. */
export const noteOrderLabels: Readonly<
  Record<NoteOrder, { readonly label: string; readonly hint: string }>
> = {
  name: { label: 'Name', hint: 'A to Z' },
  created: { label: 'Date created', hint: 'Newest first' },
  updated: { label: 'Date updated', hint: 'Newest first' },
};

/** Tells whether a value is one of the orders. */
function isNoteOrder(value: unknown): value is NoteOrder {
  return noteOrders.some((order) => order === value);
}

/**
 * The order that a stored value names.
 *
 * The value comes from browser settings, which any script or an older build
 * can write, so an unknown value falls back to the default order.
 */
export function parseNoteOrder(stored: string | null): NoteOrder {
  return isNoteOrder(stored) ? stored : defaultNoteOrder;
}

const nameCollator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
});

/**
 * Compares two names in alphabet order.
 *
 * Case does not count, so `apple` comes before `Banana`, and a number counts
 * as a number, so `Note 2` comes before `Note 10`. Two names that differ in
 * case only still take one fixed order, so the tree never moves between two
 * renders.
 */
export function compareNames(left: string, right: string): number {
  const collated = nameCollator.compare(left, right);
  if (collated !== 0) return collated;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The instant of a stored timestamp, and the earliest one for a bad value. */
function instantOf(value: string): number {
  const instant = Date.parse(value);
  return Number.isNaN(instant) ? Number.NEGATIVE_INFINITY : instant;
}

/** Compares two notes by the name a person reads. */
function compareNoteNames(left: NoteSummary, right: NoteSummary): number {
  return compareNames(
    displayNoteName(baseNameOf(left.path)),
    displayNoteName(baseNameOf(right.path)),
  );
}

/**
 * Compares two notes in one order.
 *
 * A date order puts the newest first. Two notes with the same instant take
 * the name order, so the result is the same on every render.
 */
export function compareNotes(
  order: NoteOrder,
): (left: NoteSummary, right: NoteSummary) => number {
  if (order === 'name') return compareNoteNames;
  const instant = (note: NoteSummary): number =>
    instantOf(order === 'created' ? note.createdAt : note.updatedAt);
  return (left, right) => {
    const newer = instant(right) - instant(left);
    if (newer !== 0 && !Number.isNaN(newer)) return newer;
    return compareNoteNames(left, right);
  };
}
