import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDocumentUpdate,
  documentStateVector,
  encodeDocumentDelta,
  readDocumentText,
  replaceDocumentText,
  startDocument,
} from './document.ts';
import { editorBinding } from './editor-bridge.ts';
import { openDocumentSession } from './session.ts';
import { keepWrittenCharacter } from './written-character.ts';

/** The value of an accepted operation, or a failure that names the refusal. */
function accepted<T>(
  result: { ok: true; value: T } | { ok: false; refusal: string },
): T {
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.value;
}

/** One device writes one text into its own copy of a document. */
function write(document: Uint8Array, text: string): Uint8Array {
  return accepted(replaceDocumentText(document, text)).document;
}

/** The work of `from` that `into` lacks, applied to `into`. */
function join(into: Uint8Array, from: Uint8Array): Uint8Array {
  const delta = encodeDocumentDelta(from, documentStateVector(into));
  return accepted(applyDocumentUpdate(into, delta)).document;
}

/** The slot between the brackets of the first task box of a text. */
function boxSlot(text: string): { from: number; to: number } {
  const from = text.indexOf('[') + 1;
  return { from, to: text.indexOf(']') };
}

await test('the character that the save wrote stays in its slot', () => {
  const base = startDocument('- [ ] task\n');
  // The server took the toggle of one device, and the save of another device
  // toggled the same box without seeing it.
  const head = write(base, '- [x] task\n');
  const save = write(base, '- [x] task\n');
  const merged = join(head, save);
  assert.equal(readDocumentText(merged), '- [xx] task\n');

  const kept = accepted(
    keepWrittenCharacter(head, merged, [boxSlot(readDocumentText(merged))]),
  );
  assert.equal(kept.text, '- [x] task\n');
  assert.equal(readDocumentText(kept.document), '- [x] task\n');
});

await test('the save accepted last sets the state of the box', () => {
  const base = startDocument('- [ ] task\n');
  const checked = write(base, '- [x] task\n');
  // The first device checks the box, then clears it again. The second device
  // checked the box before it saw either toggle.
  const cleared = write(checked, '- [ ] task\n');
  const other = write(base, '- [x] task\n');
  const head = join(checked, other);
  const settled = accepted(
    keepWrittenCharacter(checked, head, [boxSlot(readDocumentText(head))]),
  ).document;
  assert.equal(readDocumentText(settled), '- [x] task\n');

  // The clear arrives last, so it sets the box.
  const merged = join(settled, cleared);
  assert.equal(readDocumentText(merged).length, '- [ ] task\n'.length + 1);
  const kept = accepted(
    keepWrittenCharacter(settled, merged, [boxSlot(readDocumentText(merged))]),
  );
  assert.equal(kept.text, '- [ ] task\n');
});

await test('a box that met the other state on the device keeps the save', () => {
  const base = startDocument('- [ ] task\n');
  const head = write(base, '- [x] task\n');
  // The device took the toggle of the other device, then wrote its own
  // state, and saved the two together.
  const device = write(join(base, head), '- [x ] task\n');
  const merged = join(head, device);
  const kept = accepted(
    keepWrittenCharacter(head, merged, [boxSlot(readDocumentText(merged))]),
  );
  assert.equal(kept.text, '- [ ] task\n');
});

await test('a box that one editor wrote over two saves stays as it is', () => {
  // One editor wrote each state of the box, with a save between them. That
  // is what the person typed, not two toggles that crossed.
  const session = openDocumentSession(startDocument(''));
  const { text } = editorBinding(session);
  text.insert(0, '- [x] task\n');
  const first = session.encode();
  text.insert(4, 'x');
  const second = session.encode();
  session.destroy();
  const kept = accepted(
    keepWrittenCharacter(first, second, [boxSlot(readDocumentText(second))]),
  );
  assert.equal(kept.text, '- [xx] task\n');
});

await test('a slot that the save did not write into stays as it is', () => {
  // A person wrote the brackets like this on one device, with no merge.
  const head = startDocument('- [xx] task\n');
  const save = write(head, '- [xx] task and more\n');
  const kept = accepted(keepWrittenCharacter(head, save, [{ from: 3, to: 5 }]));
  assert.equal(kept.text, '- [xx] task and more\n');
});

await test('the deletions merge with work that another device wrote later', () => {
  const base = startDocument('- [ ] task\n');
  const head = write(base, '- [x] task\n');
  const merged = join(head, write(base, '- [x] task\n'));
  const kept = accepted(
    keepWrittenCharacter(head, merged, [boxSlot(readDocumentText(merged))]),
  ).document;
  // A device that holds the merged box writes a word after it, then takes the
  // deletions of the server.
  const later = write(merged, '- [xx] task done\n');
  assert.equal(readDocumentText(join(later, kept)), '- [x] task done\n');
  assert.equal(readDocumentText(join(kept, later)), '- [x] task done\n');
});
