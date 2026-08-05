const tls = require('tls'), net = require('net');
function socksConnect(proxy, host, port) { return new Promise((resolve, reject) => {
  const s = net.connect(proxy.port, proxy.host);
  s.on('error', reject);
  s.on('connect', () => { console.error('[socks] tcp connected to proxy'); s.write(Buffer.from([0x05, 0x01, 0x00])); });
  let step = 0, buf = Buffer.alloc(0);
  s.on('data', d => { buf = Buffer.concat([buf, d]);
    if (step === 0) { if (buf.length < 2) return; console.error('[socks] greeting reply', buf.slice(0, 2)); if (buf[0] !== 0x05 || buf[1] === 0xff) return reject(new Error('neg fail')); buf = Buffer.alloc(0); step = 1; const hb = Buffer.from(host); const pb = Buffer.alloc(2); pb.writeUInt16BE(port, 0); s.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hb.length]), hb, pb])); console.error('[socks] sent CONNECT', host + ':' + port); }
    else { if (buf.length < 4) return; console.error('[socks] connect reply code', buf[1]); if (buf[1] !== 0x00) return reject(new Error('conn fail ' + buf[1])); let off = 4; if (buf[3] === 0x01) off += 4; else if (buf[3] === 0x03) off += 1 + buf[4]; else if (buf[3] === 0x04) off += 16; off += 2; if (buf.length < off) return; s.removeAllListeners('data'); console.error('[socks] tunnel established'); resolve(s); }
  });
}); }
(async () => {
  const proxy = { type: 'socks', host: '127.0.0.1', port: 7890 };
  try {
    const tcp = await socksConnect(proxy, 'x.com', 443);
    const sock = tls.connect({ socket: tcp, servername: 'x.com' }, () => {});
    sock.on('secureConnect', () => { console.error('[tls] SECURE CONNECT OK, authorized=', sock.authorized); sock.destroy(); });
    sock.on('error', e => { console.error('[tls] ERROR', e.message); });
    sock.on('close', () => console.error('[tls] closed'));
  } catch (e) { console.error('FAIL', e.message); }
})();
