import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import {
  defaultThemeFamilyId,
  defaultThemeFor,
  themeFamilies,
  themeProperties,
} from '@notesapp/ui';

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

/** Matches the editor engine packages that load with the note surface. */
const editorEngine =
  /[\\/]node_modules[\\/](?:@codemirror|@lezer|@marijn|style-mod|w3c-keyname|crelt)[\\/]/;

/** The built location of the diagram frame, matching the development path. */
const framePath = 'src/diagram/frame.html';

/** The placeholder that the theme data replaces inside the shell document. */
const themePlaceholder = '__NOTESAPP_THEMES__';

/** The placeholder of the first browser interface colour of the shell. */
const themeColourPlaceholder = '__NOTESAPP_THEME_COLOUR__';

/** The served name of the installed application manifest. */
const manifestPath = 'manifest.webmanifest';

/**
 * The palette data of the script that runs before the first paint.
 *
 * The names are written once, and every theme lists its values in that same
 * order, so the whole registry stays small inside the document. The script
 * reads the stored family and appearance and writes the properties, which is
 * why a reload never shows the wrong palette.
 */
export function themeRegistryData(): string {
  const names = themeProperties(defaultThemeFor('dark')).map(([name]) => name);
  const families: Record<string, Record<string, unknown>> = {};
  for (const family of themeFamilies) {
    const variants: Record<string, unknown> = {};
    for (const theme of family.variants)
      variants[theme.appearance] = {
        id: theme.id,
        values: themeProperties(theme).map(([, value]) => value),
      };
    families[family.id] = variants;
  }
  return JSON.stringify({
    fallback: defaultThemeFamilyId,
    properties: names,
    families,
  });
}

/**
 * The installed application manifest.
 *
 * The interface colour is the page background of the default dark theme, so
 * the manifest cannot drift from the registry. A theme change repaints the
 * `theme-color` element of the live document as well.
 */
export function webManifest(): string {
  const theme = defaultThemeFor('dark');
  return `${JSON.stringify(
    {
      name: 'Notesapp',
      short_name: 'Notes',
      description: 'Offline notes with versioned history.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: theme.tokens.background,
      theme_color: theme.tokens.background,
      icons: [
        {
          src: '/icon-192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    null,
    2,
  )}\n`;
}

/**
 * Writes the theme registry into the shell document and the manifest.
 *
 * Both outputs are generated from `@notesapp/ui`, so the palette lives in
 * exactly one place: adding a theme changes one data file and nothing here
 * (audit UI-48).
 */
function themeAssets(): Plugin {
  return {
    name: 'notesapp-theme-assets',
    transformIndexHtml: {
      order: 'pre',
      handler(html: string): string {
        return html
          .replace(themePlaceholder, () => themeRegistryData())
          .replace(
            themeColourPlaceholder,
            () => defaultThemeFor('dark').tokens.background,
          );
      },
    },
    configureServer(server): void {
      server.middlewares.use((request, response, next): void => {
        if (!(request.url ?? '').startsWith(`/${manifestPath}`)) {
          next();
          return;
        }
        response.setHeader('content-type', 'application/manifest+json');
        response.end(webManifest());
      });
    },
    generateBundle(): void {
      this.emitFile({
        type: 'asset',
        fileName: manifestPath,
        source: webManifest(),
      });
    },
  };
}

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
      output: {
        // One group holds the whole editor engine. Without it the bundler
        // spreads CodeMirror over several chunks and puts its own interop
        // helpers in one of them. Every chunk that needs a helper then names
        // that chunk, so the login page preloaded the editor and the initial
        // budget grew by about 140 KB. With the group the helpers stay in a
        // small chunk of their own and the engine loads with the note
        // surface, which is the only screen that needs it.
        advancedChunks: { groups: [{ name: 'editor', test: editorEngine }] },
      },
    },
  },
  server: {
    port: 5173,
  },
  plugins: [
    tailwindcss(),
    themeAssets(),
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
