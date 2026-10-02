/**
 * The slash menu: a list of blocks at the caret (issue 259).
 *
 * A person who types `/` at the start of a line, or after a space, gets a
 * list of the blocks of the row of formatting tools, and the words after the
 * slash narrow it. The list is the completion list of CodeMirror, which the
 * typed adapter draws as a menu of the design: an accessible listbox whose
 * row the arrow keys move, which Enter and Tab choose and Escape closes, and
 * which a pointer chooses with one press. Choosing a block removes the typed
 * slash and its words and runs the format action of that block, the command
 * that its tool and its key run (record 0094), so the menu holds no rule of
 * its own.
 *
 * The list of the blocks is not here. `apps/web/src/lib/format-toolbar.ts` is
 * the one list of the tools, and the note screen gives the block tools of it
 * to the editor through `slashCommands`. A slash inside code, math, HTML, a
 * link address or a word is text, and inside a table no block applies.
 */
import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { Facet, type EditorState, type Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { formatContextOf } from './format-context.ts';
import {
  formatActionApplies,
  formatActionOf,
  runFormatAction,
  type FormatActionId,
} from './keymaps.ts';

/** One block of the slash menu. */
export type SlashCommand = {
  /** The format action that the block runs. */
  readonly id: FormatActionId;
  /** Other words that find the block, in lower case. */
  readonly keywords: string;
  /** The key of the action as this device writes it, or `null`. */
  readonly hint: string | null;
};

/** The blocks of the slash menu. The last value given wins. */
export const slashCommandsFacet = Facet.define<
  readonly SlashCommand[],
  readonly SlashCommand[]
>({ combine: (values) => values.at(-1) ?? [] });

/** The extension that gives the editor the blocks of the slash menu. */
export function slashCommands(commands: readonly SlashCommand[]): Extension {
  return slashCommandsFacet.of(commands);
}

/** The nodes inside which a slash is text. */
const literalNodes = new Set([
  'FencedCode',
  'CodeBlock',
  'InlineCode',
  'InlineMath',
  'MathBlock',
  'HTMLBlock',
  'HTMLTag',
  'CommentBlock',
  'Autolink',
  'URL',
  'Link',
  'Image',
  'Frontmatter',
]);

/** Whether a position stands inside code, math, HTML, a link or an address. */
function insideLiteral(state: EditorState, pos: number): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    node !== null;
    node = node.parent
  )
    if (literalNodes.has(node.name)) return true;
  return false;
}

/** The slash and the words after it, up to the caret. */
const typedCommand = /\/[\p{L}\p{N}-]*$/u;

/** Whether the words that a person typed find one block. */
export function slashMatches(command: SlashCommand, typed: string): boolean {
  if (typed === '') return true;
  const words = `${formatActionOf(command.id).label} ${command.keywords}`
    .toLowerCase()
    .split(/[\s-]+/);
  const query = typed.toLowerCase();
  return (
    words.some((word) => word.startsWith(query)) ||
    words.join('').startsWith(query)
  );
}

/**
 * The blocks that the slash before `pos` offers, or `null` for no menu.
 *
 * The slash stands at the start of its line or after a space, so `a/b` and
 * an address stay text, and the blocks are the ones that apply where the
 * caret stands.
 */
export function slashMenuAt(
  state: EditorState,
  pos: number,
): {
  readonly from: number;
  readonly commands: readonly SlashCommand[];
} | null {
  const line = state.doc.lineAt(pos);
  const before = state.doc.sliceString(line.from, pos);
  const found = typedCommand.exec(before);
  if (found === null) return null;
  const from = line.from + found.index;
  const previous = found.index === 0 ? '' : (before[found.index - 1] ?? '');
  if (previous !== '' && !/\s/.test(previous)) return null;
  if (insideLiteral(state, from)) return null;
  const context = formatContextOf(state);
  const typed = found[0].slice(1);
  const commands = state
    .facet(slashCommandsFacet)
    .filter(
      (command) =>
        formatActionApplies(formatActionOf(command.id), context) &&
        slashMatches(command, typed),
    );
  return commands.length === 0 ? null : { from, commands };
}

/** The completion source of the slash menu. */
export const slashMenuCompletion: CompletionSource = (
  context: CompletionContext,
): CompletionResult | null => {
  const menu = slashMenuAt(context.state, context.pos);
  if (menu === null) return null;
  return {
    from: menu.from,
    to: context.pos,
    filter: false,
    options: menu.commands.map((command) => ({
      label: formatActionOf(command.id).label,
      ...(command.hint === null ? {} : { detail: command.hint }),
      type: 'text',
      apply: (view, _completion, from, to): void => {
        // The typed slash and its words leave, and the block takes its line.
        view.dispatch({
          changes: { from, to, insert: '' },
          userEvent: 'delete.slash',
        });
        runFormatAction(view, command.id);
      },
    })),
  };
};
