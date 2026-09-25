/**
 * The daily note settings of the member, as fields of the Settings page
 * (records 0099, 0100 and 0101).
 *
 * The Settings page holds every setting of the product. These belong to the
 * member in the open workspace, and the provider of `daily-notes.tsx` reads
 * and stores them, so the sidebar and this section read one value.
 *
 * The template and the start choice apply when a person picks them. The
 * folder and the name format are text, so they apply when the person leaves
 * the fields, presses Enter, or leaves the page: a half typed format would
 * move the daily notes of the calendar at every keystroke. The preview under
 * them names the note of today as the typed layout writes it, and
 * `layoutToStore` decides what is stored.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  cleanDailyNoteFolder,
  dailyNoteLayoutProblem,
  type DailyNoteSettings,
} from '@notesapp/core';
import {
  Checkbox,
  LoadingState,
  Notice,
  SelectField,
  TextField,
} from '@notesapp/ui';
import { useFiles } from '../../shell/files.tsx';
import {
  dailyNotePreview,
  effectiveTemplateId,
  layoutProblemSentences,
  layoutToStore,
  noTemplateValue,
  templateChoices,
  templateOfChoice,
} from '../../lib/daily-note.ts';
import { today, useDailyNotes } from './daily-notes.tsx';

/** The folder and the name format, stored when the person leaves them. */
function LayoutFields({
  settings,
  onSave,
}: {
  readonly settings: DailyNoteSettings;
  readonly onSave: (next: DailyNoteSettings) => void;
}): ReactNode {
  const [folder, setFolder] = useState(settings.folder);
  const [format, setFormat] = useState(settings.format);
  // A stored layout that changes, from this section or from another device,
  // is what the fields show next.
  useEffect(() => {
    setFolder(settings.folder);
    setFormat(settings.format);
  }, [settings.folder, settings.format]);

  const layout = { folder: cleanDailyNoteFolder(folder), format };
  const problem = dailyNoteLayoutProblem(layout);
  const sentence =
    problem === null ? undefined : layoutProblemSentences[problem];

  /** Stores the typed layout when it is whole and new. */
  const store = useRef((): void => {});
  store.current = (): void => {
    const next = layoutToStore({ folder, format }, settings);
    if (next !== null) onSave({ ...settings, ...next });
  };
  // A person who leaves the page from a field keeps what they typed. The
  // provider of the settings outlives this page, so the change still goes.
  useEffect(
    () => () => {
      store.current();
    },
    [],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    store.current();
  };

  return (
    <div
      className="mt-4"
      onBlur={() => {
        store.current();
      }}
      onKeyDown={onKeyDown}
    >
      <TextField
        id="daily-folder"
        label="Folder"
        value={folder}
        onChange={setFolder}
        hint="Leave it empty to keep daily notes at the top of the workspace."
        error={problem === 'folder' ? sentence : undefined}
      />
      <TextField
        id="daily-format"
        label="Name format"
        value={format}
        onChange={setFormat}
        hint="Use date tokens such as YYYY, MM, DD and dddd. A slash makes a folder. Put other text in square brackets."
        error={problem !== null && problem !== 'folder' ? sentence : undefined}
      />
      <p className="mb-3 mt-0 text-control text-muted" aria-live="polite">
        {problem === null
          ? `Today's note: ${dailyNotePreview(today(), layout)}`
          : ''}
      </p>
    </div>
  );
}

/** The template field, the start choice, the folder and the name format. */
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
        hint="A new daily note starts with a copy of the text of this note. Write {{date}}, {{date:dddd}} or {{title}} in the template to fill in the date or the name."
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
      <LayoutFields settings={settings} onSave={daily.save} />
      {daily.saveProblem === null ? null : (
        <Notice className="mt-3" tone="problem" message={daily.saveProblem} />
      )}
    </>
  );
}
