/**
 * The order of the notes inside each folder of the tree.
 *
 * A person chooses one of six orders from the Sort notes menu of the
 * sidebar: the name, the creation date or the update date, each in both
 * directions. The device keeps it until the person chooses another
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
export const noteOrders = [
  'name-ascending',
  'name-descending',
  'created-descending',
  'created-ascending',
  'updated-descending',
  'updated-ascending',
] as const;

/** One order of the notes. */
export type NoteOrder = (typeof noteOrders)[number];

/** The fact about a note that an order compares. */
type NoteOrderField = 'name' | 'created' | 'updated';

/**
 * What each order compares, in which direction, and what its menu row reads.
 *
 * One table, so the comparison and the words of a row cannot disagree.
 */
const noteOrderRules: Readonly<
  Record<
    NoteOrder,
    {
      readonly field: NoteOrderField;
      readonly descending: boolean;
      readonly label: string;
      readonly hint: string;
    }
  >
> = {
  'name-ascending': {
    field: 'name',
    descending: false,
    label: 'Name',
    hint: 'A to Z',
  },
  'name-descending': {
    field: 'name',
    descending: true,
    label: 'Name',
    hint: 'Z to A',
  },
  'created-descending': {
    field: 'created',
    descending: true,
    label: 'Date created',
    hint: 'Newest first',
  },
  'created-ascending': {
    field: 'created',
    descending: false,
    label: 'Date created',
    hint: 'Oldest first',
  },
  'updated-descending': {
    field: 'updated',
    descending: true,
    label: 'Date updated',
    hint: 'Newest first',
  },
  'updated-ascending': {
    field: 'updated',
    descending: false,
    label: 'Date updated',
    hint: 'Oldest first',
  },
};

/** The order a new installation opens with. */
export const defaultNoteOrder: NoteOrder = 'name-ascending';

/** The local settings key of the order. One choice for every workspace. */
export const noteOrderStorageKey = 'notesapp.note-order';

/**
 * What the menu row of one order reads: its name and its direction, and the
 * group of the fact it compares, so the menu separates the three facts.
 */
export function noteOrderLabel(order: NoteOrder): {
  readonly label: string;
  readonly hint: string;
  readonly group: string;
} {
  const { field, label, hint } = noteOrderRules[order];
  return { label, hint, group: field };
}

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
 * Two notes with the same instant take the name order from A to Z in both
 * directions of a date order, so the result is the same on every render.
 */
export function compareNotes(
  order: NoteOrder,
): (left: NoteSummary, right: NoteSummary) => number {
  const { field, descending } = noteOrderRules[order];
  const sign = descending ? -1 : 1;
  if (field === 'name')
    return (left, right) => sign * compareNoteNames(left, right);
  const instant = (note: NoteSummary): number =>
    instantOf(field === 'created' ? note.createdAt : note.updatedAt);
  return (left, right) => {
    const later = instant(left) - instant(right);
    if (later !== 0 && !Number.isNaN(later)) return sign * later;
    return compareNoteNames(left, right);
  };
}
