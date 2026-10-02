/**
 * The HTML that an author may write (record 0157).
 *
 * The renderer trusts this list, so each rule of its shape is proved here
 * rather than read from rendered HTML.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorElements,
  authorProperties,
  authorStrippedElements,
  previewHtmlElements,
  previewHtmlTag,
} from './html-elements.ts';

await test('no author attribute names a style, an event, an address or an identity', () => {
  // A style moves content over the page, an event runs a script, an address
  // skips the URL policy, and a class or an identifier claims a construct of
  // the renderer. None of them may be on the list.
  const refused =
    /^(?:on|style$|href$|src$|className$|id$|data|action$|formAction$)/i;
  for (const [tagName, attributes] of authorElements)
    for (const attribute of attributes)
      assert.ok(!refused.test(attribute.name), `${tagName} ${attribute.name}`);
});

await test('no author element runs a script or loads a resource', () => {
  for (const tagName of [
    'a',
    'img',
    'picture',
    'video',
    'audio',
    'source',
    'iframe',
    'object',
    'embed',
    'script',
    'style',
    'link',
    'meta',
    'form',
    'input',
    'button',
    'svg',
    'math',
  ])
    assert.ok(!authorElements.has(tagName), tagName);
});

await test('a stripped element is never an element of the list', () => {
  for (const tagName of authorStrippedElements)
    assert.ok(!authorElements.has(tagName), tagName);
  assert.ok(authorStrippedElements.includes('script'));
  assert.ok(authorStrippedElements.includes('style'));
});

await test('every element that the editor draws is an element of the list', () => {
  for (const tagName of previewHtmlElements)
    assert.ok(authorElements.has(tagName), tagName);
});

await test('an attribute keeps only the value of its shape', () => {
  assert.deepEqual(
    authorProperties('td', {
      align: 'right',
      colSpan: 2,
      rowSpan: 0,
      style: 'color: red',
    }),
    { align: 'right', colSpan: 2 },
  );
  assert.deepEqual(authorProperties('td', { align: 'justify' }), {});
  assert.deepEqual(authorProperties('details', { open: true }), {
    open: true,
  });
  assert.deepEqual(authorProperties('abbr', { title: 'A title' }), {
    title: 'A title',
  });
  assert.deepEqual(authorProperties('ol', { start: 2.5 }), {});
  assert.deepEqual(authorProperties('kbd', { title: 'x', onClick: 'x()' }), {});
  assert.deepEqual(authorProperties('unknown', { title: 'x' }), {});
});

await test('a tag of a drawn element reads as one tag', () => {
  assert.deepEqual(previewHtmlTag('<kbd>'), { name: 'kbd', closing: false });
  assert.deepEqual(previewHtmlTag('</KBD>'), { name: 'kbd', closing: true });
  assert.deepEqual(previewHtmlTag('<sub >'), { name: 'sub', closing: false });
});

await test('a tag that the editor does not draw reads as nothing', () => {
  for (const token of [
    '<br>',
    '<br/>',
    '<kbd/>',
    '<kbd class="x">',
    '<details>',
    '<script>',
    '<span>',
    'kbd',
    '<kbd',
  ])
    assert.equal(previewHtmlTag(token), null, token);
});
