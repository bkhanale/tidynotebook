/**
 * The one list of the languages of a fence (record 0159).
 *
 * The editor and the renderer both read this list, so these checks hold the
 * rule that both surfaces follow.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { highlightCode } from '@lezer/highlight';
import {
  codeLanguageOf,
  codeLanguages,
  loadCodeParser,
} from './code-languages.ts';
import { codeHighlighter, codeTokenClass } from './code-tokens.ts';

await test('an info string names a language by its first word and any case', () => {
  assert.equal(codeLanguageOf('ts')?.name, 'typescript');
  assert.equal(codeLanguageOf('TypeScript')?.name, 'typescript');
  assert.equal(codeLanguageOf('  js title="a"')?.name, 'javascript');
  assert.equal(codeLanguageOf('htm')?.name, 'html');
  assert.equal(codeLanguageOf('json')?.name, 'json');
  assert.equal(codeLanguageOf('cobol'), null);
  assert.equal(codeLanguageOf(''), null);
  assert.equal(codeLanguageOf('mermaid'), null);
});

await test('every name and alias names one language', () => {
  const names = codeLanguages.flatMap((language) => [
    language.name,
    ...language.aliases,
  ]);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.equal(name, name.toLowerCase(), name);
});

await test('every language loads a parser that parses its code', async () => {
  for (const language of codeLanguages) {
    const parser = await loadCodeParser(language);
    const tree = parser.parse('a');
    assert.equal(tree.length, 1, language.name);
  }
});

await test('a parser loads once and is kept', async () => {
  const [language] = codeLanguages;
  assert.ok(language !== undefined);
  const first = await loadCodeParser(language);
  assert.equal(await loadCodeParser(language), first);
});

/** The classes of every token of one piece of code, in order. */
async function tokenClasses(info: string, code: string): Promise<string[]> {
  const language = codeLanguageOf(info);
  assert.ok(language !== null, info);
  const parser = await loadCodeParser(language);
  const found: string[] = [];
  highlightCode(
    code,
    parser.parse(code),
    codeHighlighter,
    (text, classes) => {
      if (classes !== '') found.push(`${classes}:${text}`);
    },
    () => undefined,
  );
  return found;
}

await test('each language gives the tokens of its own grammar', async () => {
  const keyword = codeTokenClass('keyword');
  const string = codeTokenClass('string');
  const attribute = codeTokenClass('attribute');
  assert.ok(
    (await tokenClasses('ts', 'type A = string;')).includes(`${keyword}:type`),
  );
  assert.ok(
    (await tokenClasses('jsx', 'const a = <b />;')).includes(
      `${keyword}:const`,
    ),
  );
  assert.ok(
    (await tokenClasses('json', '{"a": "b"}')).includes(`${attribute}:"a"`),
  );
  assert.ok(
    (await tokenClasses('css', 'a { color: red }')).includes(
      `${attribute}:color`,
    ),
  );
  // The style of a page is CSS and its script is JavaScript.
  const page = await tokenClasses(
    'html',
    '<style>a { color: red }</style><script>let x = "s"</script>',
  );
  assert.ok(page.includes(`${attribute}:color`), page.join(' '));
  assert.ok(page.includes(`${keyword}:let`), page.join(' '));
  assert.ok(page.includes(`${string}:"s"`), page.join(' '));
});
