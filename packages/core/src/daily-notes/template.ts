/**
 * The placeholders of a daily note template (record 0102).
 *
 * A template is the text of a note. When the device makes a daily note, each
 * placeholder of that text is filled once, and the note stores the result as
 * plain Markdown. A placeholder is `{{name}}` or `{{name:argument}}`, and a
 * bare format of date tokens such as `{{dddd}}` writes the date as well.
 *
 * Every value comes from one table, `templateVariables`. A variable takes the
 * context of the new note and the argument, and answers the text, or `null`
 * when it cannot, which keeps the placeholder as it was written. A new value
 * is one more row of the table and no change to the reading of the text.
 */
import type { CalendarDate } from './calendar.ts';
import { formatDailyNoteName, isDateFormat } from './format.ts';

/** What a placeholder of a new daily note can read. */
export type TemplateContext = {
  /** The date of the daily note, which is not always today. */
  readonly date: CalendarDate;
  /** The name of the new note, without its folders. */
  readonly title: string;
};

/** One value of a template. `null` keeps the placeholder as it is. */
type TemplateVariable = (
  context: TemplateContext,
  argument: string | null,
) => string | null;

/** The format of `{{date}}` with no argument. */
const defaultDateFormat = 'YYYY-MM-DD';

/** Every variable of a template, by the name a placeholder gives it. */
const templateVariables: Readonly<Record<string, TemplateVariable>> = {
  date: (context, argument) => {
    const format = argument ?? defaultDateFormat;
    return isDateFormat(format)
      ? formatDailyNoteName(context.date, format)
      : null;
  },
  title: (context) => context.title,
};

/** The names of the variables, for the words a person reads. */
export const templateVariableNames: readonly string[] =
  Object.keys(templateVariables);

/** One placeholder: two braces, the expression, two braces. */
const placeholder = /\{\{([^{}]*)\}\}/g;

/** A name and an optional argument, `name` or `name:argument`. */
const variableExpression = /^([A-Za-z][A-Za-z0-9_]*)(?:\s*:([\s\S]*))?$/;

/** The text of one placeholder expression, or `null` to keep it. */
function valueOf(expression: string, context: TemplateContext): string | null {
  const trimmed = expression.trim();
  const named = variableExpression.exec(trimmed);
  if (named !== null) {
    const variable = templateVariables[named[1] ?? ''];
    if (variable !== undefined)
      return variable(context, named[2] === undefined ? null : named[2].trim());
  }
  return isDateFormat(trimmed)
    ? formatDailyNoteName(context.date, trimmed)
    : null;
}

/** The text of a template with every placeholder it can fill, filled. */
export function fillTemplate(text: string, context: TemplateContext): string {
  return text.replace(
    placeholder,
    (whole, expression: string) => valueOf(expression, context) ?? whole,
  );
}
