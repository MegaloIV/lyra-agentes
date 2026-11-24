import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: 'web', plugins: [preact()],
  resolve: { alias: { '@protocolo': fileURLToPath(new URL('./servidor/protocolo.ts', import.meta.url)) } },
  build: { outDir: '../dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/ws': { target: `ws://127.0.0.1:${process.env.ATRIL_PUERTO || 4317}`, ws: true } } }
});
