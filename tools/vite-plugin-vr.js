// The headset's way in. Two jobs, both dev-server only (a production build has
// neither a socket to relay over nor a server to put a door on):
//
// 1. SYNC RELAY. Resonote windows in one browser keep each other in step over
//    a BroadcastChannel (src/core/sync.js). A headset is another browser on
//    another machine, so sync.js also sends each message up the dev server's
//    own HMR socket — the one the Stream Deck bridge already rides — and this
//    hands it on to every OTHER window that is connected. No new port for it,
//    no new process.
//
// 2. HTTPS FRONT DOOR. The PC keeps http://localhost:5173 exactly as it was
//    (the mic needs localhost or https, and localhost is what it has). The
//    headset gets https://<this PC>:5443: a TLS socket that decrypts and pipes
//    the bytes, untouched, to the dev server on this machine — page loads and
//    the HMR WebSocket alike. Vite never knows; to it the headset is one more
//    local browser, so Vite itself can stay on localhost. Why https at all when
//    plain http would carry phase A: the WebXR room after this one needs a
//    secure page, and the certificate warning is better accepted once, now.

import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import path from 'node:path';
import { devCert } from './dev-cert.js';

// This PC's addresses on the local network, the likeliest one first: a home
// router hands out 192.168.x, an office 10.x; anything else is usually a VM,
// WSL or VPN adapter the headset can't reach.
export function lanAddresses() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(a => {
    const v4 = a.family === 'IPv4' || a.family === 4;
    if (v4 && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }));
  const rank = ip => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2;
  return out.sort((a, b) => rank(a) - rank(b));
}

const bold = s => `\x1b[1m${s}\x1b[22m`, cyan = s => `\x1b[36m${s}\x1b[39m`, dim = s => `\x1b[2m${s}\x1b[22m`;

export default function vrPlugin({ port = 5443, certDir = 'dev-cert' } = {}) {
  let close = () => {};
  return {
    name: 'resonote-vr',
    apply: 'serve',
    configureServer(server) {
      const log = server.config.logger;

      // ── 1. Relay ───────────────────────────────────────────────────
      // Every other client, never back to the sender. A window on the PC also
      // gets the message over its BroadcastChannel; sync.js drops the second copy.
      server.ws.on('resonote:sync', (msg, from) => {
        const out = JSON.stringify({ type: 'custom', event: 'resonote:sync', data: msg });
        server.ws.clients.forEach(c => { if (c !== from && c.socket?.readyState === 1) c.socket.send(out); });
      });

      // ── 2. Front door ──────────────────────────────────────────────
      // It opens the dev server to the local network (as `--host` does), so it
      // can be kept shut: RESONOTE_VR=off npm run dev.
      const http = server.httpServer;
      if (!http) return;                       // middleware mode: no server of ours to front
      if (/^(off|0|no|false)$/i.test(process.env.RESONOTE_VR || '')) return;
      const ips = lanAddresses();
      const open = new Set();
      let door = null, up = false, failed = '';

      const printDoor = () => {
        if (failed) { log.warn(`  ${bold('Quest')}:   ${failed}`); return; }
        if (!ips.length) { log.info(`  ${bold('Quest')}:   ${dim('no network address found — is this PC on Wi-Fi or Ethernet?')}`); return; }
        log.info(`  ${cyan('➜')}  ${bold('Quest')}:   ${cyan(`https://${ips[0]}:${bold(port)}/vr`)}  ${dim('← open this in the headset (see VR.md)')}`);
        ips.slice(1).forEach(ip => log.info(`  ${cyan('➜')}  ${dim(`   or:    https://${ip}:${port}/vr`)}`));
      };
      // Vite prints its own addresses after listening (and again on `u`); the
      // headset's goes right under them, once the door is actually open.
      const printUrls = server.printUrls.bind(server);
      server.printUrls = () => {
        printUrls();
        if (up || failed) printDoor(); else door?.once('listening', printDoor);
      };

      http.once('listening', () => {
        let creds;
        try { creds = devCert(path.resolve(server.config.root, certDir), ips); }
        catch (e) { failed = `could not make the https certificate (${e.message}) — the headset link is off`; return; }
        if (creds.fresh) log.info(dim(`  Resonote VR: made a new https certificate in ${certDir}/ — the headset will ask to accept it once.`));

        // Forward to wherever Vite actually bound: 'localhost' can mean ::1 on one
        // machine and 127.0.0.1 on the next, and --host binds every interface.
        const a = http.address();
        const target = { port: a.port, host: (a.address === '::' || a.address === '0.0.0.0') ? '127.0.0.1' : a.address };

        const secure = tls.createServer({ key: creds.key, cert: creds.cert }, client => {
          const pipe = net.connect(target);
          open.add(client); open.add(pipe);
          const done = () => { client.destroy(); pipe.destroy(); open.delete(client); open.delete(pipe); };
          client.on('error', done); pipe.on('error', done);
          client.on('close', done); pipe.on('close', done);
          client.pipe(pipe); pipe.pipe(client);
        });
        // A browser that hasn't accepted the certificate yet hangs up mid-handshake.
        // That's the expected first visit, not an error worth a stack trace.
        secure.on('tlsClientError', () => {});

        // One port, both schemes: a TLS hello goes to the TLS server; anything
        // else is plain http typed into the headset's address bar, and is sent
        // round to the https address instead of failing with a blank page.
        door = net.createServer(sock => {
          open.add(sock);
          sock.on('error', () => {});
          sock.on('close', () => open.delete(sock));
          sock.once('data', first => {
            sock.pause();
            sock.unshift(first);
            if (first[0] === 0x16) { secure.emit('connection', sock); return; }
            const head = first.toString('latin1');
            const url  = /^[A-Z]+ (\/\S*)/.exec(head)?.[1] || '/vr';
            const host = /\r\nhost:[ \t]*([^\r\n]+)/i.exec(head)?.[1] || `${ips[0] || 'localhost'}:${port}`;
            sock.end(`HTTP/1.1 301 Moved Permanently\r\nLocation: https://${host}${url}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
          });
        });
        let retried = false;
        door.on('error', e => {
          // A restart can race the old door's close by a moment; try once more.
          if (e.code === 'EADDRINUSE' && !retried) { retried = true; setTimeout(() => door.listen(port), 1000); return; }
          failed = e.code === 'EADDRINUSE'
            ? `port ${port} is in use (another Resonote still running?) — the headset link is off`
            : `the https door failed (${e.message}) — the headset link is off`;
          log.warn(`  Resonote VR: ${failed}`);
        });
        door.on('listening', () => { up = true; });
        door.listen(port);                     // every interface: the headset is on the LAN

        close = () => {
          up = false;
          try { door?.close(); } catch (e) {}
          try { secure.close(); } catch (e) {}
          open.forEach(s => s.destroy());
          open.clear();
        };
      });
      http.on('close', () => close());
    },
    // Vite calls this when the dev server shuts down or restarts.
    closeBundle() { close(); },
  };
}
