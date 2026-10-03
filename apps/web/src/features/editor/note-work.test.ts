import assert from 'node:assert/strict';
import test from 'node:test';
import type { Draft, LocalChange } from '@notesapp/sync';
import {
  createNoteWork,
  readAfterChange,
  type NoteWorkPorts,
} from './note-work.ts';

/** A promise and the calls that settle it. */
function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (failure: unknown) => void;
} {
  let resolve = (): void => {};
  let reject = (_failure: unknown): void => {};
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Lets every settled promise run its handlers. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

/**
 * One open editor with a fake store. The document is the list of keys, the
 * store holds the keys that a write took, and a frame runs only when the
 * test asks for it.
 */
class Editor {
  keys: string[] = [];
  held: string[] = [];
  stored: string[] = [];
  appendGate: Promise<void> | null = null;
  appendFails = false;
  checkpointFails = false;
  readonly appended: string[][] = [];
  readonly drafts: Draft[] = [];
  readonly versions: string[] = [];
  readonly frames: (() => void)[] = [];
  draftsOwed = 0;
  closed = false;

  readonly ports: NoteWorkPorts = {
    takeWork: () => {
      if (this.held.length === 0) return null;
      const taken = this.held;
      this.held = [];
      return new TextEncoder().encode(taken.join(''));
    },
    wholeWork: () => new TextEncoder().encode(this.keys.join('')),
    stateVector: () =>
      this.closed ? null : new Uint8Array([this.keys.length]),
    sequence: () => this.keys.length,
    draft: (deleted) => ({
      accountId: 'account-1',
      workspaceId: 'workspace-1',
      workingCopyId: 'copy-1',
      fileId: 'file-1',
      baseRevisionId: null,
      text: this.keys.join(''),
      path: 'notes/one.md',
      deleted,
      sequence: this.keys.length,
    }),
    started: () => Promise.resolve(),
    append: async (work) => {
      const keys = [...new TextDecoder().decode(work)];
      this.appended.push(keys);
      if (this.appendGate !== null) await this.appendGate;
      if (this.appendFails) throw new Error('quota');
      this.stored.push(...keys);
    },
    merge: (work) => {
      this.stored = [...new TextDecoder().decode(work)];
      return Promise.resolve();
    },
    saveDraft: (draft) => {
      this.drafts.push(draft);
      return Promise.resolve();
    },
    checkpoint: (draft) => {
      if (this.checkpointFails) return Promise.reject(new Error('quota'));
      // The version freezes the stored document, never the draft text.
      this.versions.push(this.stored.join(''));
      void draft;
      return Promise.resolve(null);
    },
    draftOwed: () => {
      this.draftsOwed += 1;
    },
    frame: (run) => {
      this.frames.push(run);
      return () => {
        const index = this.frames.indexOf(run);
        if (index >= 0) this.frames.splice(index, 1);
      };
    },
  };

  readonly work = createNoteWork(this.ports);

  type(key: string): void {
    this.keys.push(key);
    this.held.push(key);
    this.work.changed();
  }

  runFrames(): void {
    const frames = this.frames.splice(0);
    for (const run of frames) run();
  }
}

await test('the keys of one frame reach the store in one append', async () => {
  // Record 0175. The editor held its keys in memory for up to a second, so
  // a closed tab, a killed phone browser or a crash lost them.
  const editor = new Editor();
  editor.type('a');
  editor.type('b');
  assert.equal(editor.frames.length, 1);
  editor.runFrames();
  await settle();
  assert.deepEqual(editor.appended, [['a', 'b']]);
  assert.deepEqual(editor.stored, ['a', 'b']);
});

await test('a version claims only the keys whose work it wrote', async () => {
  // A key typed while the work of a version was written was counted by
  // that version, so leaving the note made no second version and the key
  // had none.
  const editor = new Editor();
  editor.type('a');
  const gate = deferred();
  editor.appendGate = gate.promise;
  const first = editor.work.version();
  editor.type('b');
  gate.resolve();
  editor.appendGate = null;
  const outcome = await first;
  assert.equal(outcome.kind, 'written');
  assert.deepEqual(editor.versions, ['a']);
  assert.equal(editor.work.versionedSequence(), 1);
  assert.notEqual(editor.work.versionedSequence(), editor.keys.length);
  // Leaving the note makes the second version, which holds the key.
  await editor.work.version();
  assert.deepEqual(editor.versions, ['a', 'ab']);
  assert.equal(editor.work.versionedSequence(), 2);
});

await test('a version that fails asks for the draft that it cancelled', async () => {
  // The screen cancels the draft write that waits when a version starts,
  // because the version writes the draft itself. A version that failed
  // wrote none, and the text had no recovery copy.
  const editor = new Editor();
  editor.type('a');
  editor.checkpointFails = true;
  const outcome = await editor.work.version();
  assert.equal(outcome.kind, 'failed');
  assert.equal(editor.draftsOwed, 1);
});

await test('a version after a lost append writes the whole document first', async () => {
  const editor = new Editor();
  editor.appendFails = true;
  editor.type('a');
  editor.runFrames();
  await settle();
  assert.equal(editor.work.lost(), true);
  editor.appendFails = false;
  editor.type('b');
  await editor.work.version();
  assert.deepEqual(editor.versions, ['ab']);
  assert.equal(editor.work.lost(), false);
});

await test('a draft states its vector only when the store holds its keys', async () => {
  // Record 0175. The open of a note takes the text of the document when
  // the document covers the vector of the draft, so a vector for a key that
  // no write took would drop that key.
  const editor = new Editor();
  editor.type('a');
  const written = await editor.work.writeDraft(false);
  assert.deepEqual(editor.stored, ['a']);
  assert.deepEqual(written.documentVector, new Uint8Array([1]));
  editor.appendFails = true;
  editor.type('b');
  const lost = await editor.work.writeDraft(false);
  assert.equal(lost.text, 'ab');
  assert.equal(lost.documentVector, undefined);
});

await test('a flush appends at once, with no frame', async () => {
  // A hidden tab runs no frame, so the work of the last frame must go at
  // once when the tab hides, or a closed tab loses it.
  const editor = new Editor();
  editor.type('a');
  await editor.work.flush();
  assert.deepEqual(editor.stored, ['a']);
  assert.equal(editor.frames.length, 0);
});

await test('only the editor that wrote a document change skips it', () => {
  // Record 0175. A mark of the tab made a second editor of the same note in
  // this tab skip the work of the first.
  const change: LocalChange = {
    accountId: 'account-1',
    workspaceId: 'workspace-1',
    fileId: 'file-1',
    kind: 'document',
    writer: 'copy-1',
  };
  assert.equal(readAfterChange(change, 'copy-1'), 'none');
  assert.equal(readAfterChange(change, 'copy-2'), 'join');
  const { writer: _writer, ...unmarked } = change;
  assert.equal(readAfterChange(unmarked, 'copy-1'), 'join');
  assert.equal(
    readAfterChange({ ...change, kind: 'draft' }, 'copy-2'),
    'state',
  );
  assert.equal(readAfterChange({ ...change, kind: 'file' }, 'copy-1'), 'join');
});
