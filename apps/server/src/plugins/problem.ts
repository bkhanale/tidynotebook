/**
 * RFC 9457 problem details for every failure that leaves the HTTP boundary.
 *
 * A problem carries a stable `code` that a client can branch on, the request
 * id, and a short explanation. It never carries note content, a secret, a
 * rejected value, or a stack trace.
 */
import type { ValidationIssue } from '@notesapp/api-contract';
import type { DomainError, DomainErrorCode } from '@notesapp/core';
import {
  markdownLimitCode,
  WorkspaceUnavailableError,
} from '@notesapp/storage-server';
import { readProperty } from '../values.ts';

/** Media type of every error response. */
export const problemMediaType = 'application/problem+json';

/** Stable application error codes. Add a code, never reuse one. */
export type ProblemCode =
  | 'invalid_request'
  | 'host_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'unauthenticated'
  | 'forbidden'
  | 'origin_required'
  | 'not_found'
  | 'stale_head'
  | 'path_conflict'
  | 'mutation_reused'
  | 'purged'
  | 'snapshot_required'
  | 'precondition_required'
  | 'invalid_path'
  | 'invalid_graph'
  | 'invalid_content'
  | 'unrenderable_note'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'route_not_found'
  | 'not_ready'
  | 'invalid_response'
  | 'internal_error';

/** Problem details body. Extra members are permitted by RFC 9457. */
export type Problem = {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly code: ProblemCode;
  readonly requestId: string;
  readonly issues?: readonly ValidationIssue[];
  /** Files that a content failure refers to. Identifiers only. */
  readonly fileIds?: readonly string[];
};

const titles: Readonly<Record<ProblemCode, string>> = {
  invalid_request: 'The request did not match the contract.',
  host_not_allowed: 'The Host header is not served by this deployment.',
  payload_too_large: 'The request body is larger than the configured limit.',
  unsupported_media_type: 'The request media type is not supported.',
  unauthenticated: 'The request carries no usable session or token.',
  forbidden: 'The actor may not perform this operation.',
  origin_required:
    'A cookie authenticated write must name the configured origin.',
  not_found: 'The requested resource does not exist.',
  stale_head: 'The accepted head of a file has moved on.',
  path_conflict: 'Another live file already holds that path.',
  mutation_reused:
    'That mutation identity was already used for another operation.',
  purged: 'The file was permanently deleted and cannot be written again.',
  snapshot_required:
    'The snapshot expired or the cursor predates the retained window. Start a fresh snapshot.',
  precondition_required: 'The operation needs a precondition.',
  invalid_path: 'The path does not follow the workspace path rules.',
  invalid_graph: 'The submitted revisions are not a valid change.',
  invalid_content: 'The submitted content does not match its digest.',
  unrenderable_note: 'The note cannot be read as Markdown.',
  quota_exceeded: 'The workspace has no room left for new content.',
  rate_limited: 'Too many attempts were made in a short time.',
  route_not_found: 'No operation serves this method and path.',
  not_ready: 'The service cannot accept traffic yet.',
  invalid_response: 'The service produced a response outside the contract.',
  internal_error: 'The service failed to complete the request.',
};

/** Request contract failure raised by the boundary validator. */
export class RequestContractError extends Error {
  readonly slot: string;
  readonly issues: readonly ValidationIssue[];

  constructor(slot: string, issues: readonly ValidationIssue[]) {
    super(`The ${slot} of the request did not match the contract.`);
    this.name = 'RequestContractError';
    this.slot = slot;
    this.issues = issues;
  }
}

/** Request body media type that the operation does not accept. */
export class RequestMediaTypeError extends Error {
  readonly accepted: string;

  constructor(accepted: string) {
    super(`This operation accepts only ${accepted} request bodies.`);
    this.name = 'RequestMediaTypeError';
    this.accepted = accepted;
  }
}

/**
 * The request carries no usable session.
 *
 * The answer never says whether an address exists or whether the session
 * expired, because both would help an attacker.
 */
export class UnauthenticatedError extends Error {
  constructor(detail = 'Sign in before calling this operation.') {
    super(detail);
    this.name = 'UnauthenticatedError';
  }
}

/**
 * The actor is known but may not perform the operation.
 *
 * A denied role and a denied rule such as the removal of the last owner both
 * use this failure, so an answer never discloses which of the two applied.
 */
export class ForbiddenError extends Error {
  constructor(detail = 'The actor may not perform this operation.') {
    super(detail);
    this.name = 'ForbiddenError';
  }
}

/**
 * A cookie authenticated write that names no origin.
 *
 * A browser always sends `Origin` or `Sec-Fetch-Site` on a write. A request
 * with neither did not come from a browser page.
 */
export class OriginRequiredError extends Error {
  constructor(
    detail = 'A cookie authenticated write must name the configured origin.',
  ) {
    super(detail);
    this.name = 'OriginRequiredError';
  }
}

/**
 * A precondition that the operation needs, and the request did not carry.
 *
 * A write of an existing file needs the entity tag of the head that the client
 * read. Without it the server would have to guess, and a lost update would
 * follow, so the request is answered with 428 and repeated with the tag.
 */
export class PreconditionRequiredError extends Error {
  constructor(detail = 'The operation needs a precondition.') {
    super(detail);
    this.name = 'PreconditionRequiredError';
  }
}

/**
 * A payload that exceeds the configured size or pixel limit.
 */
export class PayloadTooLargeError extends Error {
  constructor(detail = titles.payload_too_large) {
    super(detail);
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * A media type that the operation does not accept.
 */
export class UnsupportedMediaTypeError extends Error {
  constructor(detail = titles.unsupported_media_type) {
    super(detail);
    this.name = 'UnsupportedMediaTypeError';
  }
}

/**
 * Submitted content that is invalid or malformed.
 */
export class InvalidContentError extends Error {
  readonly fileIds: readonly string[];

  constructor(
    detail = titles.invalid_content,
    fileIds: readonly string[] = [],
  ) {
    super(detail);
    this.name = 'InvalidContentError';
    this.fileIds = fileIds;
  }
}

/**
 * An expected outcome of a content operation, on its way out of the boundary.
 *
 * The core returns a `DomainError` rather than throwing one. A handler that
 * cannot continue turns it into this error, so the mapping from a domain code
 * to a status and a problem code lives in one table below.
 */
export class DomainProblemError extends Error {
  readonly domain: DomainError;

  constructor(error: DomainError) {
    super(domainTitles[error.code]);
    this.name = 'DomainProblemError';
    this.domain = error;
  }
}

/**
 * The status and the problem code of every domain failure.
 *
 * The statuses follow RFC 9110: a failed precondition is 412, a state that
 * cannot hold both values is 409, a permanently removed record is 410, a well
 * formed request whose content cannot be accepted is 422, and a workspace
 * without room answers 413 like any other body that is too large for the
 * limit.
 */
const domainStatus: Readonly<
  Record<DomainErrorCode, { status: number; code: ProblemCode }>
> = {
  forbidden: { status: 403, code: 'forbidden' },
  not_found: { status: 404, code: 'not_found' },
  stale_head: { status: 412, code: 'stale_head' },
  path_conflict: { status: 409, code: 'path_conflict' },
  mutation_reused: { status: 409, code: 'mutation_reused' },
  purged: { status: 410, code: 'purged' },
  snapshot_required: { status: 410, code: 'snapshot_required' },
  unsupported_version: { status: 400, code: 'invalid_request' },
  invalid_path: { status: 422, code: 'invalid_path' },
  invalid_graph: { status: 422, code: 'invalid_graph' },
  invalid_content: { status: 422, code: 'invalid_content' },
  note_too_large: { status: 422, code: 'unrenderable_note' },
  note_too_deep: { status: 422, code: 'unrenderable_note' },
  quota: { status: 413, code: 'quota_exceeded' },
};

/** The explanation of one domain failure. It names no path and no content. */
const domainTitles: Readonly<Record<DomainErrorCode, string>> = {
  forbidden: 'The actor may not perform this operation.',
  not_found: 'The requested resource does not exist.',
  stale_head:
    'The accepted head of a file has moved on. Read it again and resolve the difference.',
  path_conflict: 'Another live file already holds one of the requested paths.',
  mutation_reused:
    'That mutation identity was already used for another operation.',
  purged:
    'The file was permanently deleted, so this identifier can never be written again.',
  snapshot_required:
    'The snapshot expired or the cursor predates the retained window. Start a fresh snapshot and keep local work.',
  unsupported_version:
    'The requested sync protocol version is not served. No data was changed.',
  invalid_path: 'A submitted path does not follow the workspace path rules.',
  invalid_graph:
    'The submitted revisions are not a valid change of the stored history.',
  invalid_content: 'Submitted content does not match its declared digest.',
  note_too_large: 'This note is too large to render.',
  note_too_deep: 'This note nests too deeply to render.',
  quota: 'The workspace has no room left for new content.',
};

/** The named resource does not exist, or the actor may not see that it does. */
export class NotFoundError extends Error {
  constructor(detail = 'The requested resource does not exist.') {
    super(detail);
    this.name = 'NotFoundError';
  }
}

/**
 * Response contract failure. The invalid body is dropped here on purpose, so
 * the failure cannot leak the content that the contract rejected.
 */
export class ResponseContractError extends Error {
  readonly status: number;
  readonly mediaType: string;

  constructor(status: number, mediaType: string) {
    super(
      `The service produced a ${String(status)} ${mediaType} response that the contract does not allow.`,
    );
    this.name = 'ResponseContractError';
    this.status = status;
    this.mediaType = mediaType;
  }
}

/** Builds a problem body. */
export function createProblem(input: {
  readonly code: ProblemCode;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly requestId: string;
  readonly issues?: readonly ValidationIssue[];
  readonly fileIds?: readonly string[];
}): Problem {
  const issues = input.issues ?? [];
  const fileIds = input.fileIds ?? [];
  return {
    type: `https://notesapp.invalid/problems/${input.code}`,
    title: titles[input.code],
    status: input.status,
    detail: input.detail,
    instance: input.instance,
    code: input.code,
    requestId: input.requestId,
    ...(issues.length > 0 ? { issues } : {}),
    ...(fileIds.length > 0 ? { fileIds } : {}),
  };
}

/** Status and code that an unexpected failure maps to. */
export function classifyError(error: unknown): {
  status: number;
  code: ProblemCode;
  detail: string;
  issues: readonly ValidationIssue[];
  fileIds?: readonly string[];
} {
  if (error instanceof DomainProblemError) {
    const mapped = domainStatus[error.domain.code];
    return {
      status: mapped.status,
      code: mapped.code,
      detail: domainTitles[error.domain.code],
      issues: [],
      ...(error.domain.fileIds.length > 0
        ? { fileIds: error.domain.fileIds }
        : {}),
    };
  }
  // A Markdown limit that no use case turned into a `Result` still answers
  // with the message for the author rather than with a server fault.
  const refused = markdownLimitCode(error);
  if (refused !== null) {
    const mapped = domainStatus[refused];
    return {
      status: mapped.status,
      code: mapped.code,
      detail: domainTitles[refused],
      issues: [],
    };
  }
  if (error instanceof PreconditionRequiredError)
    return {
      status: 428,
      code: 'precondition_required',
      detail: error.message,
      issues: [],
    };
  // A workspace that the actor cannot see and a workspace that does not exist
  // answer the same way, so the answer never discloses that it exists.
  if (error instanceof WorkspaceUnavailableError)
    return {
      status: 404,
      code: 'not_found',
      detail: titles.not_found,
      issues: [],
    };
  if (error instanceof RequestContractError)
    return {
      status: 400,
      code: 'invalid_request',
      detail: error.message,
      issues: error.issues,
    };
  if (error instanceof ResponseContractError)
    return {
      status: 500,
      code: 'invalid_response',
      detail: titles.invalid_response,
      issues: [],
    };
  if (error instanceof UnauthenticatedError)
    return {
      status: 401,
      code: 'unauthenticated',
      detail: error.message,
      issues: [],
    };
  if (error instanceof ForbiddenError)
    return {
      status: 403,
      code: 'forbidden',
      detail: error.message,
      issues: [],
    };
  if (error instanceof OriginRequiredError)
    return {
      status: 403,
      code: 'origin_required',
      detail: error.message,
      issues: [],
    };
  if (error instanceof NotFoundError)
    return {
      status: 404,
      code: 'not_found',
      detail: error.message,
      issues: [],
    };
  if (error instanceof RequestMediaTypeError)
    return {
      status: 415,
      code: 'unsupported_media_type',
      detail: error.message,
      issues: [],
    };
  if (error instanceof UnsupportedMediaTypeError)
    return {
      status: 415,
      code: 'unsupported_media_type',
      detail: error.message,
      issues: [],
    };
  if (error instanceof PayloadTooLargeError)
    return {
      status: 413,
      code: 'payload_too_large',
      detail: error.message,
      issues: [],
    };
  if (error instanceof InvalidContentError)
    return {
      status: 422,
      code: 'invalid_content',
      detail: error.message,
      issues: [],
      ...(error.fileIds !== undefined ? { fileIds: error.fileIds } : {}),
    };
  const code = fastifyErrorCode(error);
  if (readProperty(error, 'statusCode') === 429)
    return {
      status: 429,
      code: 'rate_limited',
      detail: titles.rate_limited,
      issues: [],
    };
  if (code === 'FST_ERR_CTP_BODY_TOO_LARGE')
    return {
      status: 413,
      code: 'payload_too_large',
      detail: titles.payload_too_large,
      issues: [],
    };
  // A request that declares a JSON body and sends none, which a client can do
  // by setting a content type on a DELETE, is a malformed request rather than
  // a server fault.
  if (
    code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
    code === 'FST_ERR_CTP_INVALID_JSON_BODY'
  )
    return {
      status: 400,
      code: 'invalid_request',
      detail:
        'The request declares a JSON body but carries none, or carries one that is not JSON.',
      issues: [],
    };
  if (
    code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ||
    code === 'FST_ERR_CTP_EMPTY_TYPE'
  )
    return {
      status: 415,
      code: 'unsupported_media_type',
      detail: titles.unsupported_media_type,
      issues: [],
    };
  return {
    status: 500,
    code: 'internal_error',
    detail: titles.internal_error,
    issues: [],
  };
}

function fastifyErrorCode(error: unknown): string {
  const value = readProperty(error, 'code');
  return typeof value === 'string' ? value : '';
}
