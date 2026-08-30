import { defineConfig } from 'vite';
import deck from './tools/vite-plugin-deck.js';

export default defineConfig({
  root: '.',
  base: './',
  plugins: [deck()],
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
