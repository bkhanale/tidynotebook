/** Checks of the addresses that a browser reads itself (record 0178). */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browserAddressExtension,
  emitAddressModule,
  readBrowserAddresses,
} from './addresses.ts';

/** A document of one path item with the given operation under `method`. */
function documentOf(
  method: string,
  operation: Record<string, unknown>,
  path = '/api/workspaces/{workspaceId}/export',
): Record<string, unknown> {
  return {
    openapi: '3.1.2',
    paths: {
      [path]: {
        [method]: { operationId: 'exportWorkspace', ...operation },
      },
    },
  };
}

const workspaceParameter = {
  name: 'workspaceId',
  in: 'path',
  required: true,
};

await test('a marked GET gets a typed builder of its address', () => {
  // Issue 243. A browser without the File System Access API held the whole
  // export in a blob, because feature code may write no request URL and the
  // client named an address only inside a request.
  const addresses = readBrowserAddresses(
    documentOf('get', {
      [browserAddressExtension]: true,
      parameters: [
        workspaceParameter,
        { name: 'x-request-id', in: 'header', required: false },
      ],
    }),
  );
  assert.deepEqual(addresses, [
    {
      id: 'exportWorkspace',
      path: '/api/workspaces/{workspaceId}/export',
      pathParameters: ['workspaceId'],
    },
  ]);
  const module = emitAddressModule(addresses);
  assert.match(
    module,
    /export function exportWorkspaceAddress\(path: \{ readonly workspaceId: string \}\): string \{/,
  );
  assert.ok(
    module.includes(
      // The path comes from the contract, and each parameter is encoded.
      "`${client.getConfig().baseUrl ?? ''}/api/workspaces/${segment(path.workspaceId)}/export`",
    ),
  );
});

await test('an operation without the mark gets no builder', () => {
  assert.deepEqual(readBrowserAddresses(documentOf('get', {})), []);
  assert.doesNotMatch(emitAddressModule([]), /client|function/);
});

await test('the mark is refused where a browser could not send the request', () => {
  assert.throws(
    () =>
      readBrowserAddresses(
        documentOf('post', { [browserAddressExtension]: true }),
      ),
    /exportWorkspace is a POST/,
  );
  assert.throws(
    () =>
      readBrowserAddresses(
        documentOf('get', {
          [browserAddressExtension]: true,
          requestBody: { content: {} },
        }),
      ),
    /takes a request body/,
  );
  assert.throws(
    () =>
      readBrowserAddresses(
        documentOf('get', {
          [browserAddressExtension]: true,
          parameters: [
            workspaceParameter,
            { name: 'if-match', in: 'header', required: true },
          ],
        }),
      ),
    /requires header if-match/,
  );
  assert.throws(
    () =>
      readBrowserAddresses(
        documentOf('get', { [browserAddressExtension]: 'yes' }),
      ),
    /other than true/,
  );
});
