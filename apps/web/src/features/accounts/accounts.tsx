/**
 * Account screens: first-run setup, login, and settings.
 *
 * The sign in screen and the setup screen are the two screens that carry the
 * wordmark, which is a monochrome mark and the product name (decisions 0062
 * and 0064). Both are one centred column on the chrome plane with one raised
 * panel, so a first run meets a neutral surface and the one filled control on
 * it is the one action.
 *
 * Settings is the one place for the profile, the palette, offline
 * availability, and sign-out. It is a page of the workspace frame (record
 * 0091), so the breadcrumb and the sidebar are the way back, and the
 * sections that act on one workspace act on the workspace of the address.
 * It reads as sections and not as a stack of cards: each section states its
 * name and its sentence in a column of its own and holds its controls beside
 * them, and a hairline separates one from the next. Theme changes apply
 * locally first and sync in the background through the provider in
 * `app.tsx`.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import {
  createOwner,
  getSetupStatus,
  signInWithPassword,
} from '@notesapp/api-client';
import type { LocalStore } from '@notesapp/sync';
import {
  type AppearanceChoice,
  AppMarkIcon,
  Button,
  Card,
  Checkbox,
  CheckIcon,
  ComputerIcon,
  DownloadIcon,
  LoadingState,
  MoonIcon,
  Notice,
  Page,
  pageGutter,
  PageHeader,
  SignOutIcon,
  SunIcon,
  TextField,
  themeFamilies,
  themeOfFamily,
  transitionSurface,
  UploadIcon,
} from '@notesapp/ui';
import {
  problemMessage,
  useLocalStore,
  useSession,
  useTheme,
  useRequestSync,
} from '../../app.tsx';
import { problemCode, problemStatus } from '../../lib/problem-text.ts';
import { passwordProblem, passwordRule } from '../../lib/password-policy.ts';
import {
  signOut as endSession,
  revokeSessionViaClient,
} from '../../pwa/lifecycle.ts';
import { downloadAll, importAll } from '../export/export.ts';
import { useDocumentTitle } from '../../shell/document-title.ts';

/** The title of the settings page, which is also its breadcrumb part. */
export const settingsTitle = 'Settings';

/** Redirects to login when no session exists. */
export function RequireSession({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const session = useSession();
  if (session.status === 'loading') {
    return (
      <Page>
        <LoadingState label="Your account is loading." />
      </Page>
    );
  }
  if (session.status === 'signed-out' || session.account === null) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

/** How far the setup status call got. */
type SetupStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unreachable'; readonly message: string }
  /** True when the owner account of this installation already exists. */
  | { readonly kind: 'ready'; readonly initialized: boolean };

/**
 * First-run setup and email and password sign in.
 *
 * One screen serves both, and it says which one it is: setup states that it
 * creates the single owner account of the installation and asks for the
 * password twice, sign in asks for it once. The password rule is under the
 * field from the start, so nobody learns it from a refusal. A status call
 * that does not answer offers Retry instead of a dead submit button.
 */
export function LoginPage(): ReactNode {
  const session = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SetupStatus>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });
    void getSetupStatus().then((result) => {
      if (cancelled) return;
      if (result.error !== undefined || result.data === undefined) {
        setStatus({
          kind: 'unreachable',
          message: problemMessage(result.error),
        });
        return;
      }
      setStatus({ kind: 'ready', initialized: result.data.initialized });
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const setup = status.kind === 'ready' && !status.initialized;

  async function submitPassword(): Promise<void> {
    setFieldError('');
    const problem = setup ? passwordProblem(password) : null;
    if (problem !== null) {
      setFieldError(problem);
      return;
    }
    if (setup && confirmation !== password) {
      setFieldError('The two passwords are not the same.');
      return;
    }
    setBusy(true);
    setError('');
    const result = setup
      ? await createOwner({ body: { email, password } })
      : await signInWithPassword({ body: { email, password } });
    setBusy(false);
    if (result.error !== undefined || result.data === undefined) {
      const code = problemCode(result.error);
      const httpStatus = result.response?.status ?? problemStatus(result.error);
      if (
        httpStatus === 400 ||
        httpStatus === 401 ||
        code === 'unauthenticated' ||
        code === 'invalid_request'
      ) {
        setError(
          setup
            ? 'The account could not be created. Check the address and the password.'
            : 'That address and password do not match an account.',
        );
        return;
      }
      setError(problemMessage(result.error));
      return;
    }
    session.refresh();
    void navigate('/');
  }

  if (session.status === 'signed-in') return <Navigate to="/" replace />;

  const title = setup ? 'Create your account' : 'Sign in';
  return (
    <div
      className={`flex min-h-dvh flex-col items-center justify-center bg-surface ${pageGutter} py-10`}
    >
      <div className="mb-5 flex items-center gap-2.5 text-ui font-semibold text-strong">
        <span
          className="inline-flex size-7 items-center justify-center rounded-md bg-active text-strong"
          aria-hidden="true"
        >
          <AppMarkIcon />
        </span>
        <span>Notesapp</span>
      </div>
      <Card className="w-full max-w-sm sm:p-6">
        <h1 className="mb-2 mt-0 text-xl font-semibold tracking-heading text-strong">
          {status.kind === 'loading' ? 'Notesapp' : title}
        </h1>
        {status.kind === 'loading' ? (
          <LoadingState label="The sign-in screen is loading." />
        ) : status.kind === 'unreachable' ? (
          <div className="mt-4 space-y-3">
            <Notice tone="problem" message={status.message} />
            <Button
              onClick={() => {
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <>
            <p className="mb-5 mt-0 text-control text-muted">
              {setup
                ? 'This installation has no account yet. What you enter here becomes the one owner account, and it owns every note.'
                : 'Enter the address and the password of your account.'}
            </p>
            <form
              onSubmit={(event): void => {
                event.preventDefault();
                void submitPassword();
              }}
            >
              <TextField
                id="login-email"
                label="Email address"
                value={email}
                inputType="email"
                autoComplete={setup ? 'email' : 'username'}
                required
                autoFocus
                onChange={setEmail}
              />
              <TextField
                id="login-password"
                label="Password"
                value={password}
                inputType={reveal ? 'text' : 'password'}
                autoComplete={setup ? 'new-password' : 'current-password'}
                hint={setup ? passwordRule : undefined}
                required
                error={fieldError}
                onChange={setPassword}
              />
              {setup ? (
                <TextField
                  id="login-password-again"
                  label="Password again"
                  value={confirmation}
                  inputType={reveal ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  onChange={setConfirmation}
                />
              ) : null}
              <div className="mb-4">
                <Checkbox
                  id="login-reveal"
                  label="Show the password"
                  checked={reveal}
                  onChange={setReveal}
                />
              </div>
              {error === '' ? null : (
                <Notice className="mb-4" tone="problem" message={error} />
              )}
              <Button type="submit" disabled={busy} className="w-full">
                {busy
                  ? setup
                    ? 'Creating your account'
                    : 'Signing in'
                  : setup
                    ? 'Create account'
                    : 'Sign in'}
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}

/** The three appearance choices, with the icon that names each of them. */
const appearanceChoices: readonly {
  readonly value: AppearanceChoice;
  readonly label: string;
  readonly icon: ReactNode;
}[] = [
  { value: 'system', label: 'System', icon: <ComputerIcon /> },
  { value: 'light', label: 'Light', icon: <SunIcon /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
];

/**
 * The four colours that show what one family looks like.
 *
 * The swatch is the page background, the sidebar surface, the accent fill,
 * and the body text of the variant that the current appearance selects, so
 * the preview is exactly what the screen becomes on selection.
 */
function FamilySwatch({ familyId }: { readonly familyId: string }): ReactNode {
  const theme = useTheme();
  const family = themeFamilies.find((entry) => entry.id === familyId);
  if (family === undefined) return null;
  const tokens = themeOfFamily(family, theme.resolved).tokens;
  const colours = [
    tokens.background,
    tokens.surface,
    tokens.accentFill,
    tokens.text,
  ];
  return (
    <span
      aria-hidden="true"
      className="inline-flex overflow-hidden rounded-sm border border-edge-line"
    >
      {colours.map((colour) => (
        <span
          className="block h-4 w-3"
          key={colour}
          style={{ backgroundColor: colour }}
        />
      ))}
    </span>
  );
}

/**
 * One section of the settings screen.
 *
 * A section is not a card. From the medium width it is two columns: the name
 * of the section and its sentence on the left, the controls on the right, so
 * a person scans the names of every section in one pass. A hairline separates
 * one section from the next, which is the one place a rule is drawn here,
 * because a person counts the sections of a list they scroll (decision 0063).
 */
function SettingsSection({
  title,
  titleId,
  description,
  children,
}: {
  readonly title: string;
  readonly titleId: string;
  readonly description?: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section
      className="border-t border-edge-subtle py-6"
      aria-labelledby={titleId}
    >
      <div className="md:grid md:grid-cols-3 md:gap-group">
        <div className="md:col-span-1">
          <h2 className="m-0 text-ui font-semibold text-strong" id={titleId}>
            {title}
          </h2>
          {description === undefined ? null : (
            <p className="mb-0 mt-1 text-control text-muted">{description}</p>
          )}
        </div>
        <div className="mt-3 min-w-0 md:col-span-2 md:mt-0">{children}</div>
      </div>
    </section>
  );
}

/**
 * Appearance settings: local first, synced without delaying the change.
 *
 * The appearance choices are a segmented control: one radio group in one
 * track, so the whole set is visible, the arrow keys move through it and the
 * choice in force is the raised segment. The theme families are radio buttons
 * as well, one chip each, and the chosen chip takes the strong edge and a
 * ring of the same colour and never the accent fill (decision 0062). A
 * selection applies at once, which is why the swatch of every family shows
 * the variant of the appearance in force.
 *
 * Both groups carry their focus treatment with `focus-within`, because the
 * radio a person reaches is visually hidden and the label around it is what
 * they see. `focus-visible` on the label would never match.
 */
export function ThemeSettings(): ReactNode {
  const theme = useTheme();
  return (
    <SettingsSection
      title="Appearance"
      titleId="theme-heading"
      description="System follows the device. The choice applies at once on this device and goes to your account in the background."
    >
      <fieldset className="m-0 border-0 p-0">
        <legend className="sr-only">Appearance</legend>
        <div className="inline-flex rounded-md border border-edge-subtle bg-surface p-0.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
          {appearanceChoices.map((choice) => {
            const chosen = theme.choice === choice.value;
            return (
              <label
                className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-sm px-2.5 text-control ${transitionSurface} md:min-h-7 ${
                  chosen
                    ? 'bg-card font-medium text-strong shadow-raised'
                    : 'text-muted hover:text-strong'
                }`}
                key={choice.value}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="theme-choice"
                  value={choice.value}
                  checked={chosen}
                  onChange={(): void => {
                    theme.setChoice(choice.value);
                  }}
                />
                <span className="inline-flex items-center" aria-hidden="true">
                  {choice.icon}
                </span>
                <span>{choice.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="m-0 mt-4 border-0 p-0">
        <legend className="mb-2 p-0 text-control font-medium text-strong">
          Theme
        </legend>
        <div className="flex flex-wrap gap-cluster">
          {themeFamilies.map((family) => {
            const chosen = theme.familyId === family.id;
            return (
              <label
                className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border bg-card px-2.5 text-control text-strong ${transitionSurface} focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus md:min-h-8 ${
                  chosen
                    ? 'border-strong ring-1 ring-strong'
                    : 'border-edge-line hover:bg-hover'
                }`}
                key={family.id}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="theme-family"
                  value={family.id}
                  checked={chosen}
                  onChange={(): void => {
                    theme.setFamily(family.id);
                  }}
                />
                <FamilySwatch familyId={family.id} />
                <span>{family.name}</span>
                {chosen ? (
                  <span className="inline-flex items-center" aria-hidden="true">
                    <CheckIcon />
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      </fieldset>
      {theme.syncError === null ? null : (
        <Notice className="mt-4" tone="problem" message={theme.syncError} />
      )}
    </SettingsSection>
  );
}

/** What is kept on this device for use without a connection. */
type OfflineChoices = {
  readonly images: boolean;
  readonly history: boolean;
};

/**
 * What this device can say about the saves that never reached the server.
 *
 * A read that did not answer is not a count of zero (record 0038). The card
 * says that it cannot tell, and it offers the action that keeps the work.
 */
type PendingSaves =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly count: number };

/** Whether this device could state what it keeps for offline use. */
type OfflineStatus = 'loading' | 'ready' | 'failed';

/**
 * Reads and writes what this device keeps for offline use.
 *
 * Notes are always kept. Images and older versions are larger, so each one
 * is a choice. A choice is on when every known item of that kind is already
 * kept, which is what the store records.
 *
 * A read that fails is not a pair of choices that are off (record 0038). The
 * status says that the read failed, so the card can name the failure instead
 * of showing two boxes that state something false about this device.
 */
function useOfflineChoices(
  store: LocalStore | null,
  accountId: string | null,
  workspaceId: string | null,
): {
  readonly choices: OfflineChoices;
  readonly status: OfflineStatus;
  readonly setChoice: (kind: keyof OfflineChoices, keep: boolean) => void;
} {
  const [choices, setChoices] = useState<OfflineChoices>({
    images: false,
    history: false,
  });
  const [status, setStatus] = useState<OfflineStatus>('loading');
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (store === null || accountId === null || workspaceId === null) {
      setStatus('loading');
      return;
    }
    const activeStore = store;
    let cancelled = false;
    async function read(): Promise<void> {
      try {
        const files = await activeStore.listAcceptedFiles(
          accountId ?? '',
          workspaceId ?? '',
        );
        const images = files.filter(
          (file) => file.kind === 'attachment' && !file.deleted,
        );
        const versions = files.filter((file) => !file.deleted);
        let allImages = images.length > 0;
        for (const file of images) {
          if (file.acceptedHeadDigest === null) continue;
          if (
            !(await activeStore.isAttachmentPinned(
              accountId ?? '',
              workspaceId ?? '',
              file.acceptedHeadDigest,
            ))
          ) {
            allImages = false;
            break;
          }
        }
        let allHistory = versions.length > 0;
        for (const file of versions) {
          if (file.acceptedHeadRevisionId === null) continue;
          if (
            !(await activeStore.isHistoryPinned(
              accountId ?? '',
              workspaceId ?? '',
              file.acceptedHeadRevisionId,
            ))
          ) {
            allHistory = false;
            break;
          }
        }
        if (cancelled) return;
        setChoices({ images: allImages, history: allHistory });
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('failed');
      }
    }
    void read();
    return () => {
      cancelled = true;
    };
  }, [store, accountId, workspaceId, generation]);

  const setChoice = useCallback(
    (kind: keyof OfflineChoices, keep: boolean): void => {
      if (store === null || accountId === null || workspaceId === null) return;
      const activeStore = store;
      const activeAccount = accountId;
      const activeWorkspace = workspaceId;
      setChoices((current) => ({ ...current, [kind]: keep }));
      void (async (): Promise<void> => {
        const files = await activeStore.listAcceptedFiles(
          activeAccount,
          activeWorkspace,
        );
        for (const file of files) {
          if (kind === 'images') {
            if (file.kind !== 'attachment' || file.acceptedHeadDigest === null)
              continue;
            await activeStore.setAttachmentPinned(
              activeAccount,
              activeWorkspace,
              file.acceptedHeadDigest,
              keep,
            );
          } else {
            if (file.acceptedHeadRevisionId === null) continue;
            await activeStore.setHistoryPinned(
              activeAccount,
              activeWorkspace,
              file.acceptedHeadRevisionId,
              keep,
            );
          }
        }
        setGeneration((value) => value + 1);
      })();
    },
    [store, accountId, workspaceId],
  );

  return { choices, status, setChoice };
}

/** Account page: profile, theme, offline availability, and sign-out. */
export function AccountSettingsPage(): ReactNode {
  const session = useSession();
  const store = useLocalStore();
  const params = useParams();
  const [pending, setPending] = useState<PendingSaves>({ kind: 'loading' });
  const [signOutError, setSignOutError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState('');
  const importInput = useRef<HTMLInputElement | null>(null);
  const requestSync = useRequestSync();
  const account = session.account;
  const accountId = account?.accountId ?? null;
  // The address names the workspace, as it does for every page of the frame.
  // The frame only renders this once the account holds that workspace.
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const offline = useOfflineChoices(store.store, accountId, workspaceId);
  useDocumentTitle(settingsTitle);

  useEffect(() => {
    if (store.store === null || accountId === null || workspaceId === null) {
      setPending({ kind: 'loading' });
      return;
    }
    const activeStore = store.store;
    let cancelled = false;
    void activeStore
      .pending(accountId, workspaceId)
      .then((queue) => {
        if (!cancelled) setPending({ kind: 'ready', count: queue.length });
      })
      .catch(() => {
        if (!cancelled) setPending({ kind: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [store.store, accountId, workspaceId]);

  if (account === null) return <Navigate to="/login" replace />;
  // Only a count that arrived can offer the action that removes work. An
  // unknown count keeps the safe action alone (record 0038).
  const unsent = pending.kind === 'ready' && pending.count > 0;

  /**
   * Ends the session on this device.
   *
   * `discard` removes the work that never reached the server. Without it the
   * queued work stays on this device and waits for the next sign-in. Offline
   * sign-out records a marker, so the session is revoked on reconnect before
   * any content comes back.
   */
  function endSignOut(discard: boolean): void {
    setSignOutError('');
    const activeStore = store.store;
    if (!discard || activeStore === null || workspaceId === null) {
      session.signOut();
      return;
    }
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    void endSession(
      activeStore,
      account?.accountId ?? '',
      [workspaceId],
      online,
      true,
      revokeSessionViaClient,
    )
      .then(() => {
        session.refresh();
      })
      .catch((failure: unknown) => {
        setSignOutError(problemMessage(failure));
      });
  }

  return (
    <Page>
      <PageHeader title={settingsTitle} />
      <div>
        <ThemeSettings />

        <SettingsSection
          title="Available offline"
          titleId="offline-heading"
          description="Your notes are always kept on this device. Images and older versions take more space, so you choose whether to keep them too."
        >
          {offline.status === 'failed' ? (
            <Notice
              tone="problem"
              message="This device cannot say what it keeps offline. Open Settings again to read it."
            />
          ) : offline.status === 'loading' ? (
            // A choice that nothing has read yet is not a choice that is off
            // (record 0038), and the `Checkbox` primitive states no waiting
            // state, so the section shows the shape of the two rows instead.
            <LoadingState
              shape="list"
              rows={2}
              label="What this device keeps offline is loading."
            />
          ) : (
            <div className="flex flex-col">
              <Checkbox
                id="offline-images"
                label="Keep images on this device"
                checked={offline.choices.images}
                onChange={(keep) => {
                  offline.setChoice('images', keep);
                }}
              />
              <Checkbox
                id="offline-history"
                label="Keep older versions on this device"
                checked={offline.choices.history}
                onChange={(keep) => {
                  offline.setChoice('history', keep);
                }}
              />
            </div>
          )}
        </SettingsSection>

        <SettingsSection
          title="Export"
          titleId="export-heading"
          description="Download every note and image as a zip. The files keep their folders and need no application to be read again."
        >
          {exportError === '' ? null : (
            <Notice className="mb-3" tone="problem" message={exportError} />
          )}
          <Button
            variant="secondary"
            icon={<DownloadIcon />}
            disabled={exporting || workspaceId === null}
            onClick={() => {
              if (workspaceId === null) return;
              setExportError('');
              setExporting(true);
              void downloadAll(workspaceId)
                .catch((failure: unknown) => {
                  setExportError(problemMessage(failure));
                })
                .finally(() => {
                  setExporting(false);
                });
            }}
          >
            {exporting ? 'Preparing the download' : 'Export all notes'}
          </Button>
        </SettingsSection>

        <SettingsSection
          title="Import"
          titleId="import-heading"
          description="Import a zip of Markdown files and images. The files keep their paths and links."
        >
          {importNotice === '' ? null : (
            <Notice className="mb-3" tone="info" message={importNotice} />
          )}
          <input
            ref={importInput}
            className="sr-only"
            type="file"
            accept=".zip,application/zip"
            aria-label="Choose a workspace zip archive"
            onChange={(event): void => {
              const file = event.target.files?.[0];
              if (file === undefined || workspaceId === null) return;
              setImporting(true);
              setImportNotice('');
              void importAll(workspaceId, file)
                .then((result) => {
                  setImportNotice(
                    `Imported ${String(result.notes)} ${result.notes === 1 ? 'note' : 'notes'} and ${String(result.attachments)} ${result.attachments === 1 ? 'image' : 'images'}.`,
                  );
                  requestSync();
                })
                .catch((failure: unknown) => {
                  setImportNotice(problemMessage(failure));
                })
                .finally(() => {
                  setImporting(false);
                  event.target.value = '';
                });
            }}
          />
          <Button
            variant="secondary"
            icon={<UploadIcon />}
            disabled={importing || workspaceId === null}
            onClick={() => importInput.current?.click()}
          >
            {importing ? 'Importing files' : 'Import workspace'}
          </Button>
        </SettingsSection>

        <SettingsSection
          title="Account"
          titleId="profile-heading"
          description="This installation has one account, and it owns every note."
        >
          <p className="m-0 text-ui text-strong">
            {account.email ?? 'No address linked'}
          </p>
        </SettingsSection>

        <SettingsSection
          title="Sign out"
          titleId="signout-heading"
          description={
            pending.kind === 'loading'
              ? undefined
              : unsent
                ? 'Some saves have not reached the server yet. Keep them on this device for the next sign-in, or remove them now.'
                : pending.kind === 'failed'
                  ? 'This device cannot say what is still waiting to reach the server. Sign out keeps your work on this device.'
                  : 'Every save on this device reached the server.'
          }
        >
          {signOutError === '' ? null : (
            <Notice className="mb-3" tone="problem" message={signOutError} />
          )}
          <div className="flex flex-wrap gap-cluster">
            <Button
              variant="secondary"
              icon={<SignOutIcon />}
              onClick={() => {
                endSignOut(false);
              }}
            >
              {unsent ? 'Sign out and keep them' : 'Sign out on this device'}
            </Button>
            {unsent ? (
              <Button
                variant="danger"
                onClick={() => {
                  endSignOut(true);
                }}
              >
                Sign out and remove them
              </Button>
            ) : null}
          </div>
        </SettingsSection>
      </div>
    </Page>
  );
}
