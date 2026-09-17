/**
 * Design and copy rules of the user interface.
 *
 * The root `AGENTS.md` states that Tailwind utilities, the named scales, and
 * the theme registry decide presentation, and that no identifier reaches the
 * person who reads a screen. This check makes those rules fail `pnpm lint`
 * instead of a review.
 *
 * It parses `.ts` and `.tsx` under `apps/web/src` and `packages/ui/src`,
 * excluding test files, and reports:
 *
 * - `inline-style`: a `style` JSX attribute.
 * - `inner-html`: `dangerouslySetInnerHTML`, or an assignment to `innerHTML`.
 * - `colour-literal`: a hex colour or an `rgb(` value in a string, outside
 *   `packages/ui/src/themes/`, which is the one registry that holds colour.
 * - `arbitrary-value`: a Tailwind arbitrary value such as `w-[32rem]`.
 * - `banned-class`: `text-xs`, `text-white`, or `bg-black`.
 * - `raw-elevation`: a built in shadow utility. Depth comes from the three
 *   named steps of decision 0052.
 * - `colour-filter`: a filter utility that changes a colour, such as
 *   `brightness-110`. A colour comes from the palette, so a hover fill reads a
 *   derived name of decision 0057 and never a filter.
 * - `raw-motion`: a transition, a duration, or an easing utility outside
 *   `packages/ui/src/motion.ts`, which is the one motion scale of decision
 *   0054.
 * - `jsx-text`: a `.md` path suffix or a UUID inside text that a person
 *   reads.
 *
 * `tools/design-rules-allow.json` lists the accepted exceptions with a
 * reason. An entry names one file and one rule.
 *
 * A separate root permits a disposable negative check without application
 * fixtures, in the same shape as `tools/check-boundaries.mjs`.
 */
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { parseSync } from 'oxc-parser';
import { filesIn, root } from './workspace.mjs';

/** The trees this check reads. */
export const scanned = ['apps/web/src', 'packages/ui/src'];
/** The one directory that may hold a colour value. */
export const themeDirectory = 'packages/ui/src/themes/';

const hexColour = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/;
const rgbColour = /\brgba?\(/;
// A Tailwind arbitrary value is a utility prefix, then a bracket group. This
// shape does not match a CSS selector such as `[role="menuitem"]`, which has
// no prefix, and it does not match an index expression, which is not a string.
const arbitraryValue = /(?:^|\s|:)-?[a-z][a-zA-Z0-9-]*-\[/;
const bannedClasses = ['text-xs', 'text-white', 'bg-black'];
/** The one module that may name a duration, an easing, or a transition. */
export const motionModule = 'packages/ui/src/motion.ts';
/** The three named elevation steps of the central theme. */
export const elevationSteps = ['raised', 'overlay', 'modal'];
// A utility starts a class string, follows a space, or follows the colon of a
// variant. It never follows a letter, so `transition-shadow` is not a shadow
// utility and `lease-held` is not an easing.
const shadowUtility = /(?:^|[\s:])(shadow(?:-[a-z0-9]+)?)(?![\w-])/g;
// A filter that changes a colour. The palette answers what a colour is, so a
// screen that reaches for one of these is making a colour the gate cannot
// read. Decision 0057.
// A numeric suffix is required where Tailwind also names a variant, so the
// `contrast-more:` preference variant is not a filter.
const colourFilter =
  /(?:^|[\s:])((?:brightness|saturate|contrast|hue-rotate)-\d+|(?:grayscale|invert|sepia)(?:-\d+)?)(?![\w-])/;
const motionUtility =
  /(?:^|[\s:])((?:transition(?:-[a-z]+)?|duration-[a-z0-9]+|ease-[a-z]+))(?![\w-])/g;
const markdownSuffix = /\.md\b/;
const uuid =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/**
 * The rules that read one piece of text.
 *
 * Each returns a message, or `null` when the text passes.
 */
export const textRules = {
  /** @param {string} text @param {string} path @returns {string | null} */
  'colour-literal'(text, path) {
    if (path.startsWith(themeDirectory)) return null;
    const hex = hexColour.exec(text);
    if (hex) return `Colour value ${hex[0]} outside the theme registry.`;
    if (rgbColour.test(text))
      return 'Colour value rgb( outside the theme registry.';
    return null;
  },
  /** @param {string} text @returns {string | null} */
  'arbitrary-value'(text) {
    const found = arbitraryValue.exec(text);
    return found
      ? `Arbitrary Tailwind value near ${found[0].trim()}. Use the named scale.`
      : null;
  },
  /** @param {string} text @returns {string | null} */
  'banned-class'(text) {
    for (const name of bannedClasses) {
      if (new RegExp(`(?:^|[\\s:])${name}(?![\\w-])`).test(text))
        return `Class ${name} is not part of the named scale.`;
    }
    return null;
  },
  /** @param {string} text @returns {string | null} */
  'raw-elevation'(text) {
    for (const match of text.matchAll(shadowUtility)) {
      const utility = match[1] ?? '';
      if (elevationSteps.some((step) => utility === `shadow-${step}`)) continue;
      return `Shadow utility ${utility} is not a named elevation step. Use shadow-${elevationSteps.join(', shadow-')}.`;
    }
    return null;
  },
  /** @param {string} text @returns {string | null} */
  'colour-filter'(text) {
    const found = colourFilter.exec(text);
    return found
      ? `Filter utility ${found[1]} makes a colour that no contrast rule holds. Read a name from the palette.`
      : null;
  },
  /** @param {string} text @param {string} path @returns {string | null} */
  'raw-motion'(text, path) {
    if (path === motionModule) return null;
    const found = motionUtility.exec(text);
    motionUtility.lastIndex = 0;
    return found
      ? `Motion utility ${found[1]} outside ${motionModule}. Read a name from the motion scale.`
      : null;
  },
};

/**
 * The rule that reads text a person sees on a screen.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function jsxTextRule(text) {
  if (markdownSuffix.test(text))
    return 'A note path suffix must not reach the person who reads it.';
  if (uuid.test(text))
    return 'An identifier must not reach the person who reads it.';
  return null;
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return {};
  return Object.fromEntries(Object.entries(value));
}

/**
 * @param {unknown} value
 * @param {(node: Record<string, unknown>, parent: Record<string, unknown> | null) => void} visit
 * @param {Record<string, unknown> | null} [parent]
 */
function walk(value, visit, parent = null) {
  if (Array.isArray(value)) {
    for (const child of value) walk(child, visit, parent);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const node = record(value);
  const type = typeof node.type === 'string' ? node.type : '';
  if (type) visit(node, parent);
  const next = type ? node : parent;
  for (const child of Object.values(node)) walk(child, visit, next);
}

/** @param {Record<string, unknown>} node @returns {string} */
function attributeName(node) {
  const name = record(node.name);
  return typeof name.name === 'string' ? name.name : '';
}

/**
 * Reports every rule that one source file breaks.
 *
 * @param {string} path Repository relative path, with forward slashes.
 * @param {string} text
 * @returns {{ path: string; line: number; rule: string; message: string }[]}
 */
export function scanSource(path, text) {
  /** @type {{ path: string; line: number; rule: string; message: string }[]} */
  const found = [];
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1)
    if (text[index] === '\n') lineStarts.push(index + 1);
  /** @param {unknown} offset @returns {number} */
  const lineOf = (offset) => {
    const position = typeof offset === 'number' ? offset : 0;
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((lineStarts[middle] ?? 0) <= position) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
  /** @param {string} rule @param {string} message @param {unknown} offset */
  const report = (rule, message, offset) =>
    found.push({ path, line: lineOf(offset), rule, message });

  const parsed = parseSync(path, text);
  for (const error of parsed.errors)
    report('parse', String(error.message ?? error), 0);

  walk(parsed.program, (node, parent) => {
    const type = String(node.type);
    if (type === 'JSXAttribute') {
      const name = attributeName(node);
      if (name === 'style')
        report(
          'inline-style',
          'A style attribute sets presentation outside Tailwind.',
          node.start,
        );
      if (name === 'dangerouslySetInnerHTML')
        report(
          'inner-html',
          'dangerouslySetInnerHTML writes unchecked markup.',
          node.start,
        );
      return;
    }
    if (type === 'AssignmentExpression') {
      const left = record(node.left);
      const property = record(left.property);
      if (
        String(left.type) === 'MemberExpression' &&
        left.computed !== true &&
        property.name === 'innerHTML'
      )
        report(
          'inner-html',
          'An innerHTML assignment writes unchecked markup.',
          node.start,
        );
      return;
    }
    /** @type {string | null} */
    let value = null;
    let isJsxText = false;
    if (type === 'JSXText') {
      value = typeof node.value === 'string' ? node.value : '';
      isJsxText = true;
    } else if (type === 'Literal' && typeof node.value === 'string') {
      value = node.value;
      isJsxText = parent !== null && String(parent.type) === 'JSXElement';
    } else if (type === 'TemplateElement') {
      const quasi = record(node.value);
      const cooked = quasi.cooked ?? quasi.raw;
      value = typeof cooked === 'string' ? cooked : '';
    }
    if (value === null || value.trim() === '') return;
    for (const [rule, check] of Object.entries(textRules)) {
      const message = check(value, path);
      if (message !== null) report(rule, message, node.start);
    }
    if (isJsxText) {
      const message = jsxTextRule(value);
      if (message !== null) report('jsx-text', message, node.start);
    }
  });
  return found;
}

/**
 * Reads the accepted exceptions.
 *
 * @param {string} directory
 * @returns {Promise<{ file: string; rule: string; reason: string }[]>}
 */
export async function readAllowlist(directory) {
  const file = resolve(directory, 'tools/design-rules-allow.json');
  const text = await readFile(file, 'utf8').catch(() => '{"allow":[]}');
  const parsed = record(JSON.parse(text));
  if (!Array.isArray(parsed.allow)) return [];
  /** @param {unknown} value @returns {string} */
  const text_ = (value) => (typeof value === 'string' ? value : '');
  return parsed.allow.map((entry) => {
    const item = record(entry);
    return {
      file: text_(item.file),
      rule: text_(item.rule),
      reason: text_(item.reason),
    };
  });
}

/**
 * Runs the check over one repository tree.
 *
 * @param {string} directory
 * @returns {Promise<number>} The process status.
 */
export async function main(directory) {
  const allowed = await readAllowlist(directory);
  const files = (
    await Promise.all(
      scanned.map((folder) => filesIn(resolve(directory, folder))),
    )
  )
    .flat()
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
  /** @type {{ path: string; line: number; rule: string; message: string }[]} */
  const failures = [];
  for (const file of files) {
    const path = relative(directory, file).split(sep).join('/');
    const text = await readFile(file, 'utf8');
    for (const issue of scanSource(path, text)) {
      if (
        allowed.some(
          (entry) => entry.file === issue.path && entry.rule === issue.rule,
        )
      )
        continue;
      failures.push(issue);
    }
  }
  if (failures.length > 0) {
    process.stderr.write(
      [
        'Design rule check failed:',
        ...failures.map(
          (failure) =>
            `  ${failure.path}:${failure.line}: ${failure.rule}: ${failure.message}`,
        ),
        'Add the exception with its reason to tools/design-rules-allow.json only when the rule cannot hold.',
      ].join('\n') + '\n',
    );
    return 1;
  }
  process.stdout.write(
    `Design rules: ${files.length} files checked, ${allowed.length} accepted exceptions.\n`,
  );
  return 0;
}

// The rule functions above are imported by the unit test, so the check itself
// runs only when this file is the program.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--root')) {
    process.stderr.write(
      'Usage: node tools/check-design-rules.mjs [--root <directory>]\n',
    );
    process.exit(1);
  }
  process.exit(await main(resolve(args[1] ?? root)));
}
