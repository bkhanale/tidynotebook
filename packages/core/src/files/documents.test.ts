import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptDocumentWork } from './documents.ts';
import { ok, type RevisionInput } from './model.ts';
import type { DocumentService, StoredDocument } from './ports.ts';
import type { TextSlot } from './task-boxes.ts';

const fileId = 'f0000000-0000-4000-8000-000000000001';

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** Every slot that the workspace asked the document service to settle. */
let asked: (readonly TextSlot[])[] = [];

/**
 * A document service over plain text.
 *
 * A document is the bytes of its text, an update is the whole text of the
 * save, and a device covers the stored document when it saw that exact text.
 * The service keeps the last character of each slot, which stands for the
 * character that the save wrote. `packages/note-document` proves which
 * character that is.
 */
const service: DocumentService = {
  start: (text) => bytesOf(text),
  apply: (_document, update) =>
    ok({ bytes: update, text: textOf(update), state: update }),
  replaceText: (_document, text) =>
    ok({ bytes: bytesOf(text), text, state: bytesOf(text) }),
  keepWrittenCharacter: (_before, after, slots) => {
    asked.push(slots);
    let text = textOf(after);
    for (const slot of [...slots].reverse())
      text =
        text.slice(0, slot.from) +
        text.slice(slot.to - 1, slot.to) +
        text.slice(slot.to);
    return ok({ bytes: bytesOf(text), text, state: bytesOf(text) });
  },
  observe: (document) => document,
  stateVector: (document) => document,
  delta: (document) => document,
  readText: (document) => textOf(document),
  covers: (observed, document) => ok(textOf(observed) === textOf(document)),
};

/** One save of the note, which saw `seen` and produced `text`. */
function save(text: string, seen: string): RevisionInput {
  return {
    id: 'r0000000-0000-4000-8000-000000000001',
    fileId,
    parents: [],
    path: 'notes/tasks.md',
    deleted: false,
    content: {
      kind: 'markdown',
      document: {
        work: { kind: 'update', update: bytesOf(text) },
        epoch: 1,
        observed: bytesOf(seen),
      },
    },
    clientTime: '2026-09-30T10:00:00.000Z',
    message: null,
    restoredFrom: null,
  };
}

/** The text that the workspace accepted for one save over a stored text. */
async function acceptedText(
  stored: string,
  revision: RevisionInput,
): Promise<string> {
  asked = [];
  const documents = new Map<string, StoredDocument>([
    [fileId, { bytes: bytesOf(stored), epoch: 1 }],
  ]);
  const accepted = await acceptDocumentWork(service, documents, new Map(), [
    revision,
  ]);
  assert.ok(accepted.ok);
  const content = accepted.value.revisions[0]?.content;
  assert.ok(content?.kind === 'markdown');
  return content.text;
}

await test('a merging save keeps one state in a box with two', async () => {
  // Record 0134: the device toggled the box without the toggle of another
  // device, and the merge holds both states.
  const text = await acceptedText(
    '- [x] task\n',
    save('- [x ] task\n', '- [ ] task\n'),
  );
  assert.equal(text, '- [ ] task\n');
  assert.deepEqual(asked, [[{ from: 3, to: 5 }]]);
});

await test('a save that met the other state on its device asks too', async () => {
  // The feed brought the toggle of another device in before this device
  // froze its own save, so the save saw both states. The document service
  // decides from the authors of the box whether it changes.
  const text = await acceptedText(
    '- [x] task\n',
    save('- [x ] task\n', '- [x] task\n'),
  );
  assert.equal(text, '- [ ] task\n');
  assert.deepEqual(asked, [[{ from: 3, to: 5 }]]);
});

await test('a save with no text work asks for nothing', async () => {
  const revision = save('- [xx] task\n', '- [xx] task\n');
  const text = await acceptedText('- [xx] task\n', {
    ...revision,
    content: {
      kind: 'markdown',
      document: {
        work: { kind: 'none' },
        epoch: 1,
        observed: bytesOf('- [xx] task\n'),
      },
    },
  });
  assert.equal(text, '- [xx] task\n');
  assert.deepEqual(asked, []);
});

await test('a merging save with no doubled box asks for nothing', async () => {
  const text = await acceptedText(
    '- [x] task\n',
    save('- [x] task\nmore\n', '- [ ] task\n'),
  );
  assert.equal(text, '- [x] task\nmore\n');
  assert.deepEqual(asked, []);
});
