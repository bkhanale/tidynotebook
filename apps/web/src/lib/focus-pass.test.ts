import assert from 'node:assert/strict';
import test from 'node:test';
import { createFocusPass } from './focus-pass.ts';
import { revalidateIntervalMs } from './revalidate.ts';

const start = 1_000_000;

await test('the first return to the window asks for a pass', () => {
  const pass = createFocusPass();
  assert.equal(pass.ask(start), true);
});

await test('a second return inside the quiet period asks for no pass', () => {
  // A browser sends both the focus event and the visibility event for one
  // return, and a person who moves between two windows returns again soon.
  const pass = createFocusPass();
  assert.equal(pass.ask(start), true);
  assert.equal(pass.ask(start), false);
  assert.equal(pass.ask(start + revalidateIntervalMs - 1), false);
});

await test('a return after the quiet period asks for a pass again', () => {
  const pass = createFocusPass();
  assert.equal(pass.ask(start), true);
  assert.equal(pass.ask(start + revalidateIntervalMs), true);
  assert.equal(pass.ask(start + revalidateIntervalMs + 1), false);
});

await test('a clock that moves backwards releases the quiet period', () => {
  const pass = createFocusPass();
  assert.equal(pass.ask(start), true);
  assert.equal(pass.ask(start - 60_000), true);
});

await test('one tab bounds itself and not another tab', () => {
  const first = createFocusPass();
  const second = createFocusPass();
  assert.equal(first.ask(start), true);
  assert.equal(second.ask(start), true);
});
