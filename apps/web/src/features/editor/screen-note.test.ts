import assert from 'node:assert/strict';
import test from 'node:test';
import { createScreenNote, type ScreenBoundNote } from './screen-note.ts';

/** A note that counts its opens and its releases, as `openBoundNote` acts. */
interface CountedNote extends ScreenBoundNote<CountedNote> {
  readonly id: number;
  readonly released: () => boolean;
}

/** The opens and releases of one screen, and the function that opens. */
function counter(): {
  readonly open: () => CountedNote;
  readonly opens: () => number;
  readonly releases: () => number;
} {
  let opens = 0;
  let releases = 0;
  const open = (): CountedNote => {
    opens += 1;
    const id = opens;
    let released = false;
    const note: CountedNote = {
      id,
      released: () => released,
      release(): void {
        if (released) return;
        released = true;
        releases += 1;
      },
      reopen: (): CountedNote => (released ? open() : note),
    };
    return note;
  };
  return { open, opens: () => opens, releases: () => releases };
}

await test('a render opens no note, and each mount releases the one note it took', () => {
  // The defect: each read of the loader with the same key opened a new note
  // in a render, and nothing released it.
  const count = counter();
  const screen = createScreenNote(count.open);
  assert.equal(count.opens(), 0, 'a render opens nothing');

  // React mounts the effects, cleans up and mounts again in development.
  const first = screen.mountNote();
  assert.equal(screen.mountNote(), first, 'a second effect takes the note');
  assert.equal(screen.noteRef.current, first);
  first.release();
  const second = screen.mountNote();
  assert.notEqual(second, first);
  assert.equal(screen.noteRef.current, second);
  second.release();
  assert.equal(count.opens(), 2);
  assert.equal(count.releases(), 2);
});

await test('a screen that React renders and throws away opens nothing', () => {
  const count = counter();
  createScreenNote(count.open);
  createScreenNote(count.open);
  const kept = createScreenNote(count.open);
  const note = kept.noteRef.current;
  assert.equal(kept.mountNote(), note, 'the mount takes the note it read');
  note.release();
  assert.equal(count.opens(), 1);
  assert.equal(count.releases(), 1);
});
