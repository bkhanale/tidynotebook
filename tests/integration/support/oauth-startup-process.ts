/** A separate process for the OAuth startup races. */
import process from 'node:process';
import { bootstrapOwner, createApp, loadServerConfig } from '@notesapp/server';

const mode = process.argv[2];
if (mode !== 'app' && mode !== 'bootstrap')
  throw new Error('The OAuth startup process needs a mode.');

const start = new Promise<void>((accept) => {
  process.once('message', () => accept());
});
process.send?.({ kind: 'waiting' });
await start;
const config = loadServerConfig(process.env);
if (mode === 'bootstrap') {
  await bootstrapOwner({
    config,
    email: 'startup@notes.invalid',
    name: 'Startup owner',
    password: 'oauth-startup-owner-password',
  });
  process.send?.({ kind: 'ready' });
  process.disconnect?.();
} else {
  const app = await createApp(config);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === 'string')
    throw new Error('The OAuth startup process has no listening port.');
  process.send?.({
    kind: 'ready',
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
  });
  process.once('message', () => {
    void app.close().then(() => process.disconnect?.());
  });
}
