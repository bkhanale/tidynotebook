import assert from 'node:assert/strict';
import test from 'node:test';
import { editingTransaction } from './commands.ts';

await test('an editing command asks to keep the caret in view', () => {
  // CodeMirror scrolls the caret back into view only when the transaction
  // asks for it. A command that leaves the flag out writes a line below the
  // fold and the view stays where it was, so the person types into a line
  // they cannot see. One rule covers every command of this package.
  const spec = editingTransaction({
    changes: { from: 4, insert: '\n' },
    selection: { anchor: 5 },
  });
  assert.equal(spec.scrollIntoView, true);
  assert.equal(spec.userEvent, 'input.format');
  assert.deepEqual(spec.selection, { anchor: 5 });
  assert.deepEqual(spec.changes, { from: 4, insert: '\n' });
});
