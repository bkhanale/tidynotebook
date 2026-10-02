/**
 * Inline math on one dollar, as a micromark text construct (record 0171).
 *
 * `math-syntax.ts` states the rule of Pandoc: one dollar opens a formula when
 * no dollar stands before it and the next character is not a space and not a
 * dollar, and the formula closes on a dollar that has no space before it and
 * no digit after it, on the same line. remark-math reads one dollar by the
 * rule of a code span instead, which turns `$5 and $10` into a formula, so
 * its own option stays off and this construct reads the one dollar.
 *
 * The tokens are the ones remark-math already reads, `mathText` around the
 * whole construct and `mathTextData` around its content, so
 * `mathFromMarkdown` builds the same `inlineMath` node as `$$...$$` and the
 * renderer and the sanitizer need no change at all.
 *
 * A backslash before a dollar is a CommonMark character escape, which runs
 * before this construct, so `\$` is a dollar and never opens math. Inside the
 * formula a backslash escapes the next character, so `\$` there is part of
 * the formula and does not close it. `dollarMathEnd` of `math-syntax.ts`
 * states the same scan for the editor, and `math-syntax.test.ts` holds this
 * construct to it.
 */
// The token names below belong to micromark-extension-math, which remark-math
// installs. This import declares nothing of its own; it loads the module that
// adds those names to the micromark token map.
import type {} from 'micromark-extension-math';
import type {
  Code,
  Construct,
  Effects,
  Extension,
  State,
  TokenizeContext,
} from 'micromark-util-types';
import { closesDollarMath, opensDollarMath } from './math-syntax.ts';

/** Character codes this construct reads. */
const dollar = 36;
const backslash = 92;

/** Whether a code ends the line, or the document. */
function endsLine(code: Code): boolean {
  return code === null || code === -5 || code === -4 || code === -3;
}

/**
 * The character of one code, as the rule of `math-syntax.ts` reads it.
 *
 * A line ending and the end of the document read as the edge of the line, an
 * empty text. A tab and a virtual space read as a space.
 */
function characterOf(code: Code): string {
  if (endsLine(code) || code === null) return '';
  if (code < 0) return ' ';
  return String.fromCodePoint(code);
}

/**
 * Reads one dollar and what stands after it: a closing dollar or not.
 *
 * The main tokenizer runs this as a check before it consumes a dollar inside
 * the formula, because the rule needs the character after the dollar. It is
 * partial, so it produces no token of its own.
 */
const closingDollar: Construct = {
  name: 'mathTextDollarClose',
  partial: true,
  tokenize: function tokenizeClose(effects: Effects, ok: State, nok: State) {
    return start;

    function start(code: Code): State | undefined {
      if (code !== dollar) return nok(code);
      effects.enter('mathTextSequence');
      effects.consume(code);
      effects.exit('mathTextSequence');
      return after;
    }

    function after(code: Code): State | undefined {
      // The character before the dollar was checked by the main tokenizer.
      return closesDollarMath('x', characterOf(code)) ? ok(code) : nok(code);
    }
  },
};

/** Reads one `$...$` construct on one line. */
function tokenizeMathTextDollar(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  // The code before the dollar, read when the dollar is reached.
  const previous = (): Code => this.previous;
  /** The last character of the formula so far. */
  let last = '';
  return start;

  function start(code: Code): State | undefined {
    if (code !== dollar) return nok(code);
    // A dollar after a dollar is part of a run of two, which remark-math
    // reads, or a run that opens nothing.
    if (previous() === dollar) return nok(code);
    effects.enter('mathText');
    effects.enter('mathTextSequence');
    effects.consume(code);
    effects.exit('mathTextSequence');
    return afterOpen;
  }

  function afterOpen(code: Code): State | undefined {
    if (!opensDollarMath('', characterOf(code))) return nok(code);
    effects.enter('mathTextData');
    return inside(code);
  }

  function inside(code: Code): State | undefined {
    if (endsLine(code)) return nok(code);
    if (code === backslash) {
      effects.consume(code);
      last = '\\';
      return escaped;
    }
    if (code === dollar && closesDollarMath(last, 'x'))
      return effects.check(closingDollar, atClose, keep)(code);
    return keep(code);
  }

  function keep(code: Code): State | undefined {
    effects.consume(code);
    last = characterOf(code);
    return inside;
  }

  function escaped(code: Code): State | undefined {
    if (endsLine(code)) return nok(code);
    return keep(code);
  }

  function atClose(code: Code): State | undefined {
    effects.exit('mathTextData');
    effects.enter('mathTextSequence');
    effects.consume(code);
    effects.exit('mathTextSequence');
    effects.exit('mathText');
    return ok;
  }
}

/**
 * The micromark extension that adds `$...$` inline math.
 *
 * It sits on the dollar beside the construct of remark-math. The two never
 * both accept one dollar: this one refuses a run of two, and remark-math
 * refuses a run of one.
 */
export const mathTextDollarExtension: Extension = {
  text: {
    [dollar]: {
      name: 'mathTextDollar',
      tokenize: tokenizeMathTextDollar,
      add: 'before',
    },
  },
};
