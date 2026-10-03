/**
 * The text of the built diagram frame document.
 *
 * The frame has an opaque origin, so a face file of the application is a
 * cross origin request that it cannot make. The frame set its text in a system
 * face of its own for that reason. The build now writes each face of the one
 * stylesheet inside it, and these tests hold the rules of that text.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fontAddresses,
  frameDocumentSource,
  frameEntry,
  inlineFontFaces,
} from './frame-document.ts';

const css = [
  '@font-face{src:url(/fonts/a.woff2) format("woff2")}',
  "@font-face{src:url('/fonts/b.woff2') format('woff2')}",
  '@font-face{src:url("/fonts/a.woff2") format("woff2")}',
  '.x{background:url(/images/c.png)}',
].join('');

await test('the faces of a stylesheet are read once each', () => {
  assert.deepEqual(fontAddresses(css), ['/fonts/a.woff2', '/fonts/b.woff2']);
});

await test('each face travels inside the stylesheet', () => {
  const fonts = new Map([
    ['/fonts/a.woff2', 'QUFB'],
    ['/fonts/b.woff2', 'QkJC'],
  ]);
  const inlined = inlineFontFaces(css, fonts);
  assert.equal(fontAddresses(inlined).length, 0);
  assert.equal(inlined.split('url(data:font/woff2;base64,QUFB)').length, 3);
  assert.ok(inlined.includes('url(data:font/woff2;base64,QkJC)'));
  // An address that is not a face is not touched.
  assert.ok(inlined.includes('url(/images/c.png)'));
});

await test('a face that the build did not read stops the build', () => {
  assert.throws(
    () => inlineFontFaces(css, new Map([['/fonts/a.woff2', 'QUFB']])),
    /\/fonts\/b\.woff2/,
  );
});

await test('the frame document holds its stylesheet and its script', () => {
  const template = `<html><body><div></div>${frameEntry}</body></html>`;
  const source = frameDocumentSource(
    template,
    'a{b:c}</style>',
    'x("$&$`")</script>',
  );
  assert.equal(
    source,
    '<html><body><div></div><style>a{b:c}<\\/style></style><script>x("$&$`")<\\/script></script></body></html>',
  );
  assert.throws(() => frameDocumentSource('<html></html>', 'a', 'b'));
  assert.throws(() => frameDocumentSource(template, '', 'b'));
  assert.throws(() => frameDocumentSource(template, 'a', ''));
});
