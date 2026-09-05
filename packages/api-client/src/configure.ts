/**
 * Handwritten configuration of the generated HTTP client.
 *
 * This file may set the base URL, cookie behaviour, the bearer token provider,
 * and shared error normalization. It never builds a URL, serializes a request,
 * or calls a transport. The generated client owns all of that.
 */
import { client } from './generated/client.gen.ts';
import type { ProblemDetails } from './generated/types.gen.ts';

/** Returns the current agent token, or undefined for a cookie session. */
export type TokenProvider = () => Promise<string | undefined>;

let tokenProvider: TokenProvider | undefined;
let interceptorsInstalled = false;

/** Reads one property of an unknown value without asserting its shape. */
function readProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value))[key];
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  if (Array.isArray(value)) return false;
  return (
    typeof readProperty(value, 'type') === 'string' &&
    typeof readProperty(value, 'title') === 'string' &&
    typeof readProperty(value, 'status') === 'number' &&
    typeof readProperty(value, 'code') === 'string' &&
    typeof readProperty(value, 'requestId') === 'string'
  );
}

/**
 * Converts any failure into problem details, so a caller always branches on a
 * stable `code` instead of on a transport specific error shape.
 */
export function normalizeProblem(
  error: unknown,
  response: Response | undefined,
): ProblemDetails {
  if (isProblemDetails(error)) return error;
  const aborted = error instanceof Error && error.name === 'AbortError';
  const status = response?.status ?? 0;
  return {
    type: 'about:blank',
    title: aborted
      ? 'The caller cancelled the request.'
      : (response?.statusText ?? 'The request did not reach the service.'),
    status,
    code: aborted
      ? 'request_aborted'
      : status === 0
        ? 'transport_failed'
        : 'unexpected_response',
    requestId: response?.headers.get('x-request-id') ?? '',
  };
}

/**
 * Points the generated client at one origin.
 *
 * The interceptors are installed once. Later calls only replace the base URL
 * and the token provider, so repeated configuration cannot stack handlers.
 */
export function configureClient(
  baseUrl: string,
  token: TokenProvider | undefined,
): void {
  tokenProvider = token;
  client.setConfig({ baseUrl, credentials: 'include' });
  if (interceptorsInstalled) return;
  interceptorsInstalled = true;
  client.interceptors.request.use(async (request) => {
    const value = await tokenProvider?.();
    if (value !== undefined && value !== '')
      request.headers.set('authorization', `Bearer ${value}`);
    return request;
  });
  client.interceptors.error.use((error, response) =>
    normalizeProblem(error, response),
  );
}
