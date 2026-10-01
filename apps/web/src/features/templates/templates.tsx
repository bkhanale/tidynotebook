/**
 * The template settings of the open workspace (record 0149).
 *
 * One provider in the frame holds the template folder of the member, so the
 * command palette and the Settings page read one value. The settings come
 * from the server, and this device keeps the last answer through the one
 * hook of member settings, so the palette lists the templates with no
 * connection too. The rules live in `lib/templates.ts` and `@notesapp/core`.
 */
import { createContext, useContext, type ReactNode } from 'react';
import {
  getTemplateSettings,
  updateTemplateSettings,
} from '@notesapp/api-client';
import type { TemplateSettings } from '@notesapp/core';
import { problemMessage, useSession } from '../../app.tsx';
import {
  useMemberSettings,
  type MemberSettings,
} from '../../shell/member-settings.ts';
import {
  settingsAnswer,
  type MemberSettingsSource,
} from '../../lib/member-settings.ts';
import {
  formatCachedTemplateSettings,
  parseCachedTemplateSettings,
  templateProblems,
  templateSettingsName,
  templateSettingsProblem,
} from '../../lib/templates.ts';

/** The settings that one answer of the server states. */
function settingsOfAnswer(answer: TemplateSettings): TemplateSettings {
  return { folder: answer.folder };
}

/** How the template settings read, write and cache themselves. */
const templateSettingsSource: MemberSettingsSource<TemplateSettings> = {
  name: templateSettingsName,
  read: async (workspaceId) =>
    settingsAnswer(
      await getTemplateSettings({ path: { workspaceId } }),
      settingsOfAnswer,
    ),
  write: async (workspaceId, settings) =>
    settingsAnswer(
      await updateTemplateSettings({
        path: { workspaceId },
        body: settingsOfAnswer(settings),
      }),
      settingsOfAnswer,
    ),
  encode: formatCachedTemplateSettings,
  decode: parseCachedTemplateSettings,
  refusal: (status, error) =>
    templateSettingsProblem(status, problemMessage(error)),
  unsent: templateProblems.unsent,
};

const TemplatesContext = createContext<MemberSettings<TemplateSettings>>({
  settings: { status: 'loading' },
  save: () => {},
  saveProblem: null,
});

/** Reads the template settings of the open workspace. */
export function useTemplates(): MemberSettings<TemplateSettings> {
  return useContext(TemplatesContext);
}

/** Holds the template settings of the open workspace for the frame. */
export function TemplatesProvider({
  workspaceId,
  children,
}: {
  readonly workspaceId: string;
  readonly children: ReactNode;
}): ReactNode {
  const session = useSession();
  const value = useMemberSettings(
    templateSettingsSource,
    session.account?.accountId ?? null,
    workspaceId,
  );
  return (
    <TemplatesContext.Provider value={value}>
      {children}
    </TemplatesContext.Provider>
  );
}
