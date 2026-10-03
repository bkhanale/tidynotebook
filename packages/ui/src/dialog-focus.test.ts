import assert from 'node:assert/strict';
import test from 'node:test';
import { giveFocusBack } from './dialog-focus.ts';

/** An element that counts how often it took the focus. */
function element(): { focus(): void; readonly taken: () => number } {
  let count = 0;
  return {
    focus: () => {
      count += 1;
    },
    taken: () => count,
  };
}

await test('a dialog gives the focus back to the element that opened it', () => {
  const opener = element();
  giveFocusBack(opener, undefined);
  assert.equal(opener.taken(), 1);
  giveFocusBack(null, undefined);
});

await test('the place a caller names wins over an opener that its act can remove', () => {
  // The second review of the tree: Move to folder took away the row that
  // opened it, and the focus fell to the page.
  const opener = element();
  let returned = 0;
  giveFocusBack(opener, () => {
    returned += 1;
  });
  assert.equal(returned, 1);
  assert.equal(opener.taken(), 0);
});
