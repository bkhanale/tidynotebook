/**
 * The Lezer parse of the editor grows with the size of a paragraph (record
 * 0185).
 *
 * The inline parse of a paragraph keeps a list of its parts. Each web address
 * asked whether a link was open with a scan of the whole list, so a paragraph
 * of many addresses took the square of its size and held the tab. The count
 * here is of the parts read, not of time: a parse that reads the list for
 * each address reads the square of the paragraph.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { GFM, parser, type InlineContext } from '@lezer/markdown';

/** The parts of the inline parses of `text` that the parser reads. */
function partReads(text: string): number {
  let reads = 0;
  const counted = new WeakSet<InlineContext>();
  const counting = parser.configure([
    GFM,
    {
      parseInline: [
        {
          name: 'CountPartReads',
          before: 'Autolink',
          parse(cx) {
            if (counted.has(cx)) return -1;
            counted.add(cx);
            // The list of parts is internal to the parser, so the test
            // reaches it by name and checks what it finds.
            const parts: unknown = Reflect.get(cx, 'parts');
            assert.ok(Array.isArray(parts));
            Reflect.set(
              cx,
              'parts',
              new Proxy(parts, {
                get(target, key, receiver): unknown {
                  if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
                  return Reflect.get(target, key, receiver);
                },
              }),
            );
            return -1;
          },
        },
      ],
    },
  ]);
  counting.parse(text);
  return reads;
}

await test('a paragraph of many web addresses reads its parts in proportion to its size', () => {
  // The review of 2026-10-03: one paragraph of a few hundred kilobytes of
  // addresses held the parse of the editor for seconds.
  for (const unit of [' :www.a.b', ' https://a.b', '[ :www.a.b']) {
    const once = partReads(unit.repeat(2000));
    const twice = partReads(unit.repeat(4000));
    assert.ok(
      twice <= 2.5 * once,
      `${unit}: ${String(once)} then ${String(twice)}`,
    );
  }
});
