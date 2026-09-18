import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialOf } from './initial.ts';

await test('the initial is the first grapheme in upper case', () => {
  assert.equal(initialOf('personal'), 'P');
  assert.equal(initialOf('  work notes'), 'W');
  assert.equal(initialOf('éric'), 'É');
});

await test('a grapheme of several code points stays whole', () => {
  assert.equal(initialOf('👩‍💻 team'), '👩‍💻');
  assert.equal(initialOf('한국'), '한');
});

await test('an empty name gives an empty mark', () => {
  assert.equal(initialOf(''), '');
  assert.equal(initialOf('   '), '');
});
