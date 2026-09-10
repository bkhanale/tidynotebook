import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// The JSX transform comes from Vite's built-in esbuild support with the
// automatic runtime, so no framework plugin is needed for the production
// build. TypeScript package output stays in `dist`, while deployable browser
// assets use `dist/web`. This separation lets every Vite build clean all old
// hashed assets without deleting package declarations or compiled modules.
//
// The diagram frame is a second HTML entry. It bundles the Mermaid renderer
// on its own, so the main application stays inside its initial JavaScript
// budget and loads diagrams only when a note shows one. The emitted frame
// document is precached for offline use by the PWA worker.
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
export default defineConfig({
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    // A source map is emitted but no shipped file names it, so no browser
    // downloads one and an operator who keeps the build can still resolve a
    // stack trace.
    sourcemap: 'hidden',
    target: 'es2024',
    rollupOptions: {
      input: {
        main: 'index.html',
        diagram: 'src/diagram/frame.html',
      },
    },
  },
  server: {
    port: 5173,
  },
  plugins: [
    tailwindcss(),
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
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
});
