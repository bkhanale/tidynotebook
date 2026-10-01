/**
 * The one template engine of the product (records 0102 and 0149).
 *
 * A template is the text of a note. When a device makes a daily note, or
 * inserts a template into an open note, each placeholder of that text is
 * filled once, and the note stores the result as plain Markdown. A
 * placeholder is `{{name}}` or `{{name:argument}}`, and a bare format of date
 * tokens such as `{{dddd}}` writes the date as well.
 *
 * Every value comes from one table, `templateVariables`. A variable takes the
 * context of the fill and the argument, and answers the text, or `null` when
 * it cannot, which keeps the placeholder as it was written. A new value is
 * one more row of the table, every caller of `fillTemplate` gets it, and the
 * reading of the text does not change.
 */
import type { CalendarDate } from '../dates/calendar.ts';
import type { ClockTime } from '../dates/clock.ts';
import {
  formatDate,
  formatDateTime,
  isDateFormat,
  isDateTimeFormat,
} from '../dates/format.ts';

/** What a placeholder can read when a device fills a template. */
export type TemplateContext = {
  /**
   * The date that the text states: the date of a daily note, or today on the
   * device for a template that a person inserts.
   */
  readonly date: CalendarDate;
  /** The time of the day at which the device fills the template. */
  readonly time: ClockTime;
  /** The name of the note that gets the text, without its folders. */
  readonly title: string;
};

/** One value of a template. `null` keeps the placeholder as it is. */
type TemplateVariable = (
  context: TemplateContext,
  argument: string | null,
) => string | null;

/**
 * A variable that writes the date and the time in a format, with the format
 * of the variable when the placeholder states none.
 */
function dateTimeVariable(defaultFormat: string): TemplateVariable {
  return (context, argument) => {
    const format = argument ?? defaultFormat;
    return isDateTimeFormat(format)
      ? formatDateTime(context.date, context.time, format)
      : null;
  };
}

/** Every variable of a template, by the name a placeholder gives it. */
const templateVariables: Readonly<Record<string, TemplateVariable>> = {
  date: dateTimeVariable('YYYY-MM-DD'),
  time: dateTimeVariable('HH:mm'),
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
  // A bare format reads the date tokens alone, so a short word such as
  // `{{had}}` never becomes a time (record 0149).
  return isDateFormat(trimmed) ? formatDate(context.date, trimmed) : null;
}

/** The text of a template with every placeholder it can fill, filled. */
export function fillTemplate(text: string, context: TemplateContext): string {
  return text.replace(
    placeholder,
    (whole, expression: string) => valueOf(expression, context) ?? whole,
  );
}
