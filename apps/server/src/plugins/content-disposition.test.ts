import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contentDisposition,
  dispositionKind,
  downloadName,
} from './content-disposition.ts';

/**
 * The whole grammar of the field, as a header parser reads it.
 *
 * The quoted part holds the printable ASCII range without the quote and the
 * backslash. The extended part holds only the characters that RFC 8187 names,
 * plus the percent sign of an encoded byte. A value that matches this pattern
 * cannot end the field, cannot start a second field, and cannot start a second
 * header.
 */
const wellFormed =
  /^(?:attachment|inline); filename="[ -!#-[\]-~]*"; filename\*=UTF-8''[A-Za-z0-9!#$&+\-.^_`|~%]*$/;

/** One character that a header field can never carry. */
const nul = String.fromCharCode(0);

/** Builds the field of one download that the browser saves. */
function saved(name: string): string {
  return contentDisposition({ kind: 'attachment', name, fallback: 'note.md' });
}

await test('an image media type is shown and every other one is saved', () => {
  assert.equal(dispositionKind('image/png'), 'inline');
  assert.equal(dispositionKind('image/jpeg'), 'inline');
  assert.equal(dispositionKind('image/gif'), 'inline');
  assert.equal(dispositionKind('image/webp'), 'inline');
  assert.equal(dispositionKind('IMAGE/PNG; charset=binary'), 'inline');
  assert.equal(dispositionKind('image/svg+xml'), 'attachment');
  assert.equal(dispositionKind('text/html'), 'attachment');
  assert.equal(dispositionKind('text/markdown'), 'attachment');
  assert.equal(dispositionKind('application/zip'), 'attachment');
  assert.equal(dispositionKind(''), 'attachment');
});

await test('the download name is the last segment of the path', () => {
  assert.equal(downloadName('plans/quarter.md'), 'quarter.md');
  assert.equal(downloadName('quarter.md'), 'quarter.md');
  assert.equal(downloadName('a/b/c/pixel.png'), 'pixel.png');
});

await test('a plain name travels in both fields', () => {
  assert.equal(
    saved('quarter.md'),
    `attachment; filename="quarter.md"; filename*=UTF-8''quarter.md`,
  );
  assert.match(saved('quarter.md'), wellFormed);
});

await test('the kind reaches the field', () => {
  assert.equal(
    contentDisposition({
      kind: 'inline',
      name: 'pixel.png',
      fallback: 'image',
    }),
    `inline; filename="pixel.png"; filename*=UTF-8''pixel.png`,
  );
});

await test('a name outside ASCII travels in the encoded field', () => {
  const field = saved('Grüße 🎉.md');
  assert.equal(
    field,
    `attachment; filename="Gr__e _.md"; filename*=UTF-8''Gr%C3%BC%C3%9Fe%20%F0%9F%8E%89.md`,
  );
  assert.match(field, wellFormed);
});

await test('a quote and a backslash cannot end the quoted field', () => {
  const field = saved('a"b\\c.md');
  assert.equal(field.includes('filename="a_b_c.md"'), true);
  assert.equal(field.includes('%22'), true);
  assert.equal(field.includes('%5C'), true);
  assert.match(field, wellFormed);
});

await test('a line break cannot start a second header', () => {
  for (const name of [
    'a\r\nX-Injected: 1.md',
    'a\nX-Injected: 1.md',
    'a\rX-Injected: 1.md',
    `a${nul}b.md`,
  ]) {
    const field = saved(name);
    assert.equal(field.includes('\r'), false, name);
    assert.equal(field.includes('\n'), false, name);
    assert.equal(field.includes(nul), false, name);
    // The name itself stays readable inside the quoted string. What it can
    // never do is end that string, so the field stays one field.
    assert.match(field, wellFormed);
  }
});

await test('a semicolon cannot start a second field', () => {
  const field = saved('a;filename=other.md');
  // The semicolon stays inside the quoted string, where a parser reads it as
  // one character of the name, and it is encoded in the extended field.
  assert.equal(field.includes('filename="a;filename=other.md"'), true);
  assert.equal(
    field.includes(`filename*=UTF-8''a%3Bfilename%3Dother.md`),
    true,
  );
  assert.match(field, wellFormed);
});

await test('an apostrophe cannot split the extended field', () => {
  const field = saved("it's (a) note*.md");
  assert.equal(
    field.includes(`filename*=UTF-8''it%27s%20%28a%29%20note%2A.md`),
    true,
  );
  assert.match(field, wellFormed);
});

await test('an empty name becomes the fallback', () => {
  assert.equal(
    saved(''),
    `attachment; filename="note.md"; filename*=UTF-8''note.md`,
  );
  assert.equal(
    saved('   '),
    `attachment; filename="note.md"; filename*=UTF-8''note.md`,
  );
});

await test('the fallback of an image download names an image', () => {
  assert.equal(
    contentDisposition({ kind: 'inline', name: '', fallback: 'image' }),
    `inline; filename="image"; filename*=UTF-8''image`,
  );
});

await test('a very long name is shortened and keeps its suffix', () => {
  const field = saved(`${'a'.repeat(400)}.md`);
  assert.match(field, wellFormed);
  assert.equal(field.includes('.md"'), true);
  assert.equal(field.endsWith('.md'), true);
  assert.equal(field.length < 256, true, field.length.toString());
});

await test('a very long name outside ASCII stays inside one kilobyte', () => {
  const field = saved(`${'🎉'.repeat(400)}.md`);
  assert.match(field, wellFormed);
  assert.equal(field.length <= 1024, true, field.length.toString());
});

await test('a long name with no usable suffix is shortened alone', () => {
  const field = saved('b'.repeat(400));
  assert.match(field, wellFormed);
  assert.equal(field.includes('b'.repeat(64)), true);
  assert.equal(field.includes('b'.repeat(65)), false);
});

await test('a path separator never reaches the saved name', () => {
  const field = saved('../../etc/passwd');
  assert.equal(field.includes('filename=".._.._etc_passwd"'), true);
  assert.match(field, wellFormed);
});
