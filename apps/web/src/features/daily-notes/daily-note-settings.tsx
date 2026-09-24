/**
 * The daily note settings of the member, as fields of the Settings page
 * (records 0099 and 0100).
 *
 * The Settings page holds every setting of the product. These two belong to
 * the member in the open workspace, and the provider of `daily-notes.tsx`
 * reads and stores them, so the sidebar and this section read one value.
 */
import { useMemo, type ReactNode } from 'react';
import { Checkbox, LoadingState, Notice, SelectField } from '@notesapp/ui';
import { useFiles } from '../../shell/files.tsx';
import {
  effectiveTemplateId,
  noTemplateValue,
  templateChoices,
  templateOfChoice,
} from '../../lib/daily-note.ts';
import { useDailyNotes } from './daily-notes.tsx';

/** The template field and the start choice. */
export function DailyNoteSettingsFields(): ReactNode {
  const files = useFiles();
  const daily = useDailyNotes();
  const choices = useMemo(() => templateChoices(files.notes), [files.notes]);
  const state = daily.settings;

  if (state.status === 'loading')
    return (
      <LoadingState
        shape="list"
        rows={2}
        label="The daily note settings are loading."
      />
    );
  if (state.status === 'unavailable')
    return (
      <Notice
        tone="info"
        message="The daily note settings did not load. Connect to the internet to change them."
      />
    );
  const settings = state.settings;
  return (
    <>
      <SelectField
        id="daily-template"
        label="Template"
        value={effectiveTemplateId(settings, files.notes) ?? noTemplateValue}
        options={choices}
        hint="A new daily note starts with a copy of the text of this note."
        onChange={(value) => {
          daily.save({ ...settings, templateFileId: templateOfChoice(value) });
        }}
      />
      <Checkbox
        id="daily-open-on-start"
        label="Open today's note when the app opens"
        checked={settings.openOnStart}
        onChange={(checked) => {
          daily.save({ ...settings, openOnStart: checked });
        }}
      />
      {daily.saveProblem === null ? null : (
        <Notice className="mt-3" tone="problem" message={daily.saveProblem} />
      )}
    </>
  );
}
