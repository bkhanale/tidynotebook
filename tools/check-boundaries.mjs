import { builtinModules } from 'node:module';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { parseSync } from 'oxc-parser';
import { filesIn, record, root, workspaces } from './workspace.mjs';

// A separate root permits disposable negative checks without application fixtures.
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--root')) {
  console.error('Usage: node tools/check-boundaries.mjs [--root <directory>]');
  process.exit(1);
}
const directory = resolve(args[1] ?? root);
const packages = await workspaces(directory);
/** @type {Record<string, string[]>} */
const allowed = {
  web: [
    'api-client',
    'core',
    'storage-browser',
    'sync',
    'markdown',
    'editor',
    'ui',
  ],
  server: ['api-contract', 'core', 'storage-server', 'markdown'],
  'mcp-stdio': ['api-client', 'api-contract'],
  'api-contract': [],
  'api-client': [],
  core: [],
  'storage-server': ['core'],
  'storage-browser': ['core', 'sync'],
  sync: ['core', 'api-client'],
  markdown: ['core'],
  editor: ['core', 'markdown', 'ui'],
  ui: [],
  'sdk-codegen': ['api-contract'],
};
// Core belongs here. The design requires core to run in the browser, so core
// must stay free of Node built-in modules and server-only packages.
const browser = new Set([
  'web',
  'api-client',
  'core',
  'storage-browser',
  'sync',
  'markdown',
  'editor',
  'ui',
]);
const serverOnly = new Set(['server', 'storage-server']);
// Recognized test files may use these modules. Production files may not.
const testModules = new Set([
  'node:test',
  'node:test/reporters',
  'node:assert',
  'node:assert/strict',
]);
const builtinNames = new Set(
  builtinModules.flatMap((name) => {
    const bare = name.replace(/^node:/, '');
    return [bare, bare.split('/')[0] ?? bare];
  }),
);
const nodeOnly = new Set([
  'pg',
  'fastify',
  'drizzle-orm',
  'drizzle-kit',
  'better-auth',
  'sharp',
  'dotenv',
]);
const coreForbidden = new Set([
  'react',
  'react-dom',
  'fastify',
  'drizzle-orm',
  'dexie',
]);
const httpLibraries = new Set([
  'axios',
  'ky',
  'got',
  'superagent',
  'node-fetch',
  'undici',
  '@hey-api/client-fetch',
]);
// These files connect maintained protocols or cache static application assets.
// They remain subject to imports, dependency direction, and package cycle checks.
const protocolFiles = new Set([
  'apps/server/src/auth/better-auth.ts',
  'apps/server/src/mcp/server.ts',
  'apps/mcp-stdio/src/main.ts',
]);
const assetFiles = new Set(['apps/web/src/pwa/service-worker.ts']);
const generated = [
  'packages/api-client/src/generated/',
  'packages/api-contract/src/generated/',
];
/** @type {string[]} */
const failures = [];
/** @type {Map<string, Set<string>>} */
const graph = new Map();
// First Node-only or server-only use found in each package, for reach reports.
/** @type {Map<string, string>} */
const nodeUse = new Map();
/** @param {string} file @param {string} reason */
const fail = (file, reason) =>
  failures.push(`${relative(directory, file)}: ${reason}`);
/** @param {string} name */
const short = (name) => name.replace(/^@notesapp\//, '');
/** @param {string} specifier */
const packageName = (specifier) =>
  specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : (specifier.split('/')[0] ?? specifier);
/** @param {string} file */
const owner = (file) =>
  packages.find(
    (item) => file === item.path || file.startsWith(item.path + sep),
  );
/** @param {string} specifier */
const isNodeModule = (specifier) =>
  specifier.startsWith('node:') ||
  builtinNames.has(specifier) ||
  builtinNames.has(packageName(specifier));
// Reports why a specifier keeps its importer out of the browser.
/** @param {string} specifier @returns {string | null} */
function browserBlocker(specifier) {
  const dependency = packageName(specifier);
  if (isNodeModule(specifier)) return `Node module ${specifier}`;
  if (
    nodeOnly.has(dependency) ||
    dependency.startsWith('@modelcontextprotocol/') ||
    dependency.startsWith('@better-auth/')
  )
    return `Node-only package ${dependency}`;
  if (dependency.startsWith('@notesapp/') && serverOnly.has(short(dependency)))
    return `server-only package ${dependency}`;
  return null;
}
/** @param {string} path @returns {boolean} */
const isTestPath = (path) =>
  /\.test\.[cm]?[jt]sx?$/.test(path) ||
  path.startsWith('tests/') ||
  path.includes('/tests/');
/** @param {string} specifier @returns {boolean} */
const isTestSpecifier = (specifier) =>
  /(?:^|\/)[^/]*\.test(?:\.[cm]?[jt]sx?)?$/.test(specifier) ||
  /(?:^|\/)tests\//.test(specifier);

for (const item of packages) {
  const name = String(item.manifest.name);
  const key = short(name);
  if (!name.startsWith('@notesapp/') || !(key in allowed))
    fail(item.path, 'Unknown workspace package.');
  if (graph.has(name)) fail(item.path, `Duplicate package name ${name}.`);
  const edges = new Set();
  graph.set(name, edges);
  const exports = record(item.manifest.exports);
  if (!('.' in exports) || Object.keys(exports).some((entry) => entry !== '.'))
    fail(
      item.path,
      'Expose only the public package entry point through exports["."].',
    );
  for (const required of ['typecheck', 'build', 'test:unit']) {
    if (typeof record(item.manifest.scripts)[required] !== 'string')
      fail(item.path, `Missing ${required} script.`);
  }
  for (const group of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const dependency of Object.keys(record(item.manifest[group]))) {
      if (dependency.startsWith('@notesapp/')) {
        edges.add(dependency);
        if (!allowed[key]?.includes(short(dependency)))
          fail(item.path, `Forbidden dependency ${dependency}.`);
      }
      if (key === 'core' && coreForbidden.has(dependency))
        fail(item.path, `Core cannot depend on ${dependency}.`);
      // Test helpers stay in devDependencies and never reach the browser build.
      if (group === 'devDependencies') continue;
      const blocker = browserBlocker(dependency);
      if (!blocker) continue;
      if (browser.has(key))
        fail(item.path, `Browser runtime cannot depend on ${dependency}.`);
      if (!nodeUse.has(name)) nodeUse.set(name, `${blocker} in ${group}`);
    }
  }
}

/** @param {string} file @param {string} specifier @param {boolean} isTest */
function checkImport(file, specifier, isTest) {
  const item = owner(file);
  if (!item) return;
  const name = String(item.manifest.name);
  const key = short(name);
  const dependency = packageName(specifier);
  if (!isTest && isTestSpecifier(specifier))
    fail(file, `Production source cannot import test file ${specifier}.`);
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    const target = resolve(file, '..', specifier);
    if (owner(target) !== item)
      fail(file, 'Relative or absolute imports cannot leave a package.');
    return;
  }
  if (specifier.startsWith('#')) {
    fail(file, 'Package import aliases are not part of the public boundary.');
    return;
  }
  if (dependency.startsWith('@notesapp/')) {
    graph.get(name)?.add(dependency);
    if (specifier !== dependency)
      fail(file, `Deep import ${specifier} is forbidden.`);
    if (!allowed[key]?.includes(short(dependency)))
      fail(file, `Forbidden import ${dependency}.`);
  }
  const blocker = browserBlocker(specifier);
  if (blocker && !(isTest && testModules.has(specifier))) {
    if (browser.has(key))
      fail(file, `Browser source cannot import ${specifier}.`);
    if (!isTest && !nodeUse.has(name)) nodeUse.set(name, blocker);
  }
  if (
    key === 'core' &&
    (coreForbidden.has(dependency) || dependency === '@notesapp/api-client')
  )
    fail(file, `Core cannot import ${dependency}.`);
  if (httpLibraries.has(dependency))
    fail(file, `Use generated operations instead of ${dependency}.`);
  if (
    !specifier.startsWith('node:') &&
    !builtinModules.includes(specifier) &&
    dependency !== name &&
    ![
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ].some((group) => dependency in record(item.manifest[group]))
  )
    fail(file, `Undeclared dependency ${dependency}.`);
}

/** @param {unknown} value @param {(node: Record<string, unknown>) => void} visit */
function walk(value, visit) {
  if (Array.isArray(value)) {
    for (const child of value) walk(child, visit);
  } else if (value !== null && typeof value === 'object') {
    const node = record(value);
    if (typeof node.type === 'string') visit(node);
    for (const child of Object.values(node)) walk(child, visit);
  }
}

const sources = (
  await Promise.all(
    ['apps', 'packages', 'tools', 'tests/integration'].map((folder) =>
      filesIn(resolve(directory, folder)),
    ),
  )
)
  .flat()
  .filter((file) => /\.(?:[cm]?[jt]s|tsx|jsx)$/.test(file));
for (const file of sources) {
  const path = relative(directory, file).split(sep).join('/');
  const isGenerated = generated.some((prefix) => path.startsWith(prefix));
  const isTest = isTestPath(path);
  const item = owner(file);
  const isApplication =
    Boolean(item) && item?.manifest.name !== '@notesapp/sdk-codegen';
  const protocol = protocolFiles.has(path);
  const asset = assetFiles.has(path);
  const parsed = parseSync(file, await readFile(file, 'utf8'));
  if (parsed.errors.length) {
    fail(file, 'Source must parse before boundary validation.');
    continue;
  }
  walk(parsed.program, (node) => {
    const type = String(node.type);
    if (
      [
        'ImportDeclaration',
        'ExportNamedDeclaration',
        'ExportAllDeclaration',
        'ImportExpression',
        'TSImportType',
      ].includes(type)
    ) {
      const source = record(node.source ?? node.argument);
      if (typeof source.value === 'string')
        checkImport(file, source.value, isTest);
      else if (type === 'ImportExpression')
        fail(file, 'Dynamic imports must use a literal path.');
    }
    // TypeScript `import name = require('module')` is an import too.
    if (type === 'TSImportEqualsDeclaration') {
      const reference = record(node.moduleReference);
      if (reference.type === 'TSExternalModuleReference') {
        const expression = record(reference.expression);
        if (typeof expression.value === 'string')
          checkImport(file, expression.value, isTest);
        else
          fail(file, 'import = require(...) must use a literal module path.');
      }
    }
    if (type === 'CallExpression' && record(node.callee).name === 'require') {
      const argumentsList = node.arguments;
      const source = Array.isArray(argumentsList)
        ? record(argumentsList[0])
        : {};
      if (typeof source.value === 'string')
        checkImport(file, source.value, isTest);
      else fail(file, 'require must use a literal module path.');
    }
    if (!isApplication || isGenerated) return;
    if (
      type === 'Identifier' &&
      ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].includes(
        String(node.name),
      ) &&
      !protocol &&
      !asset
    )
      fail(
        file,
        `Handwritten ${node.name} is outside the generated HTTP boundary.`,
      );
    if (
      type === 'MemberExpression' &&
      record(node.property).type === 'Literal' &&
      ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].includes(
        String(record(node.property).value),
      ) &&
      !protocol &&
      !asset
    )
      fail(file, 'Computed HTTP transport access is forbidden.');
    if (
      type === 'NewExpression' &&
      ['URL', 'URLSearchParams'].includes(String(record(node.callee).name)) &&
      [
        '@notesapp/web',
        '@notesapp/sync',
        '@notesapp/api-client',
        '@notesapp/mcp-stdio',
      ].includes(String(item?.manifest.name)) &&
      !protocol &&
      !asset
    )
      fail(file, 'Application URL construction belongs in generated output.');
    if (
      asset &&
      type === 'Literal' &&
      typeof node.value === 'string' &&
      /(?:^|\/)api(?:\/|$)/.test(node.value)
    )
      fail(file, 'The asset worker cannot cache application API paths.');
  });
}
// A browser package must stay browser-safe through every workspace package it
// imports, not only in its own files.
for (const item of packages) {
  const name = String(item.manifest.name);
  if (!browser.has(short(name))) continue;
  const seen = new Set([name]);
  /** @type {string[][]} */
  const queue = [[name]];
  while (queue.length) {
    const chain = queue.shift();
    const current = chain?.at(-1);
    if (!chain || current === undefined) break;
    const blocker = nodeUse.get(current);
    if (blocker !== undefined && chain.length > 1)
      failures.push(
        `${name}: Browser package reaches ${blocker} through ${chain.join(' -> ')}.`,
      );
    for (const next of graph.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...chain, next]);
    }
  }
}
/** @type {Set<string>} */
const done = new Set();
/** @param {string} name @param {string[]} chain */
function visit(name, chain) {
  if (chain.includes(name)) {
    failures.push(`Package cycle: ${[...chain, name].join(' -> ')}`);
    return;
  }
  if (done.has(name)) return;
  for (const dependency of graph.get(name) ?? []) {
    if (!graph.has(dependency))
      failures.push(`${name}: Missing workspace ${dependency}.`);
    else visit(dependency, [...chain, name]);
  }
  done.add(name);
}
for (const name of graph.keys()) visit(name, []);
if (failures.length) {
  console.error([...new Set(failures)].join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Boundary checks passed for ${packages.length} packages and ${sources.length} source files.`,
  );
