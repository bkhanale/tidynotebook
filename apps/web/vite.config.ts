import { defineConfig } from 'vite';

// The JSX transform comes from Vite's built-in esbuild support with the
// automatic runtime, so no framework plugin is needed for the production
// build. The bundle keeps the tsc declarations in `dist` (emptyOutDir stays
// off) because the package export points at the compiled composition root.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    target: 'es2024',
  },
  server: {
    port: 5173,
  },
});
