import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
  target: 'node20.18',
  platform: 'node',
  clean: true,
  bundle: true,
  outDir: 'dist',
  noExternal: ['@code-journal/core'],
  sourcemap: true,
  splitting: false,
  treeshake: true,
});
