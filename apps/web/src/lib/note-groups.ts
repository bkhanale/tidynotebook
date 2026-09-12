/**
 * The note list, grouped by how recently each note changed.
 *
 * A flat list of names tells a person little about when they last worked on a
 * note. The list on the note screen groups the notes into a few plain time
 * bands, newest first, so the note from this morning and the note from last
 * month are easy to tell apart. The bands use elapsed time, not a calendar
 * date, so the function stays pure and a test states every edge.
 */
import { recentNotes, type NoteSummary } from './note-list.ts';

/** One band of the grouped note list. */
export type NoteGroup = {
  /** The heading a person reads, for example `Today`. */
  readonly label: string;
  /** The notes of the band, newest first. */
  readonly notes: readonly NoteSummary[];
};

const hour = 3_600_000;
const day = 24 * hour;

/** The band a note falls in, from how long ago it changed. */
function bandOf(elapsed: number): number {
  if (elapsed < day) return 0;
  if (elapsed < 2 * day) return 1;
  if (elapsed < 7 * day) return 2;
  if (elapsed < 30 * day) return 3;
  return 4;
}

const labels = [
  'Today',
  'Yesterday',
  'Earlier this week',
  'Earlier this month',
  'Older',
] as const;

/**
 * Groups notes into time bands, newest first, dropping the empty bands.
 *
 * The order inside a band is the recency order of {@link recentNotes}, so the
 * newest note of a band is its first row. A note with an unreadable instant
 * sorts last and falls in the oldest band.
 */
export function groupNotesByRecency(
  notes: readonly NoteSummary[],
  now: number,
): readonly NoteGroup[] {
  const ordered = recentNotes(notes, notes.length);
  const buckets: NoteSummary[][] = [[], [], [], [], []];
  for (const note of ordered) {
    const at = Date.parse(note.updatedAt);
    const elapsed = Number.isFinite(at) ? now - at : Number.POSITIVE_INFINITY;
    const band = bandOf(Math.max(elapsed, 0));
    buckets[band]?.push(note);
  }
  const groups: NoteGroup[] = [];
  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index] ?? [];
    if (bucket.length > 0)
      groups.push({ label: labels[index] ?? 'Older', notes: bucket });
  }
  return groups;
}
