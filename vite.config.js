import { defineConfig } from 'vite';
import deck from './tools/vite-plugin-deck.js';
import vr from './tools/vite-plugin-vr.js';

export default defineConfig({
  root: '.',
  base: './',
  // vr(): the headset's way in — a sync relay on the HMR socket. Dev only.
  plugins: [deck(), vr()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index.html'
    }
  },
  server: {
    port: 5173,
    strictPort: true,   // fail loudly instead of silently moving to 5174
    open: false         // START-RESONOTE.bat opens the window; this stops the double tab
  }
});
