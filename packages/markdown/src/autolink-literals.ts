/**
 * The literal links of GFM, found in time that grows with the note (record
 * 0185).
 *
 * remark-gfm finds `www.example.com`, `https://example.com` and
 * `name@example.com` in a step that runs after the parse, over every text of
 * the tree (`mdast-util-gfm-autolink-literal`). That step costs the square of
 * its input in three ways:
 *
 * - It looks up the place of each text among its siblings, and of each
 *   parent among its own, with a search from the start of the list. A note
 *   of many paragraphs, or a paragraph of many texts, costs its square.
 * - Its two regular expressions scan again from each place where a match
 *   may start. A long word of dots, dashes or underscores costs its square
 *   in the expression of a mail address, even with no `@` in the note, and a
 *   long word with many `www` in it costs its square in the one of a web
 *   address.
 * - It puts every match of one text into one list of arguments, and a text
 *   of a hundred thousand matches runs the call out of stack.
 *
 * This module is the same step, with the same rules, written so that each
 * text is read a fixed number of times. `literalLinks` gives the nodes that
 * the step gives for one text: first the web addresses, then the mail
 * addresses in the texts between them. The rules of the step are kept one
 * for one: `webAddress` is `findUrl`, `mailAddress` is `findEmail`,
 * `domainCheck` is `isCorrectDomain`, `splitAddress` is `splitUrl`, and
 * `allowedBefore` is `previous`. `autolink-literals.test.ts` holds the result
 * equal to the result of the step on generated texts and on the corpus.
 */
import type { Link, Nodes, PhrasingContent, Text } from 'mdast';
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
import {
  unicodePunctuation,
  unicodeWhitespace,
} from 'micromark-util-character';
import type { Processor } from 'unified';

/** A step that changes a tree after the parse, as remark runs it. */
export type TreeStep = NonNullable<
  ReturnType<typeof gfmAutolinkLiteralFromMarkdown>['transforms']
>[number];

/** The parents whose texts the step leaves as they are. */
const ignoredParents = new Set(['link', 'linkReference']);

/** Whether a code unit is one of `-`, `.`, an ASCII letter or digit, or `_`. */
function domainCharacter(code: number): boolean {
  return (
    code === 0x2d ||
    code === 0x2e ||
    code === 0x5f ||
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a)
  );
}

/** Whether a code unit can be in the name before the `@` of an address. */
function nameCharacter(code: number): boolean {
  return code === 0x2b || domainCharacter(code);
}

/** Whether a code unit can be in a part of the domain of a mail address. */
function labelCharacter(code: number): boolean {
  return code !== 0x2e && domainCharacter(code);
}

/** Whether a code unit is white space that ends a web address. */
function addressEnd(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0d || code === 0x0a;
}

/**
 * Whether a match at `index` follows white space or punctuation, as the step
 * reads the code unit before it. A mail address after a `/` is no match.
 */
function allowedBefore(text: string, index: number, mail: boolean): boolean {
  if (index === 0) return true;
  const code = text.charCodeAt(index - 1);
  return (
    (unicodeWhitespace(code) || unicodePunctuation(code)) &&
    (!mail || code !== 0x2f)
  );
}

/** White space, punctuation or a symbol, as one code point. */
const spaceOrPunctuation = /^(?:\s|\p{P}|\p{S})$/u;

/**
 * Whether a mail address may start at `index`: at the start of the text, or
 * after a code point of white space, punctuation or a symbol. This is the
 * look behind of the expression of the step, which reads a whole code point
 * where `allowedBefore` reads one code unit.
 */
function mayStartMail(text: string, index: number): boolean {
  if (index === 0) return true;
  const low = text.charCodeAt(index - 1);
  const pair =
    index >= 2 &&
    low >= 0xdc00 &&
    low <= 0xdfff &&
    text.charCodeAt(index - 2) >= 0xd800 &&
    text.charCodeAt(index - 2) <= 0xdbff;
  return spaceOrPunctuation.test(
    text.slice(pair ? index - 2 : index - 1, index),
  );
}

/** Whether a part of a domain is wrong: it has `_` or no letter or digit. */
function wrongPart(part: string): boolean {
  return part !== '' && (part.includes('_') || !/[a-zA-Z\d]/.test(part));
}

/**
 * Whether `text` from `from` to `to` is a domain the step accepts: two parts
 * at least, and neither of the last two wrong. Each domain ends where its run
 * of domain characters ends, so the answer for the last two parts is kept for
 * that end, and a long word costs no more than one reading of it.
 */
function domainCheck(text: string): (from: number, to: number) => boolean {
  let known = -1;
  let last = -1;
  let before = -1;
  let lastWrong = false;
  let middleWrong = false;
  return (from, to) => {
    if (to !== known) {
      known = to;
      last = text.lastIndexOf('.', to - 1);
      before = last > 0 ? text.lastIndexOf('.', last - 1) : -1;
      lastWrong = last !== -1 && wrongPart(text.slice(last + 1, to));
      middleWrong = before !== -1 && wrongPart(text.slice(before + 1, last));
    }
    if (last < from || lastWrong) return false;
    if (before >= from) return !middleWrong;
    return !wrongPart(text.slice(from, last));
  };
}

/** The characters that end an address and stay out of it. */
const trailCharacters = new Set('!"&\'),.:;<>?]}');

/**
 * The address and the trail of punctuation after it, as the step splits
 * them: the punctuation at the end leaves the address, except each `)` that
 * closes a `(` of the address.
 */
function splitAddress(url: string): readonly [string, string | undefined] {
  let cut = url.length;
  while (cut > 0 && trailCharacters.has(url.charAt(cut - 1))) cut -= 1;
  if (cut === url.length) return [url, undefined];
  const kept = url.slice(0, cut);
  let opening = 0;
  let closing = 0;
  for (const char of kept) {
    if (char === '(') opening += 1;
    else if (char === ')') closing += 1;
  }
  let end = cut;
  for (let index = cut; index < url.length && opening > closing; index += 1)
    if (url.charAt(index) === ')') {
      end = index + 1;
      closing += 1;
    }
  return [url.slice(0, end), url.slice(end)];
}

/** Whether the code unit at `index` is the ASCII letter `lower` in any case. */
function letterAt(text: string, index: number, lower: string): boolean {
  const code = text.charCodeAt(index);
  const want = lower.charCodeAt(0);
  return code === want || code === want - 0x20;
}

/**
 * The length of the prefix of a web address at `index`, or 0: `http://` or
 * `https://` in any case, or `www` in any case before a dot.
 */
function webPrefix(text: string, index: number): number {
  if (
    letterAt(text, index, 'h') &&
    letterAt(text, index + 1, 't') &&
    letterAt(text, index + 2, 't') &&
    letterAt(text, index + 3, 'p')
  ) {
    const secure = letterAt(text, index + 4, 's') ? 1 : 0;
    return text.startsWith('://', index + 4 + secure) ? 7 + secure : 0;
  }
  return letterAt(text, index, 'w') &&
    letterAt(text, index + 1, 'w') &&
    letterAt(text, index + 2, 'w') &&
    text.charCodeAt(index + 3) === 0x2e
    ? 3
    : 0;
}

/**
 * The end of the run of characters that pass `test` from `index`, read once
 * for each run: a later question inside the same run reads no character.
 */
function runEnds(
  text: string,
  test: (code: number) => boolean,
): (index: number) => number {
  let from = -1;
  let to = -1;
  return (index) => {
    if (index >= from && index < to) return to;
    let end = index;
    while (end < text.length && test(text.charCodeAt(end))) end += 1;
    from = index;
    to = end;
    return end;
  };
}

/** A text node. */
function textNode(value: string): Text {
  return { type: 'text', value };
}

/** A link of the step, with its address and its text. */
function linkNode(url: string, value: string): Link {
  return { type: 'link', title: null, url, children: [textNode(value)] };
}

/**
 * The web addresses of `text`, as the step finds them, or `null` when it
 * finds none. A match runs to the next white space, so after one the search
 * goes on after that white space. A match the rules refuse lets the search
 * go on one character further.
 */
function webAddresses(text: string): PhrasingContent[] | null {
  const domainEnd = runEnds(text, domainCharacter);
  const addressEndAt = runEnds(text, (code) => !addressEnd(code));
  const correctDomain = domainCheck(text);
  const nodes: PhrasingContent[] = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const prefix = webPrefix(text, index);
    const domainFrom = index + prefix;
    const domainTo = prefix === 0 ? domainFrom : domainEnd(domainFrom);
    if (domainTo === domainFrom) {
      index += 1;
      continue;
    }
    const end = addressEndAt(domainTo);
    const found = webAddress(text, index, prefix, domainTo, end, correctDomain);
    if (found === null) {
      index += 1;
      continue;
    }
    if (start !== index) nodes.push(textNode(text.slice(start, index)));
    for (const node of found) nodes.push(node);
    start = end;
    index = end;
  }
  if (nodes.length === 0) return null;
  if (start < text.length) nodes.push(textNode(text.slice(start)));
  return nodes;
}

/**
 * The rule of one web address at `index`: the nodes it becomes, or `null`
 * when the rules refuse it. `prefix` is the length of `http://`, `https://`
 * or `www`, the domain ends at `domainTo`, and the address at `end`.
 */
function webAddress(
  text: string,
  index: number,
  prefix: number,
  domainTo: number,
  end: number,
  correctDomain: (from: number, to: number) => boolean,
): PhrasingContent[] | null {
  if (!allowedBefore(text, index, false)) return null;
  const www = letterAt(text, index, 'w');
  const protocol = www ? '' : text.slice(index, index + prefix);
  const domainFrom = www ? index : index + prefix;
  if (!correctDomain(domainFrom, domainTo)) return null;
  const [address, trail] = splitAddress(text.slice(domainFrom, end));
  if (address === '') return null;
  const link = linkNode(
    `${www ? 'http://' : ''}${protocol}${address}`,
    `${protocol}${address}`,
  );
  return trail === undefined || trail === '' ? [link] : [link, textNode(trail)];
}

/**
 * The end of the domain of a mail address that starts at `index`: one part,
 * then one or more parts after a dot. `-1` when there is no such domain.
 */
function mailDomainEnd(text: string, index: number): number {
  let end = index;
  while (end < text.length && labelCharacter(text.charCodeAt(end))) end += 1;
  if (end === index) return -1;
  let parts = 1;
  while (
    text.charCodeAt(end) === 0x2e &&
    end + 1 < text.length &&
    labelCharacter(text.charCodeAt(end + 1))
  ) {
    end += 1;
    while (end < text.length && labelCharacter(text.charCodeAt(end))) end += 1;
    parts += 1;
  }
  return parts >= 2 ? end : -1;
}

/**
 * The mail addresses of `text`, as the step finds them, or `null` when it
 * finds none. Each address holds one `@`, so the search goes from one `@` to
 * the next: the name is the run of name characters before it, from its
 * first place where an address may start, and the domain the run after it.
 */
function mailAddresses(text: string): PhrasingContent[] | null {
  const nodes: PhrasingContent[] = [];
  let start = 0;
  let searched = 0;
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (at <= searched) continue;
    let nameFrom = at;
    while (nameFrom > searched && nameCharacter(text.charCodeAt(nameFrom - 1)))
      nameFrom -= 1;
    if (nameFrom === at) continue;
    const end = mailDomainEnd(text, at + 1);
    if (end === -1) continue;
    const label = text.slice(at + 1, end);
    if (/[-\d_]$/.test(label)) continue;
    for (let from = nameFrom; from < at; from += 1) {
      if (!mayStartMail(text, from) || !allowedBefore(text, from, true))
        continue;
      if (start !== from) nodes.push(textNode(text.slice(start, from)));
      const address = text.slice(from, end);
      nodes.push(linkNode(`mailto:${address}`, address));
      start = end;
      searched = end;
      break;
    }
  }
  if (nodes.length === 0) return null;
  if (start < text.length) nodes.push(textNode(text.slice(start)));
  return nodes;
}

/**
 * The nodes that the literal link step of GFM makes of one text, or `null`
 * when it leaves the text as it is.
 */
export function literalLinks(text: string): PhrasingContent[] | null {
  const web = webAddresses(text);
  const pieces = web ?? [textNode(text)];
  const nodes: PhrasingContent[] = [];
  let changed = web !== null;
  for (const piece of pieces) {
    const mail = piece.type === 'text' ? mailAddresses(piece.value) : null;
    if (mail === null) nodes.push(piece);
    else {
      changed = true;
      for (const node of mail) nodes.push(node);
    }
  }
  return changed ? nodes : null;
}

/** The children of a node, or `null` for a node that holds none. */
function childrenOf(node: Nodes): Nodes[] | null {
  return 'children' in node ? node.children : null;
}

/**
 * The literal link step over a whole tree: each text outside a link takes
 * the nodes of `literalLinks`, and each list of children is written once.
 */
export const findLiteralLinks: TreeStep = (tree) => {
  const pending: Nodes[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    const children = childrenOf(node);
    if (children === null || ignoredParents.has(node.type)) continue;
    let result: Nodes[] | null = null;
    for (const [index, child] of children.entries()) {
      const found = child.type === 'text' ? literalLinks(child.value) : null;
      if (found === null) {
        pending.push(child);
        result?.push(child);
        continue;
      }
      result ??= children.slice(0, index);
      for (const made of found) result.push(made);
    }
    if (result === null) continue;
    children.length = 0;
    for (const kept of result) children.push(kept);
  }
};

/**
 * Puts `findLiteralLinks` in the place of the literal link step that
 * remark-gfm installs. It runs after remark-gfm, and fails when it does not
 * find that step exactly once, so a change of GFM cannot bring the step that
 * grows with the square of the note back unseen.
 */
export function remarkLinearLiteralLinks(this: Processor): undefined {
  const data = this.data();
  const [step, ...others] = gfmAutolinkLiteralFromMarkdown().transforms ?? [];
  if (step === undefined || others.length > 0)
    throw new Error('GFM has no single step that finds literal links.');
  let found = 0;
  const swapOne = (
    extension: ReturnType<typeof gfmAutolinkLiteralFromMarkdown>,
  ): typeof extension => {
    const steps = extension.transforms;
    if (steps === undefined || steps === null || !steps.includes(step))
      return extension;
    found += 1;
    return {
      ...extension,
      transforms: steps.map((one) => (one === step ? findLiteralLinks : one)),
    };
  };
  data.fromMarkdownExtensions = (data.fromMarkdownExtensions ?? []).map(
    (extension) =>
      Array.isArray(extension) ? extension.map(swapOne) : swapOne(extension),
  );
  if (found !== 1)
    throw new Error('remark-gfm did not install its literal link step once.');
}
