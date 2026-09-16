/**
 * The create rule.
 *
 * The rule admits a link only while the workspace stays under the bound of
 * decision 0030, and it answers the scope in its stored spelling.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { planPublishedLink } from './create-link.ts';
import { maxPublishedLinksPerWorkspace } from './model.ts';

const fileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

await test('the bound of a workspace is 200 links', () => {
  assert.equal(maxPublishedLinksPerWorkspace, 200);
});

await test('one more link is admitted below the bound', () => {
  const planned = planPublishedLink({
    scope: { kind: 'note', fileId },
    currentLinkCount: maxPublishedLinksPerWorkspace - 1,
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.deepEqual(planned.value, { kind: 'note', fileId });
});

await test('a create past the bound is refused', () => {
  const refused = planPublishedLink({
    scope: { kind: 'note', fileId },
    currentLinkCount: maxPublishedLinksPerWorkspace,
  });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.error.code, 'quota');
  assert.deepEqual(refused.error.fileIds, []);
  const far = planPublishedLink({
    scope: { kind: 'folder', path: 'notes' },
    currentLinkCount: maxPublishedLinksPerWorkspace + 40,
  });
  assert.equal(far.ok, false);
  if (far.ok) return;
  assert.equal(far.error.code, 'quota');
});

await test('a count that is not a whole number refuses', () => {
  for (const currentLinkCount of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    const refused = planPublishedLink({
      scope: { kind: 'note', fileId },
      currentLinkCount,
    });
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.error.code, 'quota');
  }
});

await test('the rule answers the stored spelling of the scope', () => {
  const planned = planPublishedLink({
    scope: { kind: 'folder', path: 'notes/café' },
    currentLinkCount: 0,
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.deepEqual(planned.value, { kind: 'folder', path: 'notes/café' });
});

await test('a scope that the path rules refuse gives no link', () => {
  const refused = planPublishedLink({
    scope: { kind: 'folder', path: 'notes/' },
    currentLinkCount: 0,
  });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.error.code, 'invalid_path');
});
