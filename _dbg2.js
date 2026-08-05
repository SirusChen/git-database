const tls = require('tls'), net = require('net');
function socksConnect(proxy, host, port) { return new Promise((resolve, reject) => {
  const s = net.connect(proxy.port, proxy.host);
  s.on('error', reject);
  s.on('connect', () => s.write(Buffer.from([0x05, 0x01, 0x00])));
  let step = 0, buf = Buffer.alloc(0);
  s.on('data', d => { buf = Buffer.concat([buf, d]);
    if (step === 0) { if (buf.length < 2) return; if (buf[0] !== 0x05 || buf[1] === 0xff) return reject(new Error('neg fail')); buf = Buffer.alloc(0); step = 1; const hb = Buffer.from(host); const pb = Buffer.alloc(2); pb.writeUInt16BE(port, 0); s.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hb.length]), hb, pb])); }
    else { if (buf.length < 4) return; if (buf[1] !== 0x00) return reject(new Error('conn fail ' + buf[1])); let off = 4; if (buf[3] === 0x01) off += 4; else if (buf[3] === 0x03) off += 1 + buf[4]; else if (buf[3] === 0x04) off += 16; off += 2; if (buf.length < off) return; s.removeAllListeners('data'); resolve(s); }
  });
}); }
function tryTls(host, alpn) { return new Promise(async (resolve) => {
  try {
    const tcp = await socksConnect({ type: 'socks', host: '127.0.0.1', port: 7890 }, host, 443);
    const opt = { socket: tcp, servername: host };
    if (alpn) opt.ALPNProtocols = alpn;
    const sock = tls.connect(opt, () => {});
    const to = setTimeout(() => { try { sock.destroy(); } catch (_) {} resolve(host + ' TIMEOUT'); }, 8000);
    sock.on('secureConnect', () => { clearTimeout(to); console.error(host, 'ALPN=' + (sock.alpnProtocol || 'none'), 'authorized=' + sock.authorized); sock.destroy(); resolve(host + ' OK'); });
    sock.on('error', e => { clearTimeout(to); resolve(host + ' ERR ' + e.message); });
  } catch (e) { resolve(host + ' FAIL ' + e.message); }
}); }
(async () => {
  console.error('--- test example.com (sanity) ---');
  console.error(await tryTls('example.com', null));
  console.error('--- test x.com no ALPN ---');
  console.error(await tryTls('x.com', null));
  console.error('--- test x.com ALPN h2 ---');
  console.error(await tryTls('x.com', ['h2', 'http/1.1']));
})();
