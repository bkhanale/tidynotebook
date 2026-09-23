import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expandedFolders,
  folderExpansion,
  folderExpansionLabels,
} from './folder-expansion.ts';

const folders = ['Work', 'Work/Reports', 'Home'];

await test('the toggle collapses while any folder of the tree is open', () => {
  assert.equal(folderExpansion(new Set(['Work/Reports']), folders), 'collapse');
});

await test('the toggle expands when no folder of the tree is open', () => {
  assert.equal(folderExpansion(new Set(), folders), 'expand');
});

await test('a remembered folder that left the tree does not count', () => {
  assert.equal(folderExpansion(new Set(['Gone']), folders), 'expand');
});

await test('a tree with no folder offers to expand', () => {
  assert.equal(folderExpansion(new Set(['Gone']), []), 'expand');
});

await test('expand opens every folder of the tree', () => {
  assert.deepEqual([...expandedFolders('expand', folders)], folders);
});

await test('collapse closes every folder', () => {
  assert.equal(expandedFolders('collapse', folders).size, 0);
});

await test('each action names what it does', () => {
  assert.equal(folderExpansionLabels.expand, 'Expand all folders');
  assert.equal(folderExpansionLabels.collapse, 'Collapse all folders');
});
