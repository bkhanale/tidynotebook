/**
 * The `\(...\)` inline math delimiter, as a micromark text construct.
 *
 * `math-syntax.ts` states that inline math is `$$...$$` or `\(...\)`, and the
 * editor reads both. remark-math gives this package the first pair only,
 * because `\(` is a CommonMark character escape: without this construct
 * `\(a^2\)` renders as the text `(a^2)` and the same note means two different
 * things in the two readers.
 *
 * The construct is registered on the backslash, code 92, before the character
 * escape of CommonMark, so `\(` opens math and every other backslash keeps
 * its CommonMark meaning. `\\(x\)` is still an escaped backslash followed by
 * text, because the pair needs the parenthesis right after the backslash that
 * opened it.
 *
 * The tokens are the ones remark-math already reads, `mathText` around the
 * whole construct and `mathTextData` around its content, so
 * `mathFromMarkdown` builds the same `inlineMath` node as `$$...$$` and the
 * renderer and the sanitizer need no change at all.
 *
 * Math opens only when the same line closes it. Inline math is a one line
 * construct, so a lone `\(` stays text. Math ends at the first `\)`.
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

/** Character codes this construct reads. */
const backslash = 92;
const openParen = 40;
const closeParen = 41;

/** Whether a code ends the line, or the document. */
function endsLine(code: Code): boolean {
  return code === null || code < -2;
}

/**
 * Reads `\)` and nothing else.
 *
 * The main tokenizer runs this as a check before it consumes a backslash, so
 * the closing pair never lands inside the content, and as an attempt when the
 * check said yes. It is partial, so it produces no token of its own.
 */
const closingParenPair: Construct = {
  name: 'mathTextParenClose',
  partial: true,
  tokenize: function tokenizeClose(effects: Effects, ok: State, nok: State) {
    return start;

    function start(code: Code): State | undefined {
      if (code !== backslash) return nok(code);
      effects.enter('mathTextSequence');
      effects.consume(code);
      return second;
    }

    function second(code: Code): State | undefined {
      if (code !== closeParen) return nok(code);
      effects.consume(code);
      effects.exit('mathTextSequence');
      return ok;
    }
  },
};

/** Reads one `\(...\)` construct on one line. */
function tokenizeMathTextParens(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  let inData = false;
  return start;

  function start(code: Code): State | undefined {
    if (code !== backslash) return nok(code);
    effects.enter('mathText');
    effects.enter('mathTextSequence');
    effects.consume(code);
    return afterOpeningBackslash;
  }

  function afterOpeningBackslash(code: Code): State | undefined {
    if (code !== openParen) return nok(code);
    effects.consume(code);
    effects.exit('mathTextSequence');
    return inside;
  }

  function inside(code: Code): State | undefined {
    if (endsLine(code)) return nok(code);
    if (code === backslash)
      return effects.check(closingParenPair, atClose, insideBackslash)(code);
    if (!inData) {
      effects.enter('mathTextData');
      inData = true;
    }
    effects.consume(code);
    return inside;
  }

  function insideBackslash(code: Code): State | undefined {
    if (!inData) {
      effects.enter('mathTextData');
      inData = true;
    }
    effects.consume(code);
    return inside;
  }

  function atClose(code: Code): State | undefined {
    if (inData) {
      effects.exit('mathTextData');
      inData = false;
    }
    return effects.attempt(closingParenPair, done, nok)(code);
  }

  function done(code: Code): State | undefined {
    effects.exit('mathText');
    return ok(code);
  }
}

/**
 * The micromark extension that adds `\(...\)` inline math.
 *
 * `add: 'before'` puts the construct ahead of the CommonMark character escape
 * on the same code, which is what lets `\(` mean math.
 */
export const mathTextParensExtension: Extension = {
  text: {
    [backslash]: {
      name: 'mathTextParens',
      tokenize: tokenizeMathTextParens,
      add: 'before',
    },
  },
};
