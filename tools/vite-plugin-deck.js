// The Stream Deck bridge. GET http://localhost:5173/deck/<cmd>?args -> the page.
//
// No new process and no new port: the dev server is already an HTTP server and
// already holds an open socket to the page (the one HMR uses). A Stream Deck
// key fires a background GET here; this forwards it down that socket.
//
// Why this instead of keyboard shortcuts: a synthesised keystroke goes to the
// FOREGROUND window. While practising, REAPER is in front and the guitar is in
// hand -- a hotkey would land in REAPER. An HTTP GET does not care what has
// focus, which is the whole point.

export default function deckPlugin() {
  return {
    name: 'resonote-deck',
    configureServer(server) {
      let last = { at: 0 };
      server.ws.on('resonote:deck-state', d => { last = { ...d, at: Date.now() }; });

      // Called directly inside configureServer, so this installs BEFORE Vite's
      // internal middlewares and is guaranteed to see /deck/*. connect strips
      // the '/deck' prefix, so req.url arrives as '/metro/toggle'.
      server.middlewares.use('/deck', (req, res) => {
        const url  = new URL(req.url, 'http://localhost');
        const path = url.pathname.replace(/^\/+|\/+$/g, '');
        res.setHeader('Cache-Control', 'no-store');

        if (path === 'state') {
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ ...last, connected: Date.now() - last.at < 3000 }));
        }

        server.ws.send('resonote:deck', { cmd: path, args: Object.fromEntries(url.searchParams) });
        res.setHeader('Content-Type', 'text/plain');
        res.end('ok ' + path);
      });
    }
  };
}
