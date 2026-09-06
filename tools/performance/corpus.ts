/** Deterministic, content-free metadata for the performance corpus. */

/** Number of ordinary notes in the service performance corpus. */
export const corpusNoteCount = 10_000;

/** Size of the separate stress note. */
export const stressNoteBytes = 1024 * 1024;

/** One generated note. The caller must not print its text. */
export type CorpusNote = {
  readonly index: number;
  readonly path: string;
  readonly text: string;
  readonly bytes: number;
  readonly searchTerm: string;
};

const filler = `${Array.from(
  { length: 512 },
  (_, index) => `word${String(index).padStart(3, '0')}`,
).join(' ')}\n`;

/** Makes an ASCII note with an exact byte count between 5 and 20 KiB. */
export function corpusNote(index: number): CorpusNote {
  if (!Number.isSafeInteger(index) || index < 0 || index >= corpusNoteCount)
    throw new Error('The corpus note index is outside its fixed range.');
  const targetBytes = 5 * 1024 + ((index * 7919) % (15 * 1024 + 1));
  const searchTerm = `group${String(index % 200).padStart(3, '0')}`;
  const header = `# Performance note ${String(index).padStart(5, '0')}\n\n${searchTerm}\n\n`;
  const remaining = targetBytes - Buffer.byteLength(header);
  const repeated = filler.repeat(Math.ceil(remaining / filler.length));
  const text = header + repeated.slice(0, remaining);
  const bytes = Buffer.byteLength(text);
  if (bytes !== targetBytes) throw new Error('The corpus size is not exact.');
  return {
    index,
    path: `corpus/note-${String(index).padStart(5, '0')}.md`,
    text,
    bytes,
    searchTerm,
  };
}

/** Makes the separate exact 1 MiB stress note. */
export function stressNote(): CorpusNote {
  const header = '# One MiB stress note\n\nstress-target\n\n';
  const sentence = 'Bounded stress text keeps its source valid. ';
  const block = `${sentence.repeat(24)}\n\n`;
  const remaining = stressNoteBytes - Buffer.byteLength(header);
  const body = block
    .repeat(Math.ceil(remaining / block.length))
    .slice(0, remaining);
  const text = header + body;
  return {
    index: corpusNoteCount,
    path: 'corpus/stress-1mib.md',
    text,
    bytes: Buffer.byteLength(text),
    searchTerm: 'stress-target',
  };
}

/** Generates one bounded batch without retaining the full corpus. */
export function corpusBatch(start: number, count: number): CorpusNote[] {
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error('The corpus batch count must be positive.');
  return Array.from({ length: count }, (_, offset) =>
    corpusNote(start + offset),
  );
}
