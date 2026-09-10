import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// The JSX transform comes from Vite's built-in esbuild support with the
// automatic runtime, so no framework plugin is needed for the production
// build. TypeScript package output stays in `dist`, while deployable browser
// assets use `dist/web`. This separation lets every Vite build clean all old
// hashed assets without deleting package declarations or compiled modules.
//
// The diagram frame is built on its own and emitted as one self-contained
// document; see `diagramFrame` below.
//
// The installed worker uses the inject-manifest strategy: the precache
// manifest below is injected into `src/pwa/service-worker.ts` at build time
// by workbox-build. Registration takes no clients and performs no skip
// waiting on its own, so old assets stay installed while old clients remain
// active and the update applies only after local persistence succeeds.
// Background Sync is never used; the foreground tab drives sync.
//
// After the build, `tools/precompress-assets.mjs` writes a `.br` and a `.gz`
// neighbour for every compressible emitted file. The Fastify static handler
// serves the one that the browser accepts, so nothing is compressed per
// request. A `.map` file is left uncompressed: no shipped file names it.
//
// The web compiler sets skipLibCheck because the workbox-build 7.4.1 and
// workbox-core 7.4.1 declarations do not compile under
// exactOptionalPropertyTypes, the same class of third-party declaration
// incompatibility that already requires the flag in apps/server.

/** The built location of the diagram frame, matching the development path. */
const framePath = 'src/diagram/frame.html';

/**
 * Emits the diagram frame as one self-contained document.
 *
 * The frame runs sandboxed without `allow-same-origin`, so its origin is
 * opaque and every request it makes is cross origin. A normal build splits
 * Mermaid into chunks that the frame then cannot load, which is exactly the
 * failure QA-04 recorded. This plugin therefore builds the frame entry on
 * its own with `inlineDynamicImports`, so Rollup produces one script, and
 * writes that script and the frame styles straight into the HTML. The frame
 * needs no network at all afterwards.
 *
 * The nested build sets `configFile: false`, so it never loads this
 * configuration again and cannot recurse.
 */
function diagramFrame(directory: string): Plugin {
  return {
    name: 'notesapp-diagram-frame',
    apply: 'build',
    async generateBundle(): Promise<void> {
      const result = await build({
        configFile: false,
        root: directory,
        logLevel: 'warn',
        build: {
          write: false,
          target: 'es2024',
          minify: true,
          rollupOptions: {
            input: resolve(directory, 'src/diagram/frame-main.ts'),
            output: { format: 'iife', inlineDynamicImports: true },
          },
        },
      });
      const outputs = (Array.isArray(result) ? result : [result]).flatMap(
        (one) => ('output' in one ? one.output : []),
      );
      const code = outputs
        .filter((chunk) => chunk.type === 'chunk')
        .map((chunk) => chunk.code)
        .join('\n');
      const styles = outputs
        .filter(
          (asset) => asset.type === 'asset' && asset.fileName.endsWith('.css'),
        )
        .map((asset) => String(asset.type === 'asset' ? asset.source : ''))
        .join('\n');
      if (code === '') throw new Error('The diagram frame produced no script.');
      // A literal closing tag inside the code would end the inline script.
      const inlineCode = code.replaceAll('</script', '<\\/script');
      const template = await readFile(
        resolve(directory, 'src/diagram/frame.html'),
        'utf8',
      );
      // The replacement is a function on purpose: minified code holds `$&`
      // and `$\`` sequences that a string replacement would expand.
      const source = template.replace(
        '<script type="module" src="./frame-main.ts"></script>',
        () =>
          `${styles === '' ? '' : `<style>${styles}</style>`}<script>${inlineCode}</script>`,
      );
      this.emitFile({ type: 'asset', fileName: framePath, source });
    },
  };
}

export default defineConfig(({ command }) => ({
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    // A source map is emitted but no shipped file names it, so no browser
    // downloads one and an operator who keeps the build can still resolve a
    // stack trace.
    sourcemap: 'hidden',
    target: 'es2024',
    // Every asset is emitted as a file of its own. An inlined asset becomes a
    // `data:` URL, and the content policy of the shell permits a font only
    // from the origin, so an inlined font is blocked and the console reports
    // a policy violation. A file also stays cacheable on its own.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { main: 'index.html' },
    },
  },
  server: {
    port: 5173,
  },
  plugins: [
    tailwindcss(),
    ...(command === 'build' ? [diagramFrame(import.meta.dirname)] : []),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'service-worker.ts',
      registerType: 'prompt',
      injectRegister: null,
      manifest: false,
      injectManifest: {
        globPatterns: [
          '**/*.{js,css,html,svg,woff,woff2,ttf,png,ico,webmanifest}',
        ],
        // The worker precaches the shell only (decision D13). The diagram
        // frame carries its whole renderer, so it loads on demand instead.
        globIgnores: ['**/src/diagram/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
}));
