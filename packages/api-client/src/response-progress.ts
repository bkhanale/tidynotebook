/** Received data of a generated operation, without a timing or retry rule. */
type ResponseObserver = { readonly received: () => void; active: boolean };

const observers = new WeakMap<AbortSignal, ResponseObserver>();

/** A response body ended in transport before the generated parser ran. */
export class ResponseReadError extends Error {
  constructor(cause: unknown) {
    super('The response body stopped before it was complete.', { cause });
    this.name = 'ResponseReadError';
  }
}

/** Watches one operation signal until its caller removes the observer. */
export function observeResponseProgress(
  signal: AbortSignal,
  received: () => void,
): () => void {
  const observer = { received, active: true };
  observers.set(signal, observer);
  return () => {
    observer.active = false;
    if (observers.get(signal) === observer) observers.delete(signal);
  };
}

/** The generated response hook reports headers and each nonempty body chunk. */
export function responseWithProgress(
  response: Response,
  signal: AbortSignal | null | undefined,
): Response {
  const observer = signal == null ? undefined : observers.get(signal);
  if (observer === undefined) return response;
  const received = (): void => {
    if (observer.active) observer.received();
  };
  received();
  if (response.body === null) return response;
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          reader.releaseLock();
        } else {
          if (chunk.value.byteLength > 0) received();
          controller.enqueue(chunk.value);
        }
      } catch (error: unknown) {
        controller.error(new ResponseReadError(error));
        reader.releaseLock();
      }
    },
    async cancel(reason: unknown) {
      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
      }
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
