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

  const t = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8'
  }[path.extname(p)] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': t
  });

  fs.createReadStream(p).pipe(res);
});

const wss = new WebSocket.Server({ server });

const send = (w, d) => {
  if (w.readyState === 1) {
    w.send(JSON.stringify(d));
  }
};

wss.on('connection', ws => {
  ws.id = Math.random().toString(36).slice(2, 10);

  ws.on('message', raw => {
    let m;

    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }

    if (m.type === 'create') {
      let c = String(m.code || '').toUpperCase();

      if (!/^[A-Z0-9]{6}$/.test(c)) {
        return send(ws, {
          type: 'error',
          message: 'Código inválido.'
        });
      }

      let r = rooms.get(c) || {
        host: null,
        clients: new Set()
      };

      if (r.host && r.host !== ws) {
        return send(ws, {
          type: 'error',
          message: 'Sala já possui um transmissor.'
        });
      }

      r.host = ws;
      r.clients.add(ws);
      rooms.set(c, r);

      ws.room = c;
      ws.role = 'host';

      return send(ws, {
        type: 'created',
        code: c,
        viewers: r.clients.size - 1
      });
    }

    if (m.type === 'join') {
      let c = String(m.code || '').toUpperCase();
      let r = rooms.get(c);

      if (!r || !r.host) {
        return send(ws, {
          type: 'error',
          message: 'Sala não encontrada ou transmissão ainda não iniciada.'
        });
      }

      r.clients.add(ws);

      ws.room = c;
      ws.role = 'viewer';

      send(ws, {
        type: 'joined',
        code: c,
        hostId: r.host.id
      });

      send(r.host, {
        type: 'viewer-joined',
        viewerId: ws.id,
        count: r.clients.size - 1
      });

      return;
    }

    let r = ws.room && rooms.get(ws.room);

    if (!r) return;

    if (['offer', 'answer', 'ice'].includes(m.type)) {
      let t = [...r.clients].find(x => x.id === m.target);

      if (t) {
        send(t, {
          ...m,
          from: ws.id
        });
      }
    }
  });

  ws.on('close', () => {
    let r = ws.room && rooms.get(ws.room);

    if (!r) return;

    r.clients.delete(ws);

    if (r.host === ws) {
      for (const c of r.clients) {
        send(c, {
          type: 'host-left'
        });
      }

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
  console.log('NVS Screen Share on ' + PORT);
});
