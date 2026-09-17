import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deepestSteppedBranch,
  treeBranchClassName,
  treeRowClassName,
  treeRowTextClassName,
} from './tree-row.ts';

/** The classes of one row state, as a list. */
function classes(state: Parameters<typeof treeRowClassName>[0]): string[] {
  return treeRowClassName(state).split(' ');
}

await test('a quiet row marks nothing and answers the pointer', () => {
  const quiet = classes({});
  assert.ok(quiet.includes('hover:bg-hover'));
  assert.ok(!quiet.includes('bg-active'));
  assert.ok(!quiet.includes('bg-hover'));
});

await test('the open note and the selected folder do not look the same', () => {
  // The defect this covers: both states were one fill, so a note directly
  // under its own folder read as one band with no edge between the two.
  const open = treeRowClassName({ open: true });
  const selected = treeRowClassName({ selected: true });
  assert.notEqual(open, selected);
  assert.ok(open.includes('bg-active'));
  assert.ok(selected.includes('bg-hover'));
  assert.ok(selected.includes('ring-edge'));
});

await test('a marked row keeps an edge of its own', () => {
  // Two marked rows can sit next to each other, so each states where it
  // ends. The edge carries that, not the fill.
  for (const state of [{ open: true }, { selected: true }])
    assert.ok(classes(state).includes('ring-inset'));
});

await test('a drop target is marked over whatever the row already is', () => {
  for (const state of [{}, { open: true }, { selected: true }])
    assert.ok(classes({ ...state, dropTarget: true }).includes('ring-focus'));
});

await test('a marked row reads in the strong text colour', () => {
  assert.equal(treeRowTextClassName({ open: true }), 'text-strong');
  assert.equal(treeRowTextClassName({ selected: true }), 'text-strong');
  assert.ok(treeRowTextClassName({}).startsWith('text-muted'));
});

await test('a branch near the top of the tree steps in', () => {
  assert.ok(treeBranchClassName(1).split(' ').includes('ml-3'));
  assert.ok(
    treeBranchClassName(deepestSteppedBranch).split(' ').includes('ml-3'),
  );
});

await test('a deep branch stops stepping in, so the name keeps its room', () => {
  // The defect this covers: every level added its own step and nothing
  // stopped it, so a folder ten levels down showed a chevron, a folder mark
  // and no name at all in a narrow sidebar.
  const deep = treeBranchClassName(deepestSteppedBranch + 1).split(' ');
  assert.ok(!deep.includes('ml-3'));
  assert.ok(deep.includes('border-l'));
});

await test('every branch keeps the guide line of its folder', () => {
  for (const depth of [1, 3, 5, 12]) {
    const classes = treeBranchClassName(depth).split(' ');
    assert.ok(classes.includes('border-l'), `depth ${String(depth)}`);
    assert.ok(classes.includes('border-edge-line'), `depth ${String(depth)}`);
  }
});
