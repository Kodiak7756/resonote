# Resonote — when the page won't load

The app lives at **http://localhost:5173** and is served by a small local dev
server (Vite). If the page won't load, it's almost always because that server
isn't running — it stops when its window closes, when the PC restarts, or when
a Claude session that started it ends.

## The fix, in order

1. **Double-click `START-RESONOTE.bat`** (in this folder — make a Desktop
   shortcut to it). A black window opens, the server starts, and your browser
   opens to the app a few seconds later. **Keep the black window open** while
   you practice; closing it stops the app.

2. **Wrong port?** Watch the black window's first lines. If it says
   `Port 5173 is in use` it will pick the next one (e.g. `Local:
   http://localhost:5174/`). Use whatever address it prints.

3. **Server running but the page is blank/odd?** Hard refresh:
   **Ctrl + Shift + R**. Dev servers cache aggressively; this clears it.

4. **Still stuck — a zombie server is holding the port.** In the black window
   press `Ctrl + C` (or just close it), then in a fresh terminal:
   ```
   taskkill /f /im node.exe
   ```
   (Stops ALL Node processes — fine on this machine.) Then run
   `START-RESONOTE.bat` again.

5. **Nuclear option** (something truly weird — broken install after an update):
   ```
   cd D:\Guitar\APP\resonote-v2
   npm install
   npm run dev
   ```

## Notes

- Your data (boards, sketches, custom workouts, practice history) lives in the
  **browser's** localStorage, not in the server — restarting the server never
  loses anything.
- The terminal command equivalent of the .bat, if you prefer:
  `cd D:\Guitar\APP\resonote-v2` then `npm run dev`.
