/**
 * The Daily notes page: a calendar and the two settings (record 0099).
 *
 * The one action of the page is Open today's note (record 0062). A day of the
 * calendar opens its note as well, and the page marks every day of the month
 * that holds one. The template and the start choice sit below the calendar,
 * because they belong to this workspace and to nothing else.
 */
import { useCallback, useMemo, type ReactNode } from 'react';
import {
  Button,
  CalendarDayIcon,
  Card,
  Checkbox,
  LoadingState,
  Notice,
  Page,
  PageHeader,
  SelectField,
} from '@notesapp/ui';
import { useDocumentTitle } from '../../shell/document-title.ts';
import { useFiles } from '../../shell/files.tsx';
import type { CalendarMonth } from '../../lib/calendar-month.ts';
import {
  dailyNotesTitle,
  daysWithNotes,
  effectiveTemplateId,
  noTemplateValue,
  templateChoices,
  templateOfChoice,
} from '../../lib/daily-note.ts';
import { Calendar } from './calendar.tsx';
import { today, useDailyNotes } from './daily-notes.tsx';

/** The calendar of the daily notes of the open workspace. */
export function DailyNotesPage(): ReactNode {
  useDocumentTitle(dailyNotesTitle);
  const files = useFiles();
  const daily = useDailyNotes();
  const now = today();
  const marked = useCallback(
    (month: CalendarMonth) => daysWithNotes(files.notes, month),
    [files.notes],
  );
  const choices = useMemo(() => templateChoices(files.notes), [files.notes]);

  return (
    <Page>
      <PageHeader
        title={dailyNotesTitle}
        description="Each day has one note. Select a day to open its note."
        actions={
          <Button
            icon={<CalendarDayIcon />}
            disabled={daily.waiting}
            onClick={() => daily.open(now)}
          >
            Open today's note
          </Button>
        }
      />
      {daily.openProblem === null ? null : (
        <Notice className="mb-4" tone="problem" message={daily.openProblem} />
      )}
      <Card className="mb-6">
        <Calendar today={now} daysWithNotes={marked} onOpen={daily.open} />
      </Card>
      <section aria-labelledby="daily-settings-title">
        <h2
          className="mb-3 mt-0 text-base font-semibold text-strong"
          id="daily-settings-title"
        >
          Settings
        </h2>
        {daily.settings.status === 'loading' ? (
          <LoadingState
            shape="list"
            rows={2}
            label="The settings are loading."
          />
        ) : daily.settings.status === 'unavailable' ? (
          <Notice
            tone="info"
            message="The settings did not load. Connect to the internet to change them."
          />
        ) : (
          <>
            <SelectField
              id="daily-template"
              label="Template"
              value={
                effectiveTemplateId(daily.settings.settings, files.notes) ??
                noTemplateValue
              }
              options={choices}
              hint="A new daily note starts with a copy of the text of this note."
              onChange={(value) => {
                if (daily.settings.status !== 'ready') return;
                daily.save({
                  ...daily.settings.settings,
                  templateFileId: templateOfChoice(value),
                });
              }}
            />
            <Checkbox
              id="daily-open-on-start"
              label="Open today's note when the app opens"
              checked={daily.settings.settings.openOnStart}
              onChange={(checked) => {
                if (daily.settings.status !== 'ready') return;
                daily.save({
                  ...daily.settings.settings,
                  openOnStart: checked,
                });
              }}
            />
            {daily.saveProblem === null ? null : (
              <Notice
                className="mt-3"
                tone="problem"
                message={daily.saveProblem}
              />
            )}
          </>
        )}
      </section>
    </Page>
  );
}
