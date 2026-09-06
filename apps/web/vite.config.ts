import { defineConfig } from 'vite';

// The JSX transform comes from Vite's built-in esbuild support with the
// automatic runtime, so no framework plugin is needed for the production
// build. The bundle keeps the tsc declarations in `dist` (emptyOutDir stays
// off) because the package export points at the compiled composition root.
//
// The diagram frame is a second HTML entry. It bundles the Mermaid renderer
// on its own, so the main application stays inside its initial JavaScript
// budget and loads diagrams only when a note shows one. The emitted frame
// document is precached for offline use by the later PWA task.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
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
});
