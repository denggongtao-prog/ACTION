import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [vue()],
  base: './',
  server:{watch:{usePolling:true,interval:200}},
  test: { include: ['tests/**/*.test.ts'] },
  build: { rollupOptions: { input: { simulator: resolve(import.meta.dirname, 'index.html'), host: resolve(import.meta.dirname, 'host.html') } } },
});

