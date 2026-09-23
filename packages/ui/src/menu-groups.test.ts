import assert from 'node:assert/strict';
import test from 'node:test';
import { startsGroup } from './menu-groups.ts';

const starts = (
  items: readonly { readonly group?: string | undefined }[],
): readonly boolean[] => items.map((_, index) => startsGroup(items, index));

await test('a menu that names no group draws no line', () => {
  assert.deepEqual(starts([{}, {}, {}]), [false, false, false]);
});

await test('a line comes before the first row of each later group', () => {
  assert.deepEqual(
    starts([
      { group: 'name' },
      { group: 'name' },
      { group: 'created' },
      { group: 'created' },
      { group: 'updated' },
      { group: 'updated' },
    ]),
    [false, false, true, false, true, false],
  );
});

await test('the first row never takes a line', () => {
  assert.equal(startsGroup([{ group: 'a' }], 0), false);
});

await test('a row with no group next to a group row is a group of its own', () => {
  assert.deepEqual(starts([{ group: 'a' }, {}, { group: 'a' }]), [
    false,
    true,
    true,
  ]);
});

await test('an index outside the list starts no group', () => {
  assert.equal(startsGroup([{ group: 'a' }, { group: 'b' }], 2), false);
  assert.equal(startsGroup([{ group: 'a' }, { group: 'b' }], -1), false);
});
