/**
 * RFC 9457 problem details for every failure that leaves the HTTP boundary.
 *
 * A problem carries a stable `code` that a client can branch on, the request
 * id, and a short explanation. It never carries note content, a secret, a
 * rejected value, or a stack trace.
 */
import type { ValidationIssue } from '@notesapp/api-contract';
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
  | 'not_found'
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
};

const titles: Readonly<Record<ProblemCode, string>> = {
  invalid_request: 'The request did not match the contract.',
  host_not_allowed: 'The Host header is not served by this deployment.',
  payload_too_large: 'The request body is larger than the configured limit.',
  unsupported_media_type: 'The request media type is not supported.',
  unauthenticated: 'The request carries no usable session or token.',
  forbidden: 'The actor may not perform this operation.',
  not_found: 'The requested resource does not exist.',
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
 * The request carries no usable session or agent token.
 *
 * The answer never says whether an address exists, whether a token was
 * revoked, or whether it expired, because all three would help an attacker.
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
 * A denied role, a denied token scope, and a denied rule such as the removal
 * of the last owner all use this failure, so an answer never discloses which
 * of the three applied.
 */
export class ForbiddenError extends Error {
  constructor(detail = 'The actor may not perform this operation.') {
    super(detail);
    this.name = 'ForbiddenError';
  }
}

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
}): Problem {
  const issues = input.issues ?? [];
  return {
    type: `https://notesapp.invalid/problems/${input.code}`,
    title: titles[input.code],
    status: input.status,
    detail: input.detail,
    instance: input.instance,
    code: input.code,
    requestId: input.requestId,
    ...(issues.length > 0 ? { issues } : {}),
  };
}

/** Status and code that an unexpected failure maps to. */
export function classifyError(error: unknown): {
  status: number;
  code: ProblemCode;
  detail: string;
  issues: readonly ValidationIssue[];
} {
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
  const code = fastifyErrorCode(error);
  if (code === 'FST_ERR_CTP_BODY_TOO_LARGE')
    return {
      status: 413,
      code: 'payload_too_large',
      detail: titles.payload_too_large,
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
