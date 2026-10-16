import assert from 'node:assert/strict';
import test from 'node:test';
import { INVALID_REQUEST, ProtocolError } from '@modelcontextprotocol/server';
import type { OAuthTokenIdentity } from '@notesapp/storage-server';
import { createToolHandler } from './protocol.ts';
import type { McpTool } from './registry.ts';

const grant: OAuthTokenIdentity = {
  accountId: '00000000-0000-4000-8000-000000000001',
  authUserId: 'test-user',
  standing: 'active',
  grantId: 'test-grant',
  scopes: ['notes:read'],
};

await test('the exact registered handler refuses a write before tool or contract execution', async () => {
  let executions = 0;
  let contractCalls = 0;
  const tool: McpTool = {
    definition: { name: 'test_write', inputSchema: { type: 'object' } },
    scope: 'notes:write',
    operations: ['listWorkspaces'],
    run: async (_input, context) => {
      executions += 1;
      await context.call('listWorkspaces');
      return { content: [] };
    },
  };
  const handler = createToolHandler(grant, [tool], () => {
    contractCalls += 1;
    return Promise.resolve({ status: 200, body: {} });
  });
  await assert.rejects(
    handler({
      method: 'tools/call',
      params: { name: 'test_write', arguments: {} },
    }),
    (error: unknown) =>
      error instanceof ProtocolError && error.code === INVALID_REQUEST,
  );
  assert.equal(executions, 0);
  assert.equal(contractCalls, 0);
});

await test('all registered note handlers send no notification before or with their result', async (t) => {
  const { InMemoryTransport } = await import('@modelcontextprotocol/server');
  const { createMcpServer } = await import('./protocol.ts');
  const { mcpTools } = await import('./registry.ts');
  const { randomUUID } = await import('node:crypto');
  const workspaceId = randomUUID();
  const fileId = randomUUID();
  const version = randomUUID();
  const { createDocumentService } = await import('@notesapp/storage-server');
  const documents = createDocumentService();
  const bytes = documents.start('Text');
  for (const tool of mcpTools)
    await t.test(tool.definition.name, async () => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const done = Promise.withResolvers<void>();
      const messages: unknown[] = [];
      let calls = 0;
      const server = createMcpServer(
        { ...grant, scopes: ['notes:read', 'notes:write'] },
        [
          {
            ...tool,
            run: (input, context) => {
              assert.deepEqual(Object.keys(context), ['call', 'grantId']);
              assert.equal(Object.isFrozen(context), true);
              return tool.run(input, context);
            },
          },
        ],
        async (id) => {
          calls += 1;
          entered.resolve();
          await release.promise;
          return {
            status: id === 'createFile' ? 201 : 200,
            body: {
              status: 'other_request',
              workspaces: [],
              files: [],
              hits: [],
              backlinks: [],
              revisions: [],
              nextCursor: null,
              fileId,
              path: 'Note.md',
              kind: 'note',
              revision: {
                fileId,
                path: 'Note.md',
                revisionId: randomUUID(),
                deleted: id === 'deleteFile',
              },
              head: {
                fileId,
                path: 'Note.md',
                revisionId: version,
                kind: 'note',
                deleted: false,
                text: 'Text',
                epoch: 1,
                document: Buffer.from(bytes).toString('base64'),
              },
            },
          };
        },
      );
      const [client, transport] = InMemoryTransport.createLinkedPair();
      client.onmessage = (message) => {
        messages.push(message);
        if ('id' in message && message.id === 2) done.resolve();
      };
      try {
        await server.connect(transport);
        await client.start();
        const initialized = Promise.withResolvers<void>();
        const receive = client.onmessage;
        client.onmessage = (message) => {
          if ('id' in message && message.id === 1) initialized.resolve();
          else receive(message);
        };
        await client.send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'unit', version: '1' },
          },
        });
        await initialized.promise;
        await client.send({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        });
        const input =
          tool.definition.name === 'list_workspaces'
            ? {}
            : tool.definition.name === 'list_notes'
              ? { workspaceId }
              : tool.definition.name === 'search_notes'
                ? { query: 'find' }
                : tool.definition.name === 'create_note'
                  ? { workspaceId, path: 'New.md', text: 'New' }
                  : ['edit_note', 'append_to_note'].includes(
                        tool.definition.name,
                      )
                    ? { workspaceId, fileId, version, text: 'New' }
                    : tool.definition.name === 'patch_note'
                      ? {
                          workspaceId,
                          fileId,
                          version,
                          changes: [
                            { operation: 'insert_at_end', text: 'New' },
                          ],
                        }
                      : tool.definition.name === 'move_note'
                        ? { workspaceId, fileId, version, path: 'Moved.md' }
                        : tool.definition.name === 'move_note_to_trash'
                          ? { workspaceId, fileId, version }
                          : { workspaceId, fileId };
        await client.send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: tool.definition.name,
            arguments: input,
            _meta: {
              progressToken: 'progress-test',
              'io.modelcontextprotocol/logLevel': 'debug',
            },
          },
        });
        await Promise.race([
          entered.promise,
          done.promise.then(() => {
            throw new Error('The real tool did not start a contract call.');
          }),
        ]);
        assert.equal(
          messages.length,
          0,
          'A held contract call must send no progress or logging notification.',
        );
        release.resolve();
        await done.promise;
        assert.ok(calls > 0);
        assert.equal(messages.length, 1);
        const message = messages[0];
        assert.ok(
          message && typeof message === 'object' && 'result' in message,
        );
        assert.ok(message.result && typeof message.result === 'object');
        assert.equal(Reflect.get(message.result, 'isError'), undefined);
        assert.equal(
          'method' in message,
          false,
          'Only the result can leave the registered handler.',
        );
      } finally {
        release.resolve();
        await server.close();
        await client.close();
      }
    });
});
