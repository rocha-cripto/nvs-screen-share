const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = __dirname;
const rooms = new Map();

const server = http.createServer((req, res) => {
  let f = req.url.split('?')[0];
  if (f === '/') f = '/index.html';

  const p = path.join(PUBLIC, f);
  if (!p.startsWith(PUBLIC) || !fs.existsSync(p)) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  };

  res.writeHead(200, {
    'Content-Type': types[path.extname(p).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });

  fs.createReadStream(p).pipe(res);
});

const wss = new WebSocket.Server({ server });
const send = (ws, data) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
};

wss.on('connection', ws => {
  ws.id = Math.random().toString(36).slice(2, 10);

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'create') {
      const c = String(m.code || '').toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(c)) return send(ws, { type: 'error', message: 'Código inválido.' });

      let r = rooms.get(c) || { host: null, clients: new Set() };
      if (r.host && r.host !== ws) return send(ws, { type: 'error', message: 'Sala já possui um transmissor.' });

      r.host = ws;
      r.clients.add(ws);
      rooms.set(c, r);
      ws.room = c;
      ws.role = 'host';
      return send(ws, { type: 'created', code: c, viewers: r.clients.size - 1 });
    }

    if (m.type === 'join') {
      const c = String(m.code || '').toUpperCase();
      const r = rooms.get(c);
      if (!r || !r.host) return send(ws, { type: 'error', message: 'Sala não encontrada ou transmissão ainda não iniciada.' });

      r.clients.add(ws);
      ws.room = c;
      ws.role = 'viewer';
      send(ws, { type: 'joined', code: c, hostId: r.host.id });
      send(r.host, { type: 'viewer-joined', viewerId: ws.id, count: r.clients.size - 1 });
      return;
    }

    const r = ws.room && rooms.get(ws.room);
    if (!r) return;

    if (m.type === 'host-ready' && ws === r.host) {
      for (const client of r.clients) {
        if (client !== r.host) send(client, { type: 'host-ready' });
      }
      return;
    }

    if (m.type === 'viewer-ready' && ws.role === 'viewer') {
      send(r.host, { type: 'viewer-joined', viewerId: ws.id, count: r.clients.size - 1 });
      return;
    }

    if (['offer', 'answer', 'ice'].includes(m.type)) {
      const target = [...r.clients].find(x => x.id === m.target);
      if (target) send(target, { ...m, from: ws.id });
    }
  });

  ws.on('close', () => {
    const r = ws.room && rooms.get(ws.room);
    if (!r) return;

    r.clients.delete(ws);

    if (r.host === ws) {
      for (const client of r.clients) send(client, { type: 'host-left' });
      rooms.delete(ws.room);
    } else if (r.host) {
      send(r.host, {
        type: 'viewer-left',
        count: r.clients.size - 1,
        viewerId: ws.id
      });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('NVS Screen Share running on port ' + PORT);
});
