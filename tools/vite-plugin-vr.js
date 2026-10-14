// The headset's way in. Dev-server only (a production build has no socket to
// relay over):
//
// 1. SYNC RELAY. Resonote windows in one browser keep each other in step over
//    a BroadcastChannel (src/core/sync.js). A headset is another browser on
//    another machine, so sync.js also sends each message up the dev server's
//    own HMR socket — the one the Stream Deck bridge already rides — and this
//    hands it on to every OTHER window that is connected. No new port for it,
//    no new process.

export default function vrPlugin() {
  return {
    name: 'resonote-vr',
    apply: 'serve',
    configureServer(server) {
      // Every other client, never back to the sender. A window on the PC also
      // gets the message over its BroadcastChannel; sync.js drops the second copy.
      server.ws.on('resonote:sync', (msg, from) => {
        const out = JSON.stringify({ type: 'custom', event: 'resonote:sync', data: msg });
        server.ws.clients.forEach(c => { if (c !== from && c.socket?.readyState === 1) c.socket.send(out); });
      });
    },
  };
}
