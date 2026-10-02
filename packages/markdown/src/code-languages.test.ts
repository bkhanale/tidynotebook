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
  codeBlockLabel,
  codeLanguageOf,
  codeLanguages,
  diagramFence,
  loadCodeLanguage,
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

await test('each new language of record 0173 colours its own code', async () => {
  const keyword = codeTokenClass('keyword');
  const string = codeTokenClass('string');
  const comment = codeTokenClass('comment');
  const number = codeTokenClass('number');
  const invalid = codeTokenClass('invalid');
  const samples: readonly (readonly [string, string, readonly string[]])[] = [
    [
      'python',
      'def f(x):\n    return "s"  # c',
      [`${keyword}:def`, `${string}:"s"`, `${comment}:# c`],
    ],
    [
      'bash',
      'if [ -f x ]; then echo "hi"; fi # c',
      [`${keyword}:if`, `${string}:"hi"`, `${comment}:# c`],
    ],
    [
      'sql',
      'SELECT a FROM t WHERE id = 3 -- c',
      [`${keyword}:SELECT`, `${number}:3`, `${comment}:-- c`],
    ],
    ['go', 'func main() { return 1 }', [`${keyword}:func`, `${number}:1`]],
    ['rust', 'fn main() { let s = "x"; }', [`${keyword}:fn`, `${string}:"x"`]],
    ['yaml', 'key: "value" # c', [`${string}:"value"`, `${comment}:# c`]],
    ['java', 'class A { int b = 2; }', [`${keyword}:class`, `${number}:2`]],
    ['c', 'int main() { return 0; }', [`${number}:0`]],
    ['c++', 'class A {}; // c', [`${keyword}:class`, `${comment}:// c`]],
    [
      'cs',
      'public class A { string s = "x"; }',
      [`${keyword}:public`, `${string}:"x"`],
    ],
    ['php', '<?php echo "a";', [`${keyword}:echo`, `${string}:"a"`]],
    [
      'xml',
      '<a b="c"><!-- d --></a>',
      [`${string}:"c"`, `${comment}:<!-- d -->`],
    ],
    [
      'dockerfile',
      'FROM node:26\nRUN npm ci',
      [`${keyword}:FROM`, `${keyword}:RUN`],
    ],
    [
      'kotlin',
      'fun main() { val s = "x" }',
      [`${keyword}:fun`, `${string}:"x"`],
    ],
    ['swift', 'func f() { let s = "x" }', [`${keyword}:func`, `${string}:"x"`]],
    ['ruby', 'def f\n  "x"\nend', [`${keyword}:def`, `${string}:"x"`]],
    ['toml', 'a = "b" # c', [`${string}:"b"`, `${comment}:# c`]],
    ['diff', '+added\n-removed', [`${string}:+added`, `${invalid}:-removed`]],
  ];
  for (const [info, code, expected] of samples) {
    const found = await tokenClasses(info, code);
    for (const token of expected)
      assert.ok(
        found.includes(token),
        `${info}: ${token} in ${found.join(' ')}`,
      );
  }
});

await test('the renderer and the editor share one language object', async () => {
  // Record 0173. The parser of the renderer is the parser of the language
  // that the editor mounts, so one token cannot read two ways.
  for (const language of codeLanguages) {
    const loaded = await loadCodeLanguage(language);
    assert.equal(await loadCodeParser(language), loaded.parser, language.name);
  }
});

await test('a code block reads the label of its language or its own word', () => {
  // Record 0174.
  assert.equal(codeBlockLabel('py'), 'Python');
  assert.equal(codeBlockLabel('Bash title="a"'), 'Shell');
  assert.equal(codeBlockLabel('c++'), 'C++');
  assert.equal(codeBlockLabel('  cobol  '), 'cobol');
  assert.equal(codeBlockLabel(''), null);
  assert.equal(codeBlockLabel('   '), null);
});

await test('a fence is a diagram by the first word of its info string', () => {
  // Review of record 0174: the renderer read the first word and the editor
  // the whole info string, so `mermaid title` was a diagram on one surface.
  for (const info of ['mermaid', 'Mermaid', ' MERMAID ', 'mermaid title'])
    assert.equal(diagramFence(info), true, info);
  for (const info of ['', 'mermaidx', 'js mermaid', 'graph'])
    assert.equal(diagramFence(info), false, info);
});
