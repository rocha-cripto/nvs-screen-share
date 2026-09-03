const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = __dirname;
const rooms = new Map();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let file = decodeURIComponent(url.pathname);

  if (file === '/' || file === '/health') {
    if (file === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('OK');
    }

    file = '/index.html';
  }

  const filePath = path.resolve(PUBLIC, '.' + file);

  if (!filePath.startsWith(path.resolve(PUBLIC))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    return res.end('Not Found');
  }

  res.writeHead(200, {
    'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });

  fs.createReadStream(filePath).pipe(res);
});

const wss = new WebSocket.Server({ server });

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', ws => {
  ws.id = Math.random().toString(36).slice(2, 10);

  ws.on('message', raw => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === 'create') {
      const code = String(message.code || '').toUpperCase();

      if (!/^[A-Z0-9]{6}$/.test(code)) {
        return send(ws, {
          type: 'error',
          message: 'Código inválido.'
        });
      }

      let room = rooms.get(code);

      if (!room) {
        room = {
          host: null,
          clients: new Set()
        };
        rooms.set(code, room);
      }

      if (room.host && room.host !== ws) {
        return send(ws, {
          type: 'error',
          message: 'Sala já possui um transmissor.'
        });
      }

      room.host = ws;
      room.clients.add(ws);

      ws.room = code;
      ws.role = 'host';

      return send(ws, {
        type: 'created',
        code,
        viewers: room.clients.size - 1
      });
    }

    if (message.type === 'join') {
      const code = String(message.code || '').toUpperCase();
      const room = rooms.get(code);

      if (!room || !room.host) {
        return send(ws, {
          type: 'error',
          message: 'Sala não encontrada ou transmissão ainda não iniciada.'
        });
      }

      room.clients.add(ws);

      ws.room = code;
      ws.role = 'viewer';

      send(ws, {
        type: 'joined',
        code,
        hostId: room.host.id
      });

      send(room.host, {
        type: 'viewer-joined',
        viewerId: ws.id,
        count: room.clients.size - 1
      });

      return;
    }

    const room = ws.room && rooms.get(ws.room);

    if (!room) return;

    if (['offer', 'answer', 'ice'].includes(message.type)) {
      const target = [...room.clients].find(
        client => client.id === message.target
      );

      if (target) {
        send(target, {
          ...message,
          from: ws.id
        });
      }
    }
  });

  ws.on('close', () => {
    const room = ws.room && rooms.get(ws.room);

    if (!room) return;

    room.clients.delete(ws);

    if (room.host === ws) {
      for (const client of room.clients) {
        send(client, {
          type: 'host-left'
        });
      }

      rooms.delete(ws.room);
    } else if (room.host) {
      send(room.host, {
        type: 'viewer-left',
        count: room.clients.size - 1,
        viewerId: ws.id
      });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NVS Screen Share running on port ${PORT}`);
});
