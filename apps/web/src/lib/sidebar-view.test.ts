/** The view of the sidebar (record 0105). */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultSidebarView,
  parseSidebarView,
  sidebarViewLabels,
  sidebarViews,
} from './sidebar-view.ts';

await test('the tree of notes is the view of a new installation', () => {
  assert.equal(defaultSidebarView, 'notes');
  assert.equal(sidebarViews[0], 'notes');
});

await test('a stored view comes back, and anything else falls back', () => {
  for (const view of sidebarViews) assert.equal(parseSidebarView(view), view);
  for (const broken of [null, '', 'daily', 'Calendar'])
    assert.equal(parseSidebarView(broken), defaultSidebarView);
});

await test('every view has its own name in sentence case', () => {
  const names = sidebarViews.map((view) => sidebarViewLabels[view]);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[A-Z][a-z ]+$/);
});
