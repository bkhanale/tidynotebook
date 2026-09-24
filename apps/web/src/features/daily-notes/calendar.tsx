/**
 * The month calendar of the Daily notes page (record 0099).
 *
 * A date grid in the WAI-ARIA pattern: a table with the grid role, one button
 * for each day, and one day in the tab order at a time. The arrow keys, Home,
 * End, Page Up and Page Down move that day, and Enter or a press opens its
 * note. `lib/calendar-month.ts` decides every move and every word, and the
 * one recipe of a day is `calendarDayClassName` (record 0065).
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { sameCalendarDate, type CalendarDate } from '@notesapp/core';
import {
  Button,
  calendarDayClassName,
  calendarNoteMarkClassName,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@notesapp/ui';
import {
  addMonths,
  dateAfterKey,
  dayName,
  firstDayOfLocale,
  isCalendarKey,
  monthOf,
  monthTitle,
  monthWeeks,
  weekdayNames,
  weekdayOrder,
  type CalendarMonth,
} from '../../lib/calendar-month.ts';

/** The key of one day, for a list and for the button to focus. */
function dayKey(date: CalendarDate): string {
  return `${String(date.year)}-${String(date.month)}-${String(date.day)}`;
}

/** One month of days, and the way to open the note of one of them. */
export function Calendar({
  today,
  daysWithNotes,
  onOpen,
}: {
  readonly today: CalendarDate;
  /** The days of one month that hold a daily note. */
  readonly daysWithNotes: (month: CalendarMonth) => ReadonlySet<number>;
  readonly onOpen: (date: CalendarDate) => void;
}): ReactNode {
  const titleId = useId();
  const firstDay = useMemo(() => firstDayOfLocale(undefined), []);
  const [selected, setSelected] = useState<CalendarDate>(today);
  const month = monthOf(selected);
  const { year, month: monthNumber } = month;
  const weeks = useMemo(
    () => monthWeeks({ year, month: monthNumber }, firstDay),
    [year, monthNumber, firstDay],
  );
  const marked = daysWithNotes(month);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // A key moves the selection and the focus with it. A change of the month
  // with its buttons leaves the focus where the person put it.
  const moveFocus = useRef(false);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    buttons.current.get(dayKey(selected))?.focus();
  }, [selected]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <h2
          className="m-0 min-w-0 flex-1 text-base font-semibold text-strong"
          id={titleId}
          aria-live="polite"
        >
          {monthTitle(month)}
        </h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setSelected(today)}
        >
          Today
        </Button>
        <Button
          variant="ghost"
          size="sm"
          label="Previous month"
          icon={<ChevronLeftIcon />}
          onClick={() => setSelected((date) => addMonths(date, -1))}
        />
        <Button
          variant="ghost"
          size="sm"
          label="Next month"
          icon={<ChevronRightIcon />}
          onClick={() => setSelected((date) => addMonths(date, 1))}
        />
      </div>
      <table
        role="grid"
        aria-labelledby={titleId}
        className="w-full table-fixed border-collapse"
      >
        <thead>
          <tr>
            {weekdayOrder(firstDay).map((weekday) => {
              const names = weekdayNames(weekday);
              return (
                <th
                  key={weekday}
                  scope="col"
                  abbr={names.long}
                  className="pb-1 text-center text-control font-medium text-muted"
                >
                  {names.short}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={dayKey(week[0]?.date ?? selected)}>
              {week.map((cell) => {
                const isSelected = sameCalendarDate(cell.date, selected);
                const isToday = sameCalendarDate(cell.date, today);
                const hasNote = cell.inMonth && marked.has(cell.date.day);
                const name = dayName(cell.date);
                return (
                  <td
                    key={dayKey(cell.date)}
                    className="p-0.5 text-center"
                    aria-selected={isSelected}
                  >
                    <button
                      ref={(node) => {
                        const key = dayKey(cell.date);
                        if (node === null) buttons.current.delete(key);
                        else buttons.current.set(key, node);
                      }}
                      type="button"
                      className={calendarDayClassName({
                        selected: isSelected,
                        today: isToday,
                        inMonth: cell.inMonth,
                      })}
                      tabIndex={isSelected ? 0 : -1}
                      aria-label={hasNote ? `${name}, has a note` : name}
                      aria-current={isToday ? 'date' : undefined}
                      onClick={() => {
                        setSelected(cell.date);
                        onOpen(cell.date);
                      }}
                      onKeyDown={(event) => {
                        const key = event.key;
                        if (!isCalendarKey(key)) return;
                        event.preventDefault();
                        moveFocus.current = true;
                        const shift = event.shiftKey;
                        setSelected((date) =>
                          dateAfterKey(date, key, firstDay, shift),
                        );
                      }}
                    >
                      {cell.date.day}
                      {hasNote ? (
                        <span
                          className={calendarNoteMarkClassName()}
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
