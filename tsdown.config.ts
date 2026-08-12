import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['cli.ts', 'main.ts'],
  format: 'esm',
  clean: true,
  outputOptions: {
    entryFileNames: '[name].js',
    chunkFileNames: '[name]-[hash].js'
  }
});
