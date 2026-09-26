import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deepestSteppedBranch,
  treeBranchClassName,
  treeItemsClassName,
  treeListClassName,
  treeRowClassName,
  treeRowLeadingClassName,
  treeRowNameClassName,
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
  assert.ok(open.includes('text-strong'));
  assert.ok(selected.includes('bg-hover'));
  assert.ok(!selected.includes('bg-active'));
});

await test('the open note keeps its mark while a folder is selected', () => {
  // A person can select a folder and open a note inside it at the same time.
  // The row of the note is then the stronger of the two marks.
  const both = classes({ open: true, selected: true });
  assert.ok(both.includes('bg-active'));
  assert.ok(!both.includes('bg-hover'));
});

await test('no row of the tree takes a ring, and none names the edge', () => {
  // Decision 0064. The open note took a ring, the selected folder took a
  // second one, and the tree read as a cage of boxes.
  for (const state of [{}, { open: true }, { selected: true }]) {
    const one = treeRowClassName(state);
    assert.ok(!one.includes('ring-'), one);
    assert.ok(!one.includes('edge'), one);
  }
});

await test('a drop target is marked over whatever the row already is', () => {
  // The drop target is the one ring of the tree: while a row is dragged over
  // a folder the edge is the whole message, and it carries no text.
  for (const state of [{}, { open: true }, { selected: true }]) {
    const one = classes({ ...state, dropTarget: true });
    assert.ok(one.includes('ring-focus'));
    assert.ok(one.includes('ring-2'));
    assert.ok(one.includes('ring-inset'));
  }
});

await test('a row is the group that its hover actions read', () => {
  assert.ok(classes({}).includes('group'));
});

await test('the disclosure and name share one tight leading group', () => {
  // The defect this covers: the row gap and the left padding of the name
  // both sat between the disclosure icon and the folder icon.
  assert.ok(treeRowLeadingClassName.includes('flex'));
  assert.ok(treeRowLeadingClassName.includes('flex-1'));
  assert.ok(!treeRowLeadingClassName.includes('gap-'));
  assert.ok(!treeRowNameClassName.includes('pl-'));
  assert.ok(!treeRowNameClassName.includes('px-'));
});

await test('the name control inherits the colour of its row', () => {
  // The row states the text colour of every state, so the control inside it
  // states none: two answers to one colour is how a marked row kept a muted
  // name.
  assert.ok(treeRowNameClassName.includes('text-inherit'));
  assert.ok(!treeRowNameClassName.includes('text-muted'));
  assert.ok(!treeRowNameClassName.includes('text-strong'));
});

await test('the name control shows its focus inside the row', () => {
  // The tree is a box that scrolls, and a box that scrolls clips an outline
  // drawn outside the control.
  assert.ok(treeRowNameClassName.includes('focus-visible:outline-2'));
  assert.ok(treeRowNameClassName.includes('focus-visible:-outline-offset-2'));
  assert.ok(!treeRowNameClassName.includes('focus:'));
});

await test('a branch near the top of the tree steps in by one step', () => {
  assert.equal(treeBranchClassName(1), 'mt-0.5 pl-2');
  assert.equal(treeBranchClassName(deepestSteppedBranch), 'mt-0.5 pl-2');
});

await test('a deep branch stops stepping in, so the name keeps its room', () => {
  // The defect this covers: every level added its own step and nothing
  // stopped it, so a folder ten levels down showed a chevron, a folder mark
  // and no name at all in a narrow sidebar.
  assert.equal(treeBranchClassName(deepestSteppedBranch + 1), 'mt-0.5');
  assert.equal(treeBranchClassName(12), 'mt-0.5');
});

await test('every open branch separates its first row from its folder', () => {
  for (const depth of [1, 3, 5, 12])
    assert.ok(treeBranchClassName(depth).includes('mt-0.5'));
});

await test('siblings use a small gap while each row keeps its target size', () => {
  assert.ok(treeItemsClassName.includes('space-y-0.5'));
  assert.ok(treeRowClassName().includes('md:min-h-7'));
  assert.ok(treeRowClassName().includes('min-h-11'));
});

await test('no branch of the tree draws a guide line', () => {
  // Decision 0064. A line down every branch is the mark of a file manager
  // and not of a note list; the step states the level.
  for (const depth of [1, 3, 5, 12]) {
    const one = treeBranchClassName(depth);
    assert.ok(!one.includes('border'), `depth ${String(depth)}`);
  }
});

await test('the top of the tree separates from the All notes row', () => {
  // The defect this covers: the All notes row sits outside the folder list,
  // so the spacing inside that list never reached it, and a marked All notes
  // row touched the marked folder below it as one band.
  assert.ok(treeListClassName.includes('mt-0.5'));
  assert.ok(!treeListClassName.includes('border'));
  assert.ok(!treeListClassName.includes('pl-'));
});
