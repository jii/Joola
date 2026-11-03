import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: './',
  build: { outDir: '../www', emptyOutDir: true },
  test: { root: '.', include: ['tests/**/*.test.js'], environment: 'jsdom' },
});
