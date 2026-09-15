/**
 * Parsers for the union columns of an attachment row.
 *
 * The media type and the state of an attachment object are domain unions, but
 * the columns that hold them are text. Nothing in the column type proves that
 * a row still names a member of its union: an older writer, a manual repair,
 * or a removed member can leave a value that the domain never declared.
 *
 * A row like that is a defect of a writer, not an expected refusal, so each
 * parser throws `OperationalError`. The request then fails with one server
 * problem, and no undeclared value reaches the domain.
 */
import {
  isAllowedMediaType,
  isAttachmentState,
  OperationalError,
  type AttachmentMediaType,
  type AttachmentState,
} from '@notesapp/core';

/** The media type of one stored attachment row, or a refusal. */
export function storedMediaType(value: string): AttachmentMediaType {
  if (isAllowedMediaType(value)) return value;
  throw new OperationalError(
    'unexpected',
    'notesapp: a stored attachment object names a media type that the domain does not accept.',
  );
}

/** The state of one stored attachment row, or a refusal. */
export function storedAttachmentState(value: string): AttachmentState {
  if (isAttachmentState(value)) return value;
  throw new OperationalError(
    'unexpected',
    'notesapp: a stored attachment object names a state that the domain does not declare.',
  );
}
