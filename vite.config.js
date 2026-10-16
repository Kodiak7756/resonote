import { defineConfig } from 'vite';
import deck from './tools/vite-plugin-deck.js';
import vr from './tools/vite-plugin-vr.js';

export default defineConfig({
  root: '.',
  base: './',
  // vr(): the headset's way in — a sync relay on the HMR socket and an https
  // door on :5443 that pipes into this server. Dev only; see VR.md.
  plugins: [deck(), vr({ port: 5443 })],
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
    // No `host` is needed for the headset: Vite can stay on localhost, because
    // the https door is what listens on the LAN and it forwards in here.
  }
});
