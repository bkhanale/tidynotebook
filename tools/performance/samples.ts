/**
 * The pure part of the browser measurements: the corpus and the statistics.
 *
 * The corpus is the one of the audit of 2026-10-02: a thousand notes of about
 * 2 KB in twenty folders, one note of 50 KB and one of 500 KB. Each note has
 * headings, a list and a link, so the outline, the backlinks and the link
 * completion of the editor have work to do. The text is the same on each run,
 * so two runs measure the same workspace.
 */

/** One note that a measurement writes before it starts. */
export type PlannedNote = {
  readonly path: string;
  readonly text: string;
};

/** How many ordinary notes the corpus holds, and in how many folders. */
export const corpusShape = {
  notes: 1000,
  folders: 20,
  noteBytes: 2 * 1024,
  largeBytes: 50 * 1024,
  hugeBytes: 500 * 1024,
} as const;

/** The path of the ordinary note `index`, in its folder. */
export function corpusPath(index: number): string {
  const folder = String(index % corpusShape.folders).padStart(2, '0');
  return `folder-${folder}/note-${String(index).padStart(4, '0')}.md`;
}

/** The words of a paragraph, from a seed that keeps every note different. */
function paragraph(seed: number): string {
  const words = [
    'the',
    'note',
    'keeps',
    'a',
    'plan',
    'for',
    'each',
    'week',
    'and',
    'every',
    'task',
    'has',
    'one',
    'owner',
    'who',
    'writes',
  ];
  return Array.from(
    { length: 40 },
    (_, offset) => words[(seed * 7 + offset * 3) % words.length] ?? 'word',
  ).join(' ');
}

/** A Markdown text of at least `bytes` bytes, cut at the end of a line. */
export function markdownOfSize(
  title: string,
  bytes: number,
  seed: number,
): string {
  const lines = [`# ${title}`, ''];
  let section = 0;
  while (lines.join('\n').length < bytes) {
    section += 1;
    lines.push(
      `## Part ${String(section)}`,
      '',
      paragraph(seed + section),
      '',
      `- ${paragraph(seed + section + 1).slice(0, 60)}`,
      `- [ ] ${paragraph(seed + section + 2).slice(0, 50)}`,
      `- See [the first note](../${corpusPath(0)})`,
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Every note of the corpus, in the order of its paths. */
export function corpusPlan(): readonly PlannedNote[] {
  const notes: PlannedNote[] = Array.from(
    { length: corpusShape.notes },
    (_, index) => ({
      path: corpusPath(index),
      text: markdownOfSize(
        `Note ${String(index)}`,
        corpusShape.noteBytes,
        index,
      ),
    }),
  );
  notes.push(
    {
      path: 'large/large-note.md',
      text: markdownOfSize('Large note', corpusShape.largeBytes, 1),
    },
    {
      path: 'large/huge-note.md',
      text: markdownOfSize('Huge note', corpusShape.hugeBytes, 2),
    },
  );
  return notes;
}

/** The value at a fraction of the sorted samples, by the nearest rank. */
export function percentile(
  values: readonly number[],
  fraction: number,
): number {
  if (values.length === 0) return 0;
  if (!(fraction > 0 && fraction <= 1))
    throw new Error('A percentile is a fraction above 0 and at most 1.');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
}

/** The count, the percentiles and the worst of one set of samples. */
export type Distribution = {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
};

/** Rounds to a tenth, which is finer than any timer of a browser. */
function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The distribution of a set of samples, rounded to a tenth. */
export function distribution(values: readonly number[]): Distribution {
  return {
    count: values.length,
    p50: tenth(percentile(values, 0.5)),
    p95: tenth(percentile(values, 0.95)),
    p99: tenth(percentile(values, 0.99)),
    max: tenth(values.reduce((worst, value) => Math.max(worst, value), 0)),
  };
}

/** The samples above `bound`, with their place in the run, worst first. */
export function outliers(
  values: readonly number[],
  bound: number,
): readonly { readonly trial: number; readonly value: number }[] {
  return values
    .map((value, trial) => ({ trial, value: tenth(value) }))
    .filter((entry) => entry.value > bound)
    .sort((left, right) => right.value - left.value);
}
