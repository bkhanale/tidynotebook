/** Read notices and source archives from the real runner image. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const run = promisify(execFile);
const image = process.env['NOTESAPP_IMAGE'] || 'notesapp:latest';

await test('the runner carries full notices and its exact build source', async () => {
  const script = String.raw`
    import assert from 'node:assert/strict';
    import {readFileSync,readdirSync} from 'node:fs';
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
    assert.equal(source.platform,process.platform+'-'+process.arch+'-glibc');
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
    const base=JSON.parse(readFileSync('/app/licenses/base-source/manifest.json','utf8'));
    const actual=execFileSync('dpkg-query',['-W','-f=$'+'{source:Package}\t$'+'{source:Version}\n'],{encoding:'utf8'}).trim().split('\n');
    assert.deepEqual([...new Set(actual)].sort(),base.packages.map(row=>row.name+'\t'+row.version).sort());
    assert.equal(process.versions.node,base.nodeVersion);
    assert.deepEqual(readdirSync('/opt'),[]);
    assert.deepEqual(readdirSync('/usr/local/lib/node_modules').sort(),['npm']);
    assert.deepEqual(readdirSync('/usr/local/bin').sort(),['docker-entrypoint.sh','node','nodejs','npm','npx']);
    assert.equal(JSON.parse(readFileSync('/usr/local/lib/node_modules/npm/package.json','utf8')).version,base.npmVersion);
    assert.match(readFileSync('/app/licenses/base-npm/THIRD-PARTY-NOTICES.txt','utf8'),/spdx-exceptions@2.5.0/);
    assert.equal(createHash('sha256').update(readFileSync('/usr/local/bin/docker-entrypoint.sh')).digest('hex'),base.dockerEntrypointSha256);
    for(const row of base.sources)assert.equal(createHash('sha256').update(readFileSync('/app/licenses/base-source/'+row.file)).digest('hex'),row.sha256);
    for(const pkg of base.packages) {
      const descriptor=pkg.files.find(file=>file.endsWith('.dsc'));assert.ok(descriptor);
      const file='/app/licenses/base-source/'+descriptor;
      execFileSync('gpgv',['--keyring','/app/licenses/borrowed-work/debian-source-keys.gpg',file],{stdio:['ignore','pipe','pipe']});
      const body=readFileSync(file,'utf8');
      assert.equal(/^Source: (.+)$/m.exec(body)?.[1],pkg.name);
      assert.equal(/^Version: (.+)$/m.exec(body)?.[1],pkg.version);
      const checksum=body.split('Checksums-Sha256:\n')[1];assert.ok(checksum);
      for(const line of checksum.split('\n')) {
        if(!line.startsWith(' '))break;
        const [hash,size,name]=line.trim().split(/\s+/);
        const bytes=readFileSync('/app/licenses/base-source/'+name);
        assert.equal(bytes.length,Number(size));assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
      }
    }
    execFileSync('gpgv',['--keyring','/app/licenses/base-source/node-release-pubring.kbx','/app/licenses/base-source/node-SHASUMS256.txt.sig','/app/licenses/base-source/node-SHASUMS256.txt'],{stdio:['ignore','pipe','pipe']});
    const nodeSource=base.sources.find(row=>row.file==='node-v'+base.nodeVersion+'.tar.xz');assert.ok(nodeSource);
    assert.ok(readFileSync('/app/licenses/base-source/node-SHASUMS256.txt','utf8').includes(nodeSource.sha256+'  '+nodeSource.file));
    assert.equal(execFileSync('tar',['-xOf','/app/licenses/base-source/'+nodeSource.file,'node-v'+base.nodeVersion+'/LICENSE'],{encoding:'utf8'}),readFileSync('/usr/local/LICENSE','utf8'));
    assert.equal(JSON.parse(execFileSync('tar',['-xOf','/app/licenses/base-source/'+nodeSource.file,'node-v'+base.nodeVersion+'/deps/npm/package.json'],{encoding:'utf8'})).version,base.npmVersion);
    const list=execFileSync('tar',['-tzf','/app/licenses/core-source.tar.gz'],{encoding:'utf8'}).split('\n');
    for(const file of ['LICENSE','Dockerfile','pnpm-lock.yaml','pnpm-workspace.yaml','apps/server/src/main.ts','apps/web/src/diagram/frame-main.ts','patches/mermaid@12.0.0.patch','apps/web/public/fonts/geist-latin.woff2','apps/web/public/fonts/geist-mono-latin.woff2'])assert.ok(list.includes(file),file);
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
  await mkdir(join(repository, '.tooling'), { recursive: true });
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
    for (const file of [
      'apps/web/public/fonts/geist-latin.woff2',
      'apps/web/public/fonts/geist-mono-latin.woff2',
    ])
      assert.deepEqual(
        await readFile(join(directory, file)),
        await readFile(join(repository, file)),
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
