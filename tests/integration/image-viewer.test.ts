/**
 * The image viewer of a note, as the build emits it and the server serves it
 * (record 0145).
 *
 * No test here drives a browser (record 0066). The rules of the viewer live in
 * `apps/web/src/lib/image-viewer.ts` and the view model of the picture in
 * `packages/editor/src/widgets.ts`, and their unit tests hold them. This file
 * holds the rest: the built editor makes a picture a control only through the
 * resolver of the note screen, the built screen gives that resolver the
 * viewer, the viewer reads every rule from the one module, and the server
 * serves the viewer, its words and its classes to a browser.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './support/server.ts';

const root = resolve(fileURLToPath(import.meta.url), '../../..');
const webDist = resolve(root, 'apps/web/dist/web');

/** Reads one emitted module of the web application. */
async function built(path: string): Promise<string> {
  return readFile(resolve(root, 'apps/web/dist', path), 'utf8');
}

await test('the built editor makes a picture a control only for a host with a viewer', async () => {
  const widgets = await import('../../packages/editor/dist/widgets.js');
  const region = {
    from: 0,
    to: 40,
    kind: 'image',
    source: '![Floor plan](https://pictures.example/plan.png)',
    content: 'Floor plan',
    destination: 'https://pictures.example/plan.png',
    block: true,
  } as const;
  const plain = widgets.widgetView(region, {});
  const openable = widgets.widgetView(region, { onOpenImage: () => undefined });
  assert.equal(plain.kind, 'image');
  assert.equal(openable.kind, 'image');
  if (plain.kind === 'image') assert.equal(plain.openLabel, null);
  if (openable.kind === 'image')
    assert.equal(openable.openLabel, 'Open image: Floor plan');
});

await test('the built note screen hands its pictures to the viewer', async () => {
  const editor = await built('features/editor/note-editor.js');
  assert.match(editor, /onOpenImage: setOpenImage/);
  assert.match(editor, /ImageViewer/);
});

await test('the built viewer reads every rule from the one module', async () => {
  // The screen holds no rule of its own: the fit, the zoom, the tap that
  // closes, the actions and the download name all come from the pure module
  // that the unit tests hold.
  const viewer = await built('features/editor/image-viewer.js');
  for (const rule of [
    'fitZoom(',
    'lowestZoom(',
    'zoomIn(',
    'zoomOut(',
    'wheelZoom(',
    'zoomKey(',
    'closesOnRelease(',
    'imageActions(',
    'actionNeedsPicture(',
    'imageDownloadName(',
  ])
    assert.ok(viewer.includes(rule), rule);
  // The picture stands on the scrim, with no panel of its own.
  assert.match(viewer, /width: "screen"/);
  // A copy asks the clipboard before it draws the picture.
  assert.ok(
    viewer.indexOf('canCopyImage()') <
      viewer.indexOf('copyPngImage(pngOf(picture))'),
  );
  const rules = await import('../../apps/web/dist/lib/image-viewer.js');
  assert.deepEqual(rules.imageActions(false), ['copy-image', 'download']);
  assert.deepEqual(rules.imageActions(true), ['copy-link', 'open']);
});

await test('the server serves the viewer, its words and its classes', async () => {
  const server = await startTestServer({ webDist });
  try {
    const shell = await server.app.inject({ method: 'GET', url: '/' });
    assert.equal(shell.statusCode, 200);
    const policy = String(shell.headers['content-security-policy']);
    // The viewer shows the blob address of a picture of the workspace and the
    // HTTPS address of a picture of another host, and it reads no bytes over
    // the network: Download saves the shown address and Copy image draws the
    // shown picture.
    assert.match(policy, /img-src 'self' blob: data: https:/);
    assert.match(policy, /connect-src 'self'(;|$)/);

    const names = await readdir(resolve(webDist, 'assets'));
    const served = async (suffix: string): Promise<string> => {
      const bodies = await Promise.all(
        names
          .filter((name) => name.endsWith(suffix))
          .map(async (name) => {
            const answer = await server.app.inject({
              method: 'GET',
              url: `/assets/${name}`,
            });
            assert.equal(answer.statusCode, 200, name);
            return answer.body;
          }),
      );
      return bodies.join('\n');
    };
    const scripts = await served('.js');
    for (const words of [
      'cm-np-widget-image-open',
      'Copy image',
      'Open original',
      'The image is on the clipboard.',
      'This browser cannot copy the image. Use Download.',
    ])
      assert.ok(scripts.includes(words), words);
    const styles = await served('.css');
    for (const name of [
      '.bg-scrim\\/80',
      '.cursor-grab',
      '.active\\:cursor-grabbing',
      '.shadow-overlay',
    ])
      assert.ok(styles.includes(name), name);
  } finally {
    await server.close();
  }
});
