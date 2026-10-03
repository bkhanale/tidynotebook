/**
 * Times the parse, the render and the index of each shape of note of
 * `packages/markdown/test-data/shapes.ts` at sizes that double, and prints
 * how much each step of size multiplies the time (records 0182 and 0185).
 *
 * Usage: `pnpm build`, then `node tools/performance/parse-shapes.ts`. Pass
 * `--sizes 100000,200000,400000` for other sizes in characters, `--stages
 * parse,render` for some stages only, and `--shapes <text>` for the shapes
 * whose name holds the text.
 *
 * A shape whose work grows with its size takes about twice the time at twice
 * the size, and one that grows with the square about four times. A note that
 * a count refuses before the parse prints the limit instead. The unit test
 * `packages/markdown/src/parse.test.ts` holds the same shapes with a count of
 * work rather than of time, so this script only shows the times on a machine.
 * Every number it prints is a measured result for the report of a run.
 */
import process from 'node:process';
import {
  indexNote,
  MarkdownLimitError,
  parseMarkdown,
  renderMarkdown,
} from '@notesapp/markdown';
import {
  noteOfShape,
  noteShapes,
} from '../../packages/markdown/test-data/shapes.ts';

/** The value of `--name`, or `fallback`. */
function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

const sizes = argument('sizes', '100000,200000,400000').split(',').map(Number);
if (sizes.some((size) => !Number.isInteger(size) || size < 1))
  throw new Error('--sizes takes positive whole numbers.');

/** The stages a note goes through, as the readers of a note run them. */
const stages: Readonly<Record<string, (note: string) => unknown>> = {
  parse: (note) => parseMarkdown(note),
  render: (note) => renderMarkdown(note),
  index: (note) => indexNote(note, 'note.md'),
};
const chosen = argument('stages', Object.keys(stages).join(',')).split(',');
const filter = argument('shapes', '');

/** One timing: the milliseconds, or the limit that refused the note. */
async function timed(run: () => unknown): Promise<string> {
  const started = performance.now();
  try {
    await run();
  } catch (error) {
    if (error instanceof MarkdownLimitError) return `refused ${error.reason}`;
    throw error;
  }
  return `${(performance.now() - started).toFixed(0)} ms`;
}

for (const stage of chosen) {
  const run = stages[stage];
  if (run === undefined) throw new Error(`No stage is named ${stage}.`);
  process.stdout.write(`${stage}\n`);
  for (const [name, unit] of Object.entries(noteShapes)) {
    if (!name.includes(filter)) continue;
    const cells: string[] = [];
    let previous: number | null = null;
    for (const size of sizes) {
      const time = await timed(() => run(noteOfShape(unit, size)));
      const milliseconds = time.endsWith(' ms')
        ? Number.parseFloat(time)
        : null;
      const growth =
        previous !== null && milliseconds !== null && previous > 0
          ? ` x${(milliseconds / previous).toFixed(1)}`
          : '';
      cells.push(`${String(size)}: ${time}${growth}`);
      previous = milliseconds;
    }
    process.stdout.write(`  ${name.padEnd(28)}${cells.join(' | ')}\n`);
  }
}
