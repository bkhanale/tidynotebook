/**
 * Conflict branches and explicit resolution.
 *
 * This screen lists unresolved branches grouped by their conflict group,
 * shows every file of a group in one pane with one unified inline diff per
 * file, and resolves the whole group atomically. A resolution merges the
 * current head with the branch tip by hunk choice or by editing, names an
 * explicit final path for collisions, and submits both tips as parents with
 * the current expected heads. Attachments resolve by whole-version selection
 * with a preview of each side, never by text merging.
 *
 * When the head moves during resolution, the edited result is retained and
 * offered back while the file loads the new head. There is no automatic
 * last-write-wins rule and no silent merge here.
 *
 * Pending local work that the sync engine marked as conflicting is listed
 * with a retry for the branch upload. The engine uploads branches itself, so
 * the retry only repeats an upload that never landed.
 *
 * Every server action uses a generated operation. There is no handwritten
 * request, URL, or response shape here.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  getFile,
  getRevision,
  listBranches,
  resolveBranches,
  submitBranch,
  type BranchItem,
  type BranchResolutionInput,
  type RevisionInput,
} from '@notesapp/api-client';
import { contentDigest, generateUUID, normalizePath } from '@notesapp/core';
import { mergeHunks, type DiffHunk, type HunkDecision } from '@notesapp/editor';
import type { LocalStore, QueueEntry } from '@notesapp/sync';
import { Button, StatusRegion, TextField } from '@notesapp/ui';
import { problemMessage, useLocalStore, useSession } from '../app.tsx';
import { canWrite, findWorkspace, useWorkspaces } from './workspaces.tsx';
import { InlineDiff } from './history.tsx';
import {
  loadAttachmentBinary,
  type LoadedAttachment,
} from './attachment-content.ts';
import { requestDiff } from './diff-worker.ts';

/** One hunk choice of the merge UI. */
type HunkTake = 'head' | 'tip' | 'edit';

/** The comparison behind one file merge. */
type FileDiff =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly hunks: readonly DiffHunk[] }
  | { readonly status: 'limit' }
  | { readonly status: 'error'; readonly message: string };

/** One file of a conflict group with its merge state. */
type ConflictFile = {
  readonly fileId: string;
  readonly branch: BranchItem;
  readonly extraBranches: number;
  readonly baseRevisionId: string | null;
  readonly basePath: string | null;
  readonly headState: 'loading' | 'new' | 'purged' | 'ready' | 'error';
  readonly headError: string | null;
  readonly headRevisionId: string | null;
  readonly headText: string;
  readonly headDigest: string | null;
  readonly headObjectId: string | null;
  readonly headPath: string | null;
  readonly headKind: 'note' | 'attachment' | null;
  readonly headDeleted: boolean;
  readonly tipState: 'loading' | 'ready' | 'error';
  readonly tipError: string | null;
  readonly tipText: string;
  readonly tipDigest: string | null;
  readonly tipObjectId: string | null;
  readonly tipPath: string | null;
  readonly tipKind: 'note' | 'attachment' | null;
  readonly tipDeleted: boolean;
  readonly diff: FileDiff;
  readonly takes: readonly (HunkTake | null)[];
  readonly customs: readonly string[];
  readonly wholeTake: 'head' | 'tip' | 'custom' | null;
  readonly wholeCustom: string;
  readonly duelTake: 'keep' | 'take' | null;
  readonly duelText: string;
  readonly newFileText: string;
  readonly binaryTake: 'head' | 'tip';
  readonly finalPath: string;
  readonly deleteChoice: boolean;
  readonly retained: string | null;
  readonly useRetained: boolean;
  readonly expectedHead: string | null;
};

/** One file resolution ready for the resolve operation. */
type FileDraft = {
  readonly fileId: string;
  readonly branchTip: string;
  readonly expectedHead: string | null;
  readonly path: string;
  readonly deleted: boolean;
  readonly text: string | null;
  readonly attachment: {
    readonly digest: string;
    readonly objectId: string;
  } | null;
};

/** The state of one conflict group on screen. */
type ConflictGroupState = {
  readonly files: readonly ConflictFile[];
  readonly groupError: string | null;
  readonly groupMessage: string | null;
  readonly resolving: boolean;
  readonly resolved: readonly string[] | null;
};

/** True when the file holds attachment bytes on either side. */
function isAttachmentFile(file: ConflictFile): boolean {
  return file.headKind === 'attachment' || file.tipKind === 'attachment';
}

/** True when one side deletes the file. */
function isDeleteDuel(file: ConflictFile): boolean {
  return (
    file.headState === 'ready' &&
    file.tipState === 'ready' &&
    (file.headDeleted || file.tipDeleted)
  );
}

/** The path kind used to validate a final path. */
function pathKindOf(file: ConflictFile): 'note' | 'attachment' {
  return isAttachmentFile(file) ? 'attachment' : 'note';
}

/** The merged markdown of one file, or why it is not ready. */
function mergedTextOf(
  file: ConflictFile,
):
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string } {
  if (file.useRetained && file.retained !== null)
    return { ok: true, text: file.retained };
  if (file.diff.status === 'loading' || file.diff.status === 'idle')
    return { ok: false, reason: 'The comparison is still loading.' };
  if (file.diff.status === 'error')
    return { ok: false, reason: file.diff.message };
  if (file.diff.status === 'limit') {
    if (file.wholeTake === 'head') return { ok: true, text: file.headText };
    if (file.wholeTake === 'tip') return { ok: true, text: file.tipText };
    if (file.wholeTake === 'custom')
      return { ok: true, text: file.wholeCustom };
    return {
      ok: false,
      reason: 'Choose the whole current or incoming version.',
    };
  }
  const hunks = file.diff.hunks;
  if (file.takes.length !== hunks.length)
    return { ok: false, reason: 'The comparison is still loading.' };
  const decisions: HunkDecision[] = [];
  for (let index = 0; index < hunks.length; index += 1) {
    const take = file.takes[index];
    if (take === null || take === undefined)
      return {
        ok: false,
        reason: `Choose hunk ${String(index + 1)} before resolving.`,
      };
    if (take === 'head') decisions.push({ take: 'before' });
    else if (take === 'tip') decisions.push({ take: 'after' });
    else decisions.push({ take: 'custom', text: file.customs[index] ?? '' });
  }
  try {
    return {
      ok: true,
      text: mergeHunks(file.headText, file.tipText, hunks, decisions),
    };
  } catch {
    return { ok: false, reason: 'The hunk choices do not merge cleanly.' };
  }
}

/**
 * Builds the resolution draft of one file, or null when it needs more input.
 *
 * Path validity is checked by the caller with a message; this only checks
 * that the merge content is complete.
 */
function draftOf(file: ConflictFile): FileDraft | null {
  if (file.tipState !== 'ready') return null;
  if (file.headState !== 'ready' && file.headState !== 'new') return null;
  if (file.finalPath.trim() === '') return null;
  const attachment = isAttachmentFile(file);
  if (file.headState === 'new') {
    if (attachment) {
      if (file.tipDigest === null || file.tipObjectId === null) return null;
      return {
        fileId: file.fileId,
        branchTip: file.branch.tipRevisionId,
        expectedHead: null,
        path: file.finalPath,
        deleted: false,
        text: null,
        attachment: { digest: file.tipDigest, objectId: file.tipObjectId },
      };
    }
    return {
      fileId: file.fileId,
      branchTip: file.branch.tipRevisionId,
      expectedHead: null,
      path: file.finalPath,
      deleted: false,
      text: file.newFileText,
      attachment: null,
    };
  }
  if (attachment) {
    const headRef =
      file.headDigest !== null && file.headObjectId !== null
        ? { digest: file.headDigest, objectId: file.headObjectId }
        : null;
    const tipRef =
      file.tipDigest !== null && file.tipObjectId !== null
        ? { digest: file.tipDigest, objectId: file.tipObjectId }
        : null;
    if (file.tipDeleted) {
      if (file.binaryTake === 'tip')
        return {
          fileId: file.fileId,
          branchTip: file.branch.tipRevisionId,
          expectedHead: file.expectedHead,
          path: file.finalPath,
          deleted: true,
          text: null,
          attachment: headRef,
        };
      if (headRef === null) return null;
      return {
        fileId: file.fileId,
        branchTip: file.branch.tipRevisionId,
        expectedHead: file.expectedHead,
        path: file.finalPath,
        deleted: false,
        text: null,
        attachment: headRef,
      };
    }
    if (file.headDeleted) {
      if (file.binaryTake === 'head')
        return {
          fileId: file.fileId,
          branchTip: file.branch.tipRevisionId,
          expectedHead: file.expectedHead,
          path: file.finalPath,
          deleted: true,
          text: null,
          attachment: tipRef,
        };
      if (tipRef === null) return null;
      return {
        fileId: file.fileId,
        branchTip: file.branch.tipRevisionId,
        expectedHead: file.expectedHead,
        path: file.finalPath,
        deleted: false,
        text: null,
        attachment: tipRef,
      };
    }
    const chosen = file.binaryTake === 'head' ? headRef : tipRef;
    if (chosen === null) return null;
    return {
      fileId: file.fileId,
      branchTip: file.branch.tipRevisionId,
      expectedHead: file.expectedHead,
      path: file.finalPath,
      deleted: false,
      text: null,
      attachment: chosen,
    };
  }
  if (isDeleteDuel(file)) {
    if (file.duelTake === null) return null;
    if (file.duelTake === 'keep')
      return {
        fileId: file.fileId,
        branchTip: file.branch.tipRevisionId,
        expectedHead: file.expectedHead,
        path: file.finalPath,
        deleted: true,
        text: '',
        attachment: null,
      };
    return {
      fileId: file.fileId,
      branchTip: file.branch.tipRevisionId,
      expectedHead: file.expectedHead,
      path: file.finalPath,
      deleted: false,
      text: file.duelText,
      attachment: null,
    };
  }
  if (file.deleteChoice)
    return {
      fileId: file.fileId,
      branchTip: file.branch.tipRevisionId,
      expectedHead: file.expectedHead,
      path: file.finalPath,
      deleted: true,
      text: '',
      attachment: null,
    };
  const merged = mergedTextOf(file);
  if (!merged.ok) return null;
  return {
    fileId: file.fileId,
    branchTip: file.branch.tipRevisionId,
    expectedHead: file.expectedHead,
    path: file.finalPath,
    deleted: false,
    text: merged.text,
    attachment: null,
  };
}

/** Reads the stable application error code of a failed generated call. */
function problemCode(error: unknown): string {
  if (error === null || typeof error !== 'object') return '';
  const code: unknown = Object.fromEntries(Object.entries(error))['code'];
  return typeof code === 'string' ? code : '';
}

/**
 * The conflicts of one workspace.
 *
 * Route params name the workspace; an optional `fileId` search value filters
 * to one file. Session, store, and role come from the application providers.
 */
export function ConflictsView(): ReactNode {
  const params = useParams();
  const [search] = useSearchParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  const session = useSession();
  const store = useLocalStore();
  const { state } = useWorkspaces();

  if (workspaceId === null)
    return (
      <main>
        <h1>Conflicts not found</h1>
        <p>The address names no workspace.</p>
        <p>
          <Link to="/">Back to workspaces.</Link>
        </p>
      </main>
    );
  const accountId = session.account?.accountId ?? null;
  if (accountId === null)
    return (
      <main>
        <StatusRegion message="Loading the conflicts." />
      </main>
    );
  const role =
    state.status === 'ready'
      ? (findWorkspace(state.workspaces, workspaceId)?.role ?? null)
      : null;
  return (
    <ConflictsDetail
      store={store.store}
      accountId={accountId}
      workspaceId={workspaceId}
      role={role}
      fileFilter={search.get('fileId')}
    />
  );
}

/** Loads unresolved branches and pending local conflicts. */
function ConflictsDetail({
  store,
  accountId,
  workspaceId,
  role,
  fileFilter,
}: {
  readonly store: LocalStore | null;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly role: 'owner' | 'admin' | 'editor' | 'viewer' | null;
  readonly fileFilter: string | null;
}): ReactNode {
  const [branches, setBranches] = useState<readonly BranchItem[]>([]);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [pending, setPending] = useState<readonly QueueEntry[]>([]);
  const [notice, setNotice] = useState('');
  const [reloadGeneration, setReloadGeneration] = useState(0);

  const writable = role !== null && canWrite(role);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const result = await listBranches({
        path: { workspaceId },
        query:
          fileFilter === null
            ? { state: 'unresolved' }
            : { fileId: fileFilter, state: 'unresolved' },
      });
      if (cancelled) return;
      if (result.error !== undefined || result.data === undefined) {
        setBranchesError(problemMessage(result.error));
        return;
      }
      setBranches(result.data.branches);
      setBranchesError(null);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, fileFilter, reloadGeneration]);

  useEffect(() => {
    if (store === null) {
      setPending([]);
      return;
    }
    const activeStore = store;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const entries = await activeStore.pending(accountId, workspaceId);
        if (!cancelled)
          setPending(entries.filter((entry) => entry.state === 'conflict'));
      } catch {
        if (!cancelled) setPending([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [store, accountId, workspaceId, reloadGeneration]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, BranchItem[]>();
    for (const branch of branches) {
      const list = byGroup.get(branch.conflictGroupId) ?? [];
      list.push(branch);
      byGroup.set(branch.conflictGroupId, list);
    }
    return [...byGroup.entries()].sort((left, right) =>
      left[0] < right[0] ? -1 : 1,
    );
  }, [branches]);

  function reload(): void {
    setReloadGeneration((current) => current + 1);
  }

  return (
    <main>
      <h1>Conflicts</h1>
      <p>
        <Link to={`/w/${workspaceId}`}>Back to the workspace.</Link>
        {' | '}
        <Link to={`/w/${workspaceId}/purge`}>Deletion and purge.</Link>
      </p>
      <p>
        Each conflict keeps both versions. Resolution merges them explicitly and
        saves the result with both tips as parents. Nothing here merges
        silently.
      </p>
      {notice !== '' ? <StatusRegion message={notice} /> : null}
      {branchesError !== null ? (
        <p className="notes-status-error" role="alert">
          {branchesError}
        </p>
      ) : null}
      {fileFilter !== null ? <p>Filtered to file {fileFilter}.</p> : null}
      {groups.length === 0 && branchesError === null ? (
        <p>No unresolved conflict branches in this workspace.</p>
      ) : (
        groups.map(([groupId, groupBranches]) => (
          <ConflictGroup
            key={groupId}
            store={store}
            workspaceId={workspaceId}
            groupId={groupId}
            branches={groupBranches}
            writable={writable}
            onResolved={(message: string) => {
              setNotice(message);
              reload();
            }}
          />
        ))
      )}
      <PendingConflicts
        store={store}
        workspaceId={workspaceId}
        pending={pending}
        writable={writable}
        onUploaded={(message: string) => {
          setNotice(message);
          reload();
        }}
      />
      {!writable ? <p>Resolving conflicts needs a writer role.</p> : null}
    </main>
  );
}

/** Starts one file merge from its branch, head, and base. */
function startFile(branch: BranchItem, extraBranches: number): ConflictFile {
  return {
    fileId: branch.fileId,
    branch,
    extraBranches,
    baseRevisionId: branch.baseRevisionId,
    basePath: null,
    headState: 'loading',
    headError: null,
    headRevisionId: null,
    headText: '',
    headDigest: null,
    headObjectId: null,
    headPath: null,
    headKind: null,
    headDeleted: false,
    tipState: 'loading',
    tipError: null,
    tipText: '',
    tipDigest: null,
    tipObjectId: null,
    tipPath: null,
    tipKind: null,
    tipDeleted: false,
    diff: { status: 'idle' },
    takes: [],
    customs: [],
    wholeTake: null,
    wholeCustom: '',
    duelTake: null,
    duelText: '',
    newFileText: '',
    binaryTake: 'head',
    finalPath: '',
    deleteChoice: false,
    retained: null,
    useRetained: false,
    expectedHead: null,
  };
}

/** Resolves every file of one conflict group together. */
function ConflictGroup({
  store,
  workspaceId,
  groupId,
  branches,
  writable,
  onResolved,
}: {
  readonly store: LocalStore | null;
  readonly workspaceId: string;
  readonly groupId: string;
  readonly branches: readonly BranchItem[];
  readonly writable: boolean;
  readonly onResolved: (message: string) => void;
}): ReactNode {
  const [state, setState] = useState<ConflictGroupState>({
    files: [],
    groupError: null,
    groupMessage: null,
    resolving: false,
    resolved: null,
  });
  const generationRef = useRef(0);
  const filesRef = useRef<readonly ConflictFile[]>([]);
  // The effect below resets this mirror together with the state.

  /** Patches one file of this group. */
  function patchFile(fileId: string, patch: Partial<ConflictFile>): void {
    setState((current) => {
      const files = current.files.map((file) =>
        file.fileId === fileId ? { ...file, ...patch } : file,
      );
      filesRef.current = files;
      return { ...current, files };
    });
  }

  /** The latest known state of one file, including user edits. */
  function knownFile(fileId: string): ConflictFile | null {
    return filesRef.current.find((file) => file.fileId === fileId) ?? null;
  }

  /**
   * Loads head, tip, base, and the diff of one file.
   *
   * Every value travels in locals into one patch, so no stale file state can
   * leak between the awaits. `keepText` carries an edited result that a moved
   * head must retain.
   */
  async function loadFile(
    file: ConflictFile,
    generation: number,
    keepText: string | null,
  ): Promise<void> {
    const fileId = file.fileId;
    const tipId = file.branch.tipRevisionId;

    const loaded = await getFile({ path: { workspaceId, fileId } });
    if (generation !== generationRef.current) return;
    if (loaded.error !== undefined || loaded.data === undefined) {
      const code = loaded.response?.status ?? 0;
      if (code === 404) {
        patchFile(fileId, { headState: 'new', expectedHead: null });
      } else if (code === 410) {
        patchFile(fileId, { headState: 'purged' });
      } else {
        patchFile(fileId, {
          headState: 'error',
          headError: problemMessage(loaded.error),
        });
      }
    } else {
      const head = loaded.data.head;
      const previous = knownFile(fileId);
      patchFile(fileId, {
        headState: 'ready',
        headRevisionId: loaded.data.headRevisionId,
        headText: head?.text ?? '',
        headDigest: head?.digest ?? null,
        headObjectId: head?.attachmentObjectId ?? null,
        headPath: loaded.data.path,
        headKind: loaded.data.kind,
        headDeleted: head?.deleted ?? loaded.data.headRevisionId === null,
        expectedHead: loaded.data.headRevisionId,
        finalPath:
          previous?.finalPath === undefined || previous.finalPath === ''
            ? loaded.data.path
            : previous.finalPath,
        binaryTake:
          head?.deleted === true ? 'tip' : (previous?.binaryTake ?? 'head'),
      });
    }

    const tip = await getRevision({
      path: { workspaceId, revisionId: tipId },
    });
    if (generation !== generationRef.current) return;
    if (tip.error !== undefined || tip.data === undefined) {
      patchFile(fileId, {
        tipState: 'error',
        tipError: problemMessage(tip.error),
      });
      return;
    }
    const tipRevision = tip.data;
    let basePath: string | null = null;
    if (file.baseRevisionId !== null) {
      const base = await getRevision({
        path: { workspaceId, revisionId: file.baseRevisionId },
      });
      if (generation !== generationRef.current) return;
      if (base.error === undefined && base.data !== undefined)
        basePath = base.data.path;
    }
    const previous = knownFile(fileId);
    const headText = previous?.headText ?? '';
    patchFile(fileId, {
      tipState: 'ready',
      tipText: tipRevision.text ?? '',
      tipDigest: tipRevision.digest,
      tipObjectId: tipRevision.attachmentObjectId,
      tipPath: tipRevision.path,
      tipKind: tipRevision.kind,
      tipDeleted: tipRevision.deleted,
      basePath,
      newFileText:
        previous?.newFileText === undefined || previous.newFileText === ''
          ? (tipRevision.text ?? '')
          : previous.newFileText,
      duelText:
        previous?.duelText === undefined || previous.duelText === ''
          ? tipRevision.deleted
            ? headText
            : (tipRevision.text ?? '')
          : previous.duelText,
      binaryTake: tipRevision.deleted
        ? 'tip'
        : (previous?.binaryTake ?? 'head'),
      finalPath:
        previous?.finalPath === undefined || previous.finalPath === ''
          ? (previous?.headPath ?? tipRevision.path)
          : previous.finalPath,
    });
    if (generation !== generationRef.current) return;
    await compareFile(fileId, generation, keepText);
  }

  /** Compares the loaded head and tip texts of one file in a worker. */
  async function compareFile(
    fileId: string,
    generation: number,
    keepText: string | null,
  ): Promise<void> {
    const file = knownFile(fileId);
    if (file === null) return;
    if (
      (file.headState !== 'ready' && file.headState !== 'new') ||
      file.tipState !== 'ready'
    )
      return;
    if (isAttachmentFile(file) || file.headState === 'new') {
      patchFile(fileId, {
        diff: { status: 'idle' },
        retained: keepText,
        useRetained: keepText !== null,
      });
      return;
    }
    patchFile(fileId, { diff: { status: 'loading' } });
    try {
      const compared = await requestDiff(file.headText, file.tipText);
      if (generation !== generationRef.current) return;
      if (compared.kind === 'complete') {
        patchFile(fileId, {
          diff: { status: 'ready', hunks: compared.hunks },
          takes: compared.hunks.map(() => null),
          customs: compared.hunks.map((hunk) => hunk.after.join('')),
          retained: keepText,
          useRetained: keepText !== null,
        });
      } else {
        patchFile(fileId, {
          diff: { status: 'limit' },
          wholeTake: null,
          wholeCustom: file.tipText,
          retained: keepText,
          useRetained: keepText !== null,
        });
      }
    } catch {
      if (generation === generationRef.current)
        patchFile(fileId, {
          diff: { status: 'error', message: 'The comparison did not finish.' },
        });
    }
  }

  /** Loads every file of the group when its branch set changes. */
  const branchKey = branches
    .map((branch) => `${branch.fileId}:${branch.tipRevisionId}`)
    .sort()
    .join('|');
  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const byFile = new Map<string, BranchItem[]>();
    for (const branch of branches) {
      const list = byFile.get(branch.fileId) ?? [];
      list.push(branch);
      byFile.set(branch.fileId, list);
    }
    const started: ConflictFile[] = [];
    for (const list of byFile.values()) {
      const ordered = [...list].sort((left, right) =>
        left.createdAt < right.createdAt ? 1 : -1,
      );
      const newest = ordered[0];
      if (newest === undefined) continue;
      started.push(startFile(newest, ordered.length - 1));
    }
    filesRef.current = started;
    setState({
      files: started,
      groupError: null,
      groupMessage: null,
      resolving: false,
      resolved: null,
    });
    for (const file of started) void loadFile(file, generation, null);
    return () => {
      generationRef.current += 1;
    };
  }, [groupId, workspaceId, branchKey]);

  /** Submits the resolutions of every file of this group together. */
  async function resolveGroup(): Promise<void> {
    if (state.resolving) return;
    setState((current) => ({
      ...current,
      resolving: true,
      groupError: null,
      groupMessage: null,
    }));
    const drafts: FileDraft[] = [];
    for (const file of state.files) {
      const pathCheck = normalizePath(file.finalPath, pathKindOf(file));
      if (!pathCheck.ok) {
        setState((current) => ({
          ...current,
          resolving: false,
          groupError: `File ${file.fileId} needs a valid final path.`,
        }));
        return;
      }
      const draft = draftOf({ ...file, finalPath: pathCheck.value });
      if (draft === null) {
        setState((current) => ({
          ...current,
          resolving: false,
          groupError: `File ${file.fileId} still needs a choice before resolving.`,
        }));
        return;
      }
      drafts.push(draft);
    }
    const resolutions: BranchResolutionInput[] = [];
    for (const draft of drafts) {
      if (draft.text !== null) {
        const text = draft.deleted ? '' : draft.text;
        resolutions.push({
          fileId: draft.fileId,
          expectedHead: draft.expectedHead,
          branchTip: draft.branchTip,
          revisionId: generateUUID(),
          path: draft.path,
          content: {
            kind: 'markdown',
            digest: await contentDigest(text),
            text,
          },
          deleted: draft.deleted,
          message: 'Resolve conflict',
        });
      } else if (draft.attachment !== null) {
        resolutions.push({
          fileId: draft.fileId,
          expectedHead: draft.expectedHead,
          branchTip: draft.branchTip,
          revisionId: generateUUID(),
          path: draft.path,
          content: {
            kind: 'attachment',
            digest: draft.attachment.digest,
            attachmentObjectId: draft.attachment.objectId,
          },
          deleted: draft.deleted,
          message: 'Resolve conflict',
        });
      }
    }
    const result = await resolveBranches({
      path: { workspaceId },
      body: {
        mutationId: generateUUID(),
        deviceId: store?.deviceId ?? 'web-device',
        clientTime: new Date().toISOString(),
        conflictGroupId: groupId,
        resolutions,
      },
    });
    if (result.error !== undefined || result.data === undefined) {
      const moved =
        result.response?.status === 412 ||
        problemCode(result.error) === 'stale_head';
      if (moved) {
        await handleMovedHeads(drafts);
        return;
      }
      setState((current) => ({
        ...current,
        resolving: false,
        groupError: problemMessage(result.error),
      }));
      return;
    }
    const accepted = result.data.revisions.map(
      (revision) => revision.revisionId,
    );
    setState((current) => ({
      ...current,
      resolving: false,
      resolved: accepted,
      groupMessage: `Resolved ${String(accepted.length)} file(s).`,
    }));
    onResolved(
      `Conflict group resolved with ${String(accepted.length)} file(s).`,
    );
  }

  /**
   * Handles heads that moved during resolution.
   *
   * The edited result of every affected file is retained and offered back,
   * then each head reloads and compares again. Nothing the user wrote is
   * lost.
   */
  async function handleMovedHeads(drafts: readonly FileDraft[]): Promise<void> {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const kept = new Map(drafts.map((draft) => [draft.fileId, draft]));
    for (const file of state.files) {
      const draft = kept.get(file.fileId);
      const retainedText = draft?.text ?? file.retained;
      patchFile(file.fileId, {
        headState: 'loading',
        diff: { status: 'loading' },
        retained: retainedText,
        useRetained: retainedText !== null,
      });
      const reloaded = await getFile({
        path: { workspaceId, fileId: file.fileId },
      });
      if (generation !== generationRef.current) return;
      if (reloaded.error !== undefined || reloaded.data === undefined) {
        patchFile(file.fileId, {
          headState: 'error',
          headError: problemMessage(reloaded.error),
          diff: { status: 'idle' },
        });
        continue;
      }
      const head = reloaded.data.head;
      patchFile(file.fileId, {
        headState: 'ready',
        headRevisionId: reloaded.data.headRevisionId,
        headText: head?.text ?? '',
        headDigest: head?.digest ?? null,
        headObjectId: head?.attachmentObjectId ?? null,
        headPath: reloaded.data.path,
        headKind: reloaded.data.kind,
        headDeleted: head?.deleted ?? reloaded.data.headRevisionId === null,
        expectedHead: reloaded.data.headRevisionId,
      });
      await compareFile(file.fileId, generation, retainedText);
    }
    setState((current) => ({
      ...current,
      resolving: false,
      groupError:
        'A head moved again. Your edited result is kept below; review it and resolve again.',
    }));
  }

  return (
    <section aria-labelledby={`conflict-group-${groupId}`}>
      <h2 id={`conflict-group-${groupId}`}>Conflict group</h2>
      <p>
        Group {groupId} holds {String(state.files.length)} file(s).
      </p>
      {state.groupMessage !== null ? (
        <StatusRegion message={state.groupMessage} />
      ) : null}
      {state.groupError !== null ? (
        <p className="notes-status-error" role="alert">
          {state.groupError}
        </p>
      ) : null}
      {state.resolved !== null ? (
        <p>Accepted revisions: {state.resolved.join(', ')}.</p>
      ) : null}
      {state.files.map((file) => (
        <FileMerge
          key={file.fileId}
          workspaceId={workspaceId}
          file={file}
          writable={writable}
          onPatch={(patch: Partial<ConflictFile>) => {
            patchFile(file.fileId, patch);
          }}
        />
      ))}
      {writable && state.resolved === null ? (
        <Button
          variant="primary"
          label="Resolve every file of this conflict group"
          disabled={state.resolving}
          onClick={() => {
            void resolveGroup();
          }}
        >
          {state.resolving ? 'Resolving the group.' : 'Resolve the whole group'}
        </Button>
      ) : null}
    </section>
  );
}

/** The merge UI of one conflicted file. */
function FileMerge({
  workspaceId,
  file,
  writable,
  onPatch,
}: {
  readonly workspaceId: string;
  readonly file: ConflictFile;
  readonly writable: boolean;
  readonly onPatch: (patch: Partial<ConflictFile>) => void;
}): ReactNode {
  if (file.headState === 'loading' || file.tipState === 'loading')
    return (
      <section aria-label={`File ${file.fileId}`}>
        <h3>File {file.fileId}</h3>
        <StatusRegion message="Loading both versions." />
      </section>
    );
  if (file.headState === 'error')
    return (
      <section aria-label={`File ${file.fileId}`}>
        <h3>File {file.fileId}</h3>
        <p className="notes-status-error" role="alert">
          {file.headError ?? 'The current version did not load.'}
        </p>
      </section>
    );
  if (file.tipState === 'error')
    return (
      <section aria-label={`File ${file.fileId}`}>
        <h3>File {file.fileId}</h3>
        <p className="notes-status-error" role="alert">
          {file.tipError ?? 'The incoming version did not load.'}
        </p>
      </section>
    );
  if (file.headState === 'purged')
    return (
      <section aria-label={`File ${file.fileId}`}>
        <h3>File {file.fileId}</h3>
        <p>
          This file was purged after the branch landed, so the branch cannot
          resolve onto it.
        </p>
      </section>
    );

  const attachment = isAttachmentFile(file);
  const title = file.headPath ?? file.tipPath ?? file.fileId;
  return (
    <section aria-label={`File ${title}`}>
      <h3>{title}</h3>
      {file.extraBranches > 0 ? (
        <p>
          {String(file.extraBranches)} more unresolved branch(es) of this file
          share the group; the newest tip is merged here.
        </p>
      ) : null}
      {file.baseRevisionId !== null ? (
        <p>
          Branched from revision {file.baseRevisionId}
          {file.basePath !== null ? ` at ${file.basePath}` : ''}.
        </p>
      ) : (
        <p>This branch proposes a new file with no accepted head yet.</p>
      )}
      {file.headPath !== null &&
      file.tipPath !== null &&
      file.headPath !== file.tipPath ? (
        <p>
          The two versions name different paths: {file.headPath} and{' '}
          {file.tipPath}. Name one final path below.
        </p>
      ) : null}
      {file.headDeleted ? <p>The current head deletes this file.</p> : null}
      {file.tipDeleted ? <p>The incoming branch deletes this file.</p> : null}
      {file.retained !== null && file.useRetained ? (
        <div>
          <h4>Retained edited result</h4>
          <p>
            A head moved while resolving, so the edited result below is kept.
            Uncheck to redo the hunk choices against the new head.
          </p>
          <label>
            <input
              type="checkbox"
              checked={file.useRetained}
              disabled={!writable}
              onChange={(event): void => {
                onPatch({ useRetained: event.target.checked });
              }}
            />
            Resolve with the retained text
          </label>
          <label>
            Retained text
            <textarea
              aria-label="Retained edited result"
              rows={12}
              value={file.retained}
              disabled={!writable}
              onChange={(event): void => {
                onPatch({ retained: event.target.value });
              }}
            />
          </label>
        </div>
      ) : null}

      {attachment ? (
        <AttachmentMerge
          workspaceId={workspaceId}
          file={file}
          writable={writable}
          onPatch={onPatch}
        />
      ) : file.headState === 'new' ? (
        <div>
          <h4>Incoming content</h4>
          <label>
            File content
            <textarea
              aria-label="Content of the proposed file"
              rows={12}
              value={file.newFileText}
              disabled={!writable}
              onChange={(event): void => {
                onPatch({ newFileText: event.target.value });
              }}
            />
          </label>
        </div>
      ) : isDeleteDuel(file) ? (
        <DeleteDuel file={file} writable={writable} onPatch={onPatch} />
      ) : (
        <MarkdownMerge file={file} writable={writable} onPatch={onPatch} />
      )}

      {writable ? (
        <div>
          <TextField
            id={`notes-final-path-${file.fileId}`}
            label="Final path of this file"
            value={file.finalPath}
            onChange={(value: string) => {
              onPatch({ finalPath: value });
            }}
          />
          {!attachment && file.headState === 'ready' && !isDeleteDuel(file) ? (
            <label>
              <input
                type="checkbox"
                checked={file.deleteChoice}
                onChange={(event): void => {
                  onPatch({ deleteChoice: event.target.checked });
                }}
              />
              Resolve by deleting this file
            </label>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** The hunk choices and merged preview of two live markdown versions. */
function MarkdownMerge({
  file,
  writable,
  onPatch,
}: {
  readonly file: ConflictFile;
  readonly writable: boolean;
  readonly onPatch: (patch: Partial<ConflictFile>) => void;
}): ReactNode {
  if (file.deleteChoice)
    return (
      <p>This file resolves by deletion. Uncheck the box to merge text.</p>
    );
  if (file.diff.status === 'loading' || file.diff.status === 'idle')
    return <StatusRegion message="Comparing the two versions." />;
  if (file.diff.status === 'error')
    return (
      <p className="notes-status-error" role="alert">
        {file.diff.message}
      </p>
    );
  if (file.diff.status === 'limit')
    return (
      <div>
        <p>
          The two versions differ by more than the comparison limit, so no
          inline diff is shown. Choose one whole version or edit the full
          source; both branches are retained either way.
        </p>
        <fieldset>
          <legend>Whole version for this file</legend>
          <label>
            <input
              type="radio"
              name={`notes-whole-${file.fileId}`}
              checked={file.wholeTake === 'head'}
              disabled={!writable}
              onChange={(): void => {
                onPatch({ wholeTake: 'head' });
              }}
            />
            Keep the whole current version
          </label>
          <label>
            <input
              type="radio"
              name={`notes-whole-${file.fileId}`}
              checked={file.wholeTake === 'tip'}
              disabled={!writable}
              onChange={(): void => {
                onPatch({ wholeTake: 'tip' });
              }}
            />
            Take the whole incoming version
          </label>
          <label>
            <input
              type="radio"
              name={`notes-whole-${file.fileId}`}
              checked={file.wholeTake === 'custom'}
              disabled={!writable}
              onChange={(): void => {
                onPatch({ wholeTake: 'custom' });
              }}
            />
            Edit the full source
          </label>
        </fieldset>
        {file.wholeTake === 'custom' ? (
          <label>
            Full source of the resolved file
            <textarea
              aria-label="Full source of the resolved file"
              rows={16}
              value={file.wholeCustom}
              disabled={!writable}
              onChange={(event): void => {
                onPatch({ wholeCustom: event.target.value });
              }}
            />
          </label>
        ) : null}
      </div>
    );
  const hunks = file.diff.hunks;
  const merged = file.useRetained ? null : mergedTextOf(file);
  return (
    <div>
      <InlineDiff
        hunks={hunks}
        idPrefix={`conflict-${file.fileId}`}
        oldLabel="Current head"
        newLabel="Incoming branch"
      />
      {hunks.map((hunk, index) => {
        const take = file.takes[index] ?? null;
        return (
          <fieldset key={`conflict-${file.fileId}-hunk-${String(index)}`}>
            <legend>
              {`Hunk ${String(index + 1)} starting at current line ${String(hunk.beforeStart)}`}
            </legend>
            <label>
              <input
                type="radio"
                name={`notes-hunk-${file.fileId}-${String(index)}`}
                checked={take === 'head'}
                disabled={!writable}
                onChange={(): void => {
                  onPatch({
                    takes: file.takes.map((entry, at) =>
                      at === index ? 'head' : entry,
                    ),
                  });
                }}
              />
              Keep the current lines
            </label>
            <label>
              <input
                type="radio"
                name={`notes-hunk-${file.fileId}-${String(index)}`}
                checked={take === 'tip'}
                disabled={!writable}
                onChange={(): void => {
                  onPatch({
                    takes: file.takes.map((entry, at) =>
                      at === index ? 'tip' : entry,
                    ),
                  });
                }}
              />
              Take the incoming lines
            </label>
            <label>
              <input
                type="radio"
                name={`notes-hunk-${file.fileId}-${String(index)}`}
                checked={take === 'edit'}
                disabled={!writable}
                onChange={(): void => {
                  onPatch({
                    takes: file.takes.map((entry, at) =>
                      at === index ? 'edit' : entry,
                    ),
                  });
                }}
              />
              Edit these lines
            </label>
            {take === 'edit' ? (
              <label>
                Edited lines of this hunk
                <textarea
                  aria-label={`Edited lines of hunk ${String(index + 1)}`}
                  rows={Math.max(4, hunk.after.length + 1)}
                  value={file.customs[index] ?? ''}
                  disabled={!writable}
                  onChange={(event): void => {
                    onPatch({
                      customs: file.customs.map((entry, at) =>
                        at === index ? event.target.value : entry,
                      ),
                    });
                  }}
                />
              </label>
            ) : null}
          </fieldset>
        );
      })}
      <h4>Merged result preview</h4>
      {merged === null ? (
        <p>The retained text above is the merged result.</p>
      ) : merged.ok ? (
        <pre>{merged.text}</pre>
      ) : (
        <p>{merged.reason}</p>
      )}
    </div>
  );
}

/** The keep-or-delete choice when one side deletes a markdown file. */
function DeleteDuel({
  file,
  writable,
  onPatch,
}: {
  readonly file: ConflictFile;
  readonly writable: boolean;
  readonly onPatch: (patch: Partial<ConflictFile>) => void;
}): ReactNode {
  return (
    <div>
      <p>
        One side deletes this file, so hunk merging does not apply. Choose the
        outcome explicitly.
      </p>
      <fieldset>
        <legend>Outcome for this file</legend>
        <label>
          <input
            type="radio"
            name={`notes-duel-${file.fileId}`}
            checked={file.duelTake === 'keep'}
            disabled={!writable}
            onChange={(): void => {
              onPatch({ duelTake: 'keep' });
            }}
          />
          {file.tipDeleted
            ? 'Delete the file (accept the incoming deletion)'
            : 'Keep the file deleted (accept the current deletion)'}
        </label>
        <label>
          <input
            type="radio"
            name={`notes-duel-${file.fileId}`}
            checked={file.duelTake === 'take'}
            disabled={!writable}
            onChange={(): void => {
              onPatch({ duelTake: 'take' });
            }}
          />
          {file.tipDeleted
            ? 'Keep the current content'
            : 'Restore the incoming content'}
        </label>
      </fieldset>
      {file.duelTake === 'take' ? (
        <label>
          Content of the resolved file
          <textarea
            aria-label="Content of the resolved file"
            rows={12}
            value={file.duelText}
            disabled={!writable}
            onChange={(event): void => {
              onPatch({ duelText: event.target.value });
            }}
          />
        </label>
      ) : null}
    </div>
  );
}

/** Whole-version selection with a preview of each side. */
function AttachmentMerge({
  workspaceId,
  file,
  writable,
  onPatch,
}: {
  readonly workspaceId: string;
  readonly file: ConflictFile;
  readonly writable: boolean;
  readonly onPatch: (patch: Partial<ConflictFile>) => void;
}): ReactNode {
  if (file.tipDeleted && file.headDeleted)
    return <p>Both sides delete this attachment.</p>;
  const headId = file.headRevisionId;
  const tipId = file.branch.tipRevisionId;
  return (
    <div>
      <p>
        Attachments resolve by choosing one whole version. Text merging does not
        apply to bytes.
      </p>
      <fieldset>
        <legend>Version for this file</legend>
        {!file.headDeleted && headId !== null ? (
          <label>
            <input
              type="radio"
              name={`notes-binary-${file.fileId}`}
              checked={file.binaryTake === 'head'}
              disabled={!writable}
              onChange={(): void => {
                onPatch({ binaryTake: 'head' });
              }}
            />
            Keep the current version
            <AttachmentPreview
              workspaceId={workspaceId}
              revisionId={headId}
              label="Preview of the current version"
            />
          </label>
        ) : null}
        {!file.tipDeleted ? (
          <label>
            <input
              type="radio"
              name={`notes-binary-${file.fileId}`}
              checked={file.binaryTake === 'tip'}
              disabled={!writable}
              onChange={(): void => {
                onPatch({ binaryTake: 'tip' });
              }}
            />
            Take the incoming version
            <AttachmentPreview
              workspaceId={workspaceId}
              revisionId={tipId}
              label="Preview of the incoming version"
            />
          </label>
        ) : null}
        {file.tipDeleted ? (
          <label>
            <input
              type="radio"
              name={`notes-binary-${file.fileId}`}
              checked={file.binaryTake === 'tip'}
              disabled={!writable}
              onChange={(): void => {
                onPatch({ binaryTake: 'tip' });
              }}
            />
            Accept the deletion
          </label>
        ) : null}
        {file.headDeleted ? (
          <label>
            <input
              type="radio"
              name={`notes-binary-${file.fileId}`}
              checked={file.binaryTake === 'head'}
              disabled={!writable}
              onChange={(): void => {
                onPatch({ binaryTake: 'head' });
              }}
            />
            Accept the deletion
          </label>
        ) : null}
      </fieldset>
    </div>
  );
}

/** One attachment revision rendered from its immutable bytes. */
function AttachmentPreview({
  workspaceId,
  revisionId,
  label,
}: {
  readonly workspaceId: string;
  readonly revisionId: string;
  readonly label: string;
}): ReactNode {
  const [preview, setPreview] = useState<LoadedAttachment | null>(null);
  useEffect(() => {
    let cancelled = false;
    let loaded: LoadedAttachment | null = null;
    async function load(): Promise<void> {
      try {
        loaded = await loadAttachmentBinary(
          workspaceId,
          revisionId,
          new AbortController().signal,
        );
        if (!cancelled) setPreview(loaded);
        else loaded.dispose();
      } catch {
        if (!cancelled) setPreview(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
      loaded?.dispose();
    };
  }, [workspaceId, revisionId]);
  if (preview === null) return <span>No preview is available.</span>;
  return <img src={preview.url} alt={label} />;
}

/** Local conflicting queue entries with a retry for the branch upload. */
function PendingConflicts({
  store,
  workspaceId,
  pending,
  writable,
  onUploaded,
}: {
  readonly store: LocalStore | null;
  readonly workspaceId: string;
  readonly pending: readonly QueueEntry[];
  readonly writable: boolean;
  readonly onUploaded: (message: string) => void;
}): ReactNode {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (store === null || pending.length === 0) return null;

  /** Retries the branch upload of one conflicting entry with fresh IDs. */
  async function retry(entry: QueueEntry): Promise<void> {
    setBusyId(entry.input.mutationId);
    setError(null);
    const revisions: RevisionInput[] = [];
    for (const revision of entry.input.revisions) {
      if (revision.content.kind === 'markdown') {
        revisions.push({
          revisionId: revision.id,
          fileId: revision.fileId,
          parents: [...revision.parents],
          path: revision.path,
          deleted: revision.deleted,
          content: {
            kind: 'markdown',
            digest: revision.content.digest,
            text: revision.content.text,
          },
          clientTime: revision.clientTime,
          message: revision.message,
          restoredFrom: revision.restoredFrom,
        });
      } else {
        revisions.push({
          revisionId: revision.id,
          fileId: revision.fileId,
          parents: [...revision.parents],
          path: revision.path,
          deleted: revision.deleted,
          content: {
            kind: 'attachment',
            digest: revision.content.digest,
            attachmentObjectId: revision.content.objectId,
          },
          clientTime: revision.clientTime,
          message: revision.message,
          restoredFrom: revision.restoredFrom,
        });
      }
    }
    const result = await submitBranch({
      path: { workspaceId },
      body: {
        mutationId: generateUUID(),
        deviceId: store?.deviceId ?? 'web-device',
        conflictGroupId: generateUUID(),
        expectedHeads: { ...entry.input.expectedHeads },
        revisions,
      },
    });
    setBusyId(null);
    if (result.error !== undefined || result.data === undefined) {
      setError(
        `The branch upload did not land: ${problemMessage(result.error)}. The local work stays queued; a rejection can also mean the branch already exists, in which case resolve it above.`,
      );
      return;
    }
    onUploaded(
      `The pending work is uploaded as conflict group ${result.data.conflictGroupId}. Resolve it above.`,
    );
  }

  return (
    <section aria-labelledby="conflicts-pending-heading">
      <h2 id="conflicts-pending-heading">Pending work on this device</h2>
      <p>
        The sync engine uploads conflicting work as branches itself. These
        entries still wait here; retrying repeats an upload that never landed.
      </p>
      {error !== null ? (
        <p className="notes-status-error" role="alert">
          {error}
        </p>
      ) : null}
      <ol>
        {pending.map((entry) => (
          <li key={entry.input.mutationId}>
            {`Change ${entry.input.mutationId} touches ${Object.keys(entry.input.expectedHeads).join(', ')}.`}{' '}
            {writable ? (
              <Button
                variant="secondary"
                label={`Retry the branch upload of ${entry.input.mutationId}`}
                disabled={busyId !== null}
                onClick={() => {
                  void retry(entry);
                }}
              >
                Retry the branch upload
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
