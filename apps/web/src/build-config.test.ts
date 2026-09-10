/**
 * The build invariants that the content policy of the shell depends on.
 *
 * The shell permits a font only from its own origin. Vite inlines a small
 * asset as a `data:` URL by default, so a small font file becomes a `data:`
 * source that the policy blocks and the console reports as a violation. The
 * build therefore emits every asset as a file of its own.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import config from '../vite.config.ts';

await test('the web build emits every asset as a file', () => {
  const resolved =
    typeof config === 'function'
      ? config({ command: 'build', mode: 'production' })
      : config;
  assert.ok(!(resolved instanceof Promise), 'the config is built in one step');
  assert.equal(resolved.build?.assetsInlineLimit, 0);
});
