/** Receipt-safe incremental edits through the existing sync contract (design 027). */
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  canonicalJson,
  requestDigest,
  type DocumentRangeEdit,
} from '@notesapp/core';
import { parseMarkdown, MarkdownLimitError } from '@notesapp/markdown';
import { createDocumentService } from '@notesapp/storage-server';
import type { ContractCall, ContractAnswer } from './registry.ts';
import {
  idSchema,
  objectSchema,
  record,
  rows,
  text,
  ToolFailure,
} from './read-support.ts';
import {
  accepted,
  maxWriteTextUnits,
  writeContract,
  writeTool,
} from './write-tools.ts';

const documents = createDocumentService();
export const maxPatchChanges = 100;
const textSchema = { type: 'string', maxLength: maxWriteTextUnits };
const anchorSchema = { ...textSchema, minLength: 1 };
const identity = { workspaceId: idSchema, fileId: idSchema, version: idSchema };
const identityKeys = ['workspaceId', 'fileId', 'version'];
const earlierMessage =
  'An earlier attempt made this change. Read the note for its current version. Do not send this change again.';
const outputSchema = {
  type: 'object' as const,
  oneOf: [
    objectSchema(
      {
        workspaceId: idSchema,
        fileId: idSchema,
        changed: { const: false },
        earlierAttempt: { const: true },
        message: { const: earlierMessage },
      },
      ['workspaceId', 'fileId', 'changed', 'earlierAttempt', 'message'],
    ),
    objectSchema(
      {
        ...identity,
        path: { type: 'string' },
        name: { type: 'string' },
        deleted: { const: false },
        changed: { const: true },
        headMoved: { type: 'boolean' },
      },
      [...identityKeys, 'path', 'name', 'deleted', 'changed', 'headMoved'],
    ),
  ],
};
class NoteStateFailure extends ToolFailure {}
function cannotSave(): never {
  throw new NoteStateFailure(
    'The text cannot be saved. Use less text or check its characters and try again.',
  );
}
/** RFC 9562 version 5, in a private namespace for MCP call identities. */
export function incrementalMutationId(
  grantId: string,
  name: string,
  input: Record<string, unknown>,
): string {
  const namespace = Buffer.from('6bb4a1578b02574097ab915e9672961c', 'hex');
  const bytes = createHash('sha1')
    .update(namespace)
    .update(canonicalJson({ grantId, name, input }))
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Reserved operation names cannot equal a commitChangeset request digest. */
export function incrementalProbe(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  return requestDigest(`mcp:${name}:receipt-probe`, {}, input);
}
async function contractBody(
  id: 'getFile' | 'commitChangeset',
  answer: ContractAnswer,
) {
  if (
    [404, 410, 413].includes(answer.status) ||
    (id === 'commitChangeset' && answer.status === 422)
  ) {
    try {
      await writeContract(async () => answer, id, {});
    } catch (error) {
      if (error instanceof ToolFailure)
        throw new NoteStateFailure(error.message);
      throw error;
    }
  }
  return writeContract(async () => answer, id, {});
}
async function readHead(input: Record<string, unknown>, call: ContractCall) {
  const params = {
    workspaceId: text(input, 'workspaceId'),
    fileId: text(input, 'fileId'),
  };
  const file = await contractBody('getFile', await call('getFile', { params }));
  if (file.head === null)
    throw new NoteStateFailure(
      'The note is not available. Read the note list and choose a note.',
    );
  const head = record(file.head);
  if (file.kind !== 'note' || head.kind !== 'note' || head.deleted !== false)
    throw new NoteStateFailure(
      'This file is not a live note. Read the note list and choose a note.',
    );
  const epoch = head.epoch;
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1)
    throw new Error('The document generation is missing.');
  const bytes = Buffer.from(text(head, 'document'), 'base64');
  const source = documents.readText(bytes);
  if (source !== text(head, 'text'))
    throw new Error('The document and text do not match.');
  return { file, head, epoch, bytes, source };
}
function exactOffset(source: string, anchor: string): number {
  const at = source.indexOf(anchor);
  if (at < 0)
    throw new NoteStateFailure(
      'The anchor is not in the note. Read the note again and choose text from the note.',
    );
  if (source.indexOf(anchor, at + 1) >= 0)
    throw new NoteStateFailure(
      'The anchor occurs more than once. Read the note again and choose text that occurs once.',
    );
  return at;
}
type MarkdownNode = {
  readonly type: string;
  readonly depth?: number | undefined;
  readonly position?:
    | {
        readonly start: { readonly offset?: number | undefined };
        readonly end: { readonly offset?: number | undefined };
      }
    | undefined;
  readonly children?: readonly MarkdownNode[] | undefined;
};
function sectionEnd(source: string, heading: string): number {
  const headings: { start: number; depth: number; line: string }[] = [];
  // Markdown offsets exclude one leading BOM. Document ranges include it.
  const bomUnits = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  function visit(node: MarkdownNode) {
    if (node.type === 'heading' && node.depth !== undefined) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined)
        throw new Error('The heading position is missing.');
      const sourceStart = start + bomUnits;
      const sourceEnd = end + bomUnits;
      // A Markdown line can end with LF, CRLF or CR. Keep its original
      // prefix, but exclude the initial BOM from the exact heading match.
      let lineStart = sourceStart;
      while (
        lineStart > bomUnits &&
        source[lineStart - 1] !== '\n' &&
        source[lineStart - 1] !== '\r'
      )
        lineStart -= 1;
      headings.push({
        start: lineStart,
        depth: node.depth,
        line: source.slice(lineStart, sourceEnd),
      });
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(parseMarkdown(source));
  const matches = headings.filter((item) => item.line === heading);
  const match = matches[0];
  if (match === undefined || matches.length !== 1)
    throw new NoteStateFailure(
      'The heading must occur once. Read the note again and choose one heading.',
    );
  return (
    headings.find(
      (item) => item.start > match.start && item.depth <= match.depth,
    )?.start ?? source.length
  );
}
function appendRanges(
  input: Record<string, unknown>,
  source: string,
): DocumentRangeEdit[] {
  const offset =
    typeof input.heading === 'string'
      ? sectionEnd(source, input.heading)
      : source.length;
  let value = text(input, 'text');
  if (offset > 0 && !/[\r\n]$/.test(source.slice(0, offset)))
    value = `\n${value}`;
  if (offset < source.length && !/[\r\n]$/.test(value)) value += '\n';
  return [{ offset, length: 0, text: value }];
}
function patchRanges(
  input: Record<string, unknown>,
  source: string,
): DocumentRangeEdit[] {
  return rows(input, 'changes').map((change) => {
    const operation = text(change, 'operation');
    const value = text(change, 'text');
    if (operation === 'insert_at_start')
      return { offset: 0, length: 0, text: value };
    if (operation === 'insert_at_end')
      return { offset: source.length, length: 0, text: value };
    const anchor = text(change, 'anchor');
    const at = exactOffset(source, anchor);
    return {
      offset: operation === 'insert_after' ? at + anchor.length : at,
      length: operation === 'replace' ? anchor.length : 0,
      text: value,
    };
  });
}
function incrementalTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  ranges: (
    input: Record<string, unknown>,
    source: string,
  ) => DocumentRangeEdit[],
) {
  return writeTool(
    {
      name,
      description,
      inputSchema: objectSchema({ ...identity, ...properties }, [
        ...identityKeys,
        ...required,
      ]),
      outputSchema,
    },
    ['getMutationReceipt', 'getFile', 'commitChangeset'],
    async (input, call, grantId) => {
      if (grantId === undefined)
        throw new Error('The grant identity is missing.');
      const workspaceId = text(input, 'workspaceId');
      const fileId = text(input, 'fileId');
      const mutationId = incrementalMutationId(grantId, name, input);
      const probe = await incrementalProbe(name, input);
      const earlier = {
        workspaceId,
        fileId,
        changed: false,
        earlierAttempt: true,
        message: earlierMessage,
      };
      async function wasAccepted() {
        const receipt = await writeContract(call, 'getMutationReceipt', {
          params: { workspaceId, mutationId },
          query: { digest: probe },
        });
        if (
          !['absent', 'other_request', 'accepted'].includes(
            text(receipt, 'status'),
          )
        )
          throw new Error('The receipt state is missing.');
        return receipt.status !== 'absent';
      }
      if (await wasAccepted()) return earlier;
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const head = await readHead(input, call);
          let edits: DocumentRangeEdit[];
          try {
            edits = ranges(input, head.source);
          } catch (error) {
            if (error instanceof MarkdownLimitError) cannotSave();
            throw error;
          }
          const written = documents.editRanges(head.bytes, edits);
          if (!written.ok) {
            if (written.error.code === 'invalid_content')
              throw new NoteStateFailure(
                'The changes overlap or split a character, or their text is not valid. Read the note again and use separate ranges and complete characters.',
              );
            cannotSave();
          }
          const version = text(head.head, 'revisionId');
          const answer = await call('commitChangeset', {
            params: { workspaceId },
            body: {
              mutationId,
              deviceId: 'mcp',
              expectedHeads: { [fileId]: version },
              revisions: [
                {
                  revisionId: randomUUID(),
                  fileId,
                  parents: [version],
                  path: text(head.file, 'path'),
                  deleted: false,
                  clientTime: new Date().toISOString(),
                  content: {
                    kind: 'markdown',
                    document: {
                      update: Buffer.from(
                        documents.delta(
                          written.value.bytes,
                          documents.stateVector(head.bytes),
                        ),
                      ).toString('base64'),
                      epoch: head.epoch,
                      observed: Buffer.from(
                        documents.observe(head.bytes),
                      ).toString('base64'),
                    },
                  },
                },
              ],
            },
          });
          if (answer.status === 409) {
            const code = record(answer.body).code;
            if (code === 'mutation_reused') return earlier;
            if (code === 'epoch_mismatch' && attempt === 0) continue;
          }
          const body = await contractBody('commitChangeset', answer);
          const revisions = rows(body, 'revisions');
          const revision = revisions[0];
          if (
            revision === undefined ||
            revisions.length !== 1 ||
            revision.fileId !== fileId ||
            revision.deleted !== false
          )
            throw new Error('The accepted revision is missing.');
          return {
            ...accepted(workspaceId, { revision }),
            headMoved:
              version !== text(input, 'version') ||
              (Array.isArray(body.superseded) && body.superseded.length > 0),
          };
        }
        throw new Error('The bounded edit did not end.');
      } catch (error) {
        if (error instanceof NoteStateFailure && (await wasAccepted()))
          return earlier;
        throw error;
      }
    },
  );
}
const append = incrementalTool(
  'append_to_note',
  'Append whole lines to a note or a section named by its exact Markdown heading line. The version identifies the call, not a write condition. Concurrent text merges. The same input and version through this grant write once. Each accepted call creates one History version. Read the note for the current version after an earlier-attempt answer.',
  { text: textSchema, heading: anchorSchema },
  ['text'],
  appendRanges,
);
const patch = incrementalTool(
  'patch_note',
  'Apply up to 100 exact text changes in one History version. Each anchor must occur once, including overlapping matches. All anchors refer to the note before the patch. Overlapping ranges and equal insert points refuse. No line breaks are added. Concurrent inserted characters survive, but their order and Markdown structure are not guaranteed. The version identifies the call. Use the returned version to repeat the same change on purpose.',
  {
    changes: {
      type: 'array',
      minItems: 1,
      maxItems: maxPatchChanges,
      items: {
        oneOf: [
          ...['insert_before', 'insert_after', 'replace'].map((operation) =>
            objectSchema(
              {
                operation: { const: operation },
                anchor: anchorSchema,
                text: textSchema,
              },
              ['operation', 'anchor', 'text'],
            ),
          ),
          ...['insert_at_start', 'insert_at_end'].map((operation) =>
            objectSchema(
              { operation: { const: operation }, text: textSchema },
              ['operation', 'text'],
            ),
          ),
        ],
      },
    },
  },
  ['changes'],
  patchRanges,
);
export const incrementalTools = [append, patch];
