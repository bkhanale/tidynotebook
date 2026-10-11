/** Read notices and source archives from the real runner image. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const run = promisify(execFile);
const image = process.env['NOTESAPP_IMAGE'] || 'notesapp:latest';

await test('the runner carries full notices and its exact build source', async () => {
  const script = String.raw`
    import assert from 'node:assert/strict';
    import {readFileSync} from 'node:fs';
    import {createHash} from 'node:crypto';
    import {execFileSync} from 'node:child_process';
    import {createRequire} from 'node:module';
    import {dirname,join} from 'node:path';
    const license=readFileSync('/app/LICENSE','utf8');
    assert.match(license,/GNU AFFERO GENERAL PUBLIC LICENSE/);
    assert.equal(readFileSync('/app/licenses/LICENSE','utf8'),license);
    assert.match(readFileSync('/app/licenses/THIRD-PARTY-NOTICES.txt','utf8'),/sharp@/);
    assert.match(readFileSync('/app/licenses/borrowed-work/sharp-libvips-notices.txt','utf8'),/Mozilla Public License 1.1/);
    const source=JSON.parse(readFileSync('/app/licenses/native-source/manifest.json','utf8'));
    const require=createRequire('/app/server/package.json');
    const sharpRequire=createRequire(require.resolve('sharp'));
    const library=sharpRequire.resolve('@img/sharp-libvips-linux-x64/package');
    assert.equal(source.packageVersion,JSON.parse(readFileSync(library,'utf8')).version);
    assert.deepEqual(source.versions,JSON.parse(readFileSync(join(dirname(library),'versions.json'),'utf8')));
    for(const row of source.sources){
      assert.equal(createHash('sha256').update(readFileSync('/app/licenses/native-source/'+row.file)).digest('hex'),row.sha256);
    }
    const rsvg=source.sources.find(row=>row.file.endsWith('librsvg-2.63.2.tar.xz'));
    assert.ok(rsvg);
    const lock=execFileSync('tar',['-xOf','/app/licenses/native-source/'+rsvg.file,'librsvg-2.63.2/Cargo.lock'],{encoding:'utf8'});
    for(const block of lock.split('[[package]]')) {
      const name=/^name = "([^"]+)"$/m.exec(block)?.[1];
      const version=/^version = "([^"]+)"$/m.exec(block)?.[1];
      const checksum=/^checksum = "([^"]+)"$/m.exec(block)?.[1];
      if(checksum!==undefined)assert.ok(source.sources.some(row=>row.file===name+'-'+version+'.crate'&&row.sha256===checksum),'librsvg crate '+name);
    }
    const list=execFileSync('tar',['-tzf','/app/licenses/core-source.tar.gz'],{encoding:'utf8'}).split('\n');
    for(const file of ['LICENSE','Dockerfile','pnpm-lock.yaml','pnpm-workspace.yaml','apps/server/src/main.ts','apps/web/src/diagram/frame-main.ts','patches/mermaid@12.0.0.patch'])assert.ok(list.includes(file),file);
    assert.ok(!list.some(file=>file.includes('node_modules/')||file.startsWith('.env')||file.startsWith('.tooling/')||file.startsWith('../')));
    assert.equal(execFileSync('tar',['-xOzf','/app/licenses/core-source.tar.gz','LICENSE'],{encoding:'utf8'}),license);
    console.log('runner notices, core build source and native source hashes pass');
  `;
  const result = await run(
    'docker',
    [
      'run',
      '--rm',
      '--entrypoint',
      'node',
      image,
      '--input-type=module',
      '-e',
      script,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  assert.match(result.stdout, /native source hashes pass/);
});

await test('the bundled first-party source rebuilds the builder context', async () => {
  const repository = join(import.meta.dirname, '../..');
  const directory = await mkdtemp(join(repository, '.tooling/source-rebuild-'));
  let container;
  try {
    container = (await run('docker', ['create', image])).stdout.trim();
    await run('docker', [
      'cp',
      `${container}:/app/licenses/core-source.tar.gz`,
      join(directory, 'source.tar.gz'),
    ]);
    await run('tar', [
      '-xzf',
      join(directory, 'source.tar.gz'),
      '-C',
      directory,
    ]);
    for (const file of [
      'Dockerfile',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'patches/mermaid@12.0.0.patch',
      'apps/web/src/diagram/frame-main.ts',
    ])
      assert.equal(
        await readFile(join(directory, file), 'utf8'),
        await readFile(join(repository, file), 'utf8'),
        file,
      );
    await run(
      'docker',
      ['build', '--platform', 'linux/amd64', '--target', 'builder', directory],
      { maxBuffer: 32 * 1024 * 1024 },
    );
  } finally {
    if (container !== undefined) await run('docker', ['rm', container]);
    await rm(directory, { recursive: true, force: true });
  }
});
