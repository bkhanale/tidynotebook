/**
 * The motion scale is one module.
 *
 * `tools/check-design-rules.mjs` refuses a transition, a duration, and an
 * easing utility outside `motion.ts`, so these names are the whole motion
 * vocabulary of the product. This test holds the two rules a reader cannot
 * see from one name alone: every name answers the reduced motion preference,
 * and every name states both halves of the scale rather than taking a
 * framework default.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  transitionAction,
  transitionField,
  transitionPanel,
  transitionRaise,
  transitionSurface,
} from './motion.ts';

/** Every name of the scale, with the name a failure message reads. */
const names: readonly (readonly [string, string])[] = [
  ['transitionAction', transitionAction],
  ['transitionSurface', transitionSurface],
  ['transitionField', transitionField],
  ['transitionPanel', transitionPanel],
  ['transitionRaise', transitionRaise],
];

await test('every transition answers the reduced motion preference', () => {
  for (const [name, value] of names) {
    for (const part of value.split(' '))
      assert.ok(part.startsWith('motion-safe:'), `${part} of ${name}`);
  }
});

await test('every transition states its duration and its easing', () => {
  for (const [name, value] of names) {
    const parts = value.split(' ');
    assert.ok(
      parts.some((part) => /^motion-safe:duration-\d+$/.test(part)),
      `${name} states no duration`,
    );
    assert.ok(
      parts.some((part) => /^motion-safe:ease-[a-z]+$/.test(part)),
      `${name} states no easing`,
    );
    assert.ok(
      parts.some((part) => part.startsWith('motion-safe:transition')),
      `${name} states no property`,
    );
  }
});

await test('every transition is named once', () => {
  const seen = new Set<string>();
  for (const [name, value] of names) {
    assert.ok(!seen.has(value), `${name} repeats another name`);
    seen.add(value);
  }
});
