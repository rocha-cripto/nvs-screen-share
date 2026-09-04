const $ = s => document.querySelector(s);
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);

let role = null;
let code = null;
let sourceStream = null;
let processedStream = null;
let canvas = null;
let ctx = null;
let sourceVideo = null;
let renderTimer = null;
let pcs = new Map();
let cfg = { w: 1280, h: 720, f: 30 };

function send(x) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(x));
}

function status(text, on = false) {
  $('#status').textContent = text;
  $('.status i').style.background = on ? '#25d46d' : '#e5a400';
}

function openModal(value = '') {
  $('#input').value = value;
  $('#modal').classList.add('open');
  $('#input').focus();
}

function showRoom() {
  $('#room').hidden = false;
  $('#code').textContent = code;
  history.replaceState(null, '', '?room=' + code);
}

function rnd() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

ws.onopen = () => {
  status('Conectado', true);
  const c = new URLSearchParams(location.search).get('room');
  if (c) openModal(c.toUpperCase());
};

ws.onclose = () => status('Desconectado');

$('#create').onclick = () => {
  role = 'host';
  code = rnd();
  send({ type: 'create', code });
};

$('#join').onclick = () => openModal();
$('#close').onclick = () => $('#modal').classList.remove('open');

$('#go').onclick = () => {
  const c = $('#input').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(c)) return alert('Digite um código de 6 caracteres.');
  role = 'viewer';
  code = c;
  send({ type: 'join', code: c });
  $('#modal').classList.remove('open');
};

$('#input').onkeydown = e => {
  if (e.key === 'Enter') $('#go').click();
};

$('#copy').onclick = async () => {
  await navigator.clipboard.writeText(code);
};

$('#link').onclick = async () => {
  await navigator.clipboard.writeText(location.origin + '?room=' + code);
};

$('#leave').onclick = () => location.href = location.pathname;

function setQuality(button) {
  const active = document.querySelector('.choice.active');
  if (active) active.classList.remove('active');
  button.classList.add('active');
  cfg = {
    w: Number(button.dataset.w),
    h: Number(button.dataset.h),
    f: Number(button.dataset.f)
  };
}

document.querySelectorAll('.choice').forEach(button => {
  button.onclick = async () => {
    setQuality(button);
    if (sourceStream) {
      // Se já estiver transmitindo, aplica a nova qualidade imediatamente.
      await rebuildProcessedStream();
    }
  };
});

function fitCover(srcW, srcH, dstW, dstH) {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;
  let dw, dh, dx, dy;

  if (srcRatio > dstRatio) {
    dh = dstH;
    dw = dh * srcRatio;
    dx = (dstW - dw) / 2;
    dy = 0;
  } else {
    dw = dstW;
    dh = dw / srcRatio;
    dx = 0;
    dy = (dstH - dh) / 2;
  }
  return { dx, dy, dw, dh };
}

function startCanvasLoop() {
  cancelAnimationFrame(renderTimer);
  const draw = () => {
    if (!sourceVideo || !canvas || !ctx || sourceVideo.readyState < 2) {
      renderTimer = requestAnimationFrame(draw);
      return;
    }

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cfg.w, cfg.h);

    const srcW = sourceVideo.videoWidth || cfg.w;
    const srcH = sourceVideo.videoHeight || cfg.h;
    const fit = fitCover(srcW, srcH, cfg.w, cfg.h);
    ctx.drawImage(sourceVideo, fit.dx, fit.dy, fit.dw, fit.dh);

    renderTimer = requestAnimationFrame(draw);
  };
  draw();
}

async function rebuildProcessedStream() {
  if (!sourceStream) return;

  if (processedStream) {
    processedStream.getTracks().forEach(t => t.stop());
  }

  canvas = canvas || document.createElement('canvas');
  canvas.width = cfg.w;
  canvas.height = cfg.h;
  ctx = canvas.getContext('2d', { alpha: false });

  if (!sourceVideo) {
    sourceVideo = document.createElement('video');
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    sourceVideo.autoplay = true;
  }

  sourceVideo.srcObject = sourceStream;
  await sourceVideo.play().catch(() => {});

  startCanvasLoop();

  const videoTrack = canvas.captureStream(cfg.f).getVideoTracks()[0];
  processedStream = new MediaStream([videoTrack]);

  // Mantém o áudio original, quando o navegador forneceu uma faixa de áudio.
  const audioTrack = sourceStream.getAudioTracks()[0];
  if (audioTrack) processedStream.addTrack(audioTrack);

  $('#video').srcObject = processedStream;
  $('#empty').style.display = 'none';
  $('#state').textContent = `${cfg.w === 1920 ? '1080p' : '720p'} • ${cfg.f} FPS`;

  // Se já existem espectadores, recria os PeerConnections para eles receberem a nova resolução.
  if (role === 'host') {
    const ids = [...pcs.keys()];
    pcs.forEach(pc => pc.close());
    pcs.clear();
    ids.forEach(id => offerFor(id));
  }
}

$('#share').onclick = async () => {
  if (role !== 'host') return;

  try {
    sourceStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: cfg.w, max: cfg.w },
        height: { ideal: cfg.h, max: cfg.h },
        frameRate: { ideal: cfg.f, max: cfg.f }
      },
      audio: $('#audio').checked
    });

    await rebuildProcessedStream();
    send({ type: 'host-ready' });

    const track = sourceStream.getVideoTracks()[0];
    track.onended = stop;
  } catch (e) {
    sourceStream = null;
    alert('Compartilhamento cancelado ou bloqueado pelo navegador.');
  }
};

function stop() {
  if (renderTimer) cancelAnimationFrame(renderTimer);
  renderTimer = null;

  if (sourceStream) sourceStream.getTracks().forEach(t => t.stop());
  if (processedStream) processedStream.getTracks().forEach(t => t.stop());

  pcs.forEach(pc => pc.close());
  pcs.clear();
  sourceStream = null;
  processedStream = null;
  sourceVideo = null;
  canvas = null;
  ctx = null;

  $('#video').srcObject = null;
  $('#empty').style.display = 'flex';
  $('#state').textContent = 'Aguardando';
};

async function offerFor(id) {
  if (!processedStream) return;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  processedStream.getTracks().forEach(track => pc.addTrack(track, processedStream));
  pc.onicecandidate = e => {
    if (e.candidate) send({ type: 'ice', target: id, candidate: e.candidate });
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
      if (pcs.get(id) === pc) pcs.delete(id);
    }
  };

  pcs.set(id, pc);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send({ type: 'offer', target: id, offer });
}

ws.onmessage = async e => {
  const m = JSON.parse(e.data);

  if (m.type === 'error') return alert(m.message);

  if (m.type === 'created') {
    showRoom();
    $('#state').textContent = 'Pronto para transmitir';
  }

  if (m.type === 'joined') {
    showRoom();
    $('#state').textContent = 'Aguardando transmissão...';
  }

  if (m.type === 'viewer-joined' && role === 'host') {
    $('#count').textContent = m.count;
    if (processedStream) offerFor(m.viewerId);
  }

  if (m.type === 'viewer-left' && role === 'host') {
    $('#count').textContent = m.count || 0;
  }

  if (m.type === 'host-ready' && role === 'viewer') {
    send({ type: 'viewer-ready' });
  }

  if (m.type === 'offer' && role === 'viewer') {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pcs.set(m.from, pc);
    pc.ontrack = e => {
      $('#video').srcObject = e.streams[0];
      $('#empty').style.display = 'none';
      $('#state').textContent = 'Ao vivo';
    };
    pc.onicecandidate = e => {
      if (e.candidate) send({ type: 'ice', target: m.from, candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) pcs.delete(m.from);
    };

    await pc.setRemoteDescription(m.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send({ type: 'answer', target: m.from, answer });
  }

  if (m.type === 'answer') {
    const pc = pcs.get(m.from);
    if (pc) await pc.setRemoteDescription(m.answer);
  }

  if (m.type === 'ice') {
    const pc = pcs.get(m.from);
    if (pc) {
      try { await pc.addIceCandidate(m.candidate); } catch {}
    }
  }

  if (m.type === 'host-left') {
    $('#state').textContent = 'Transmissão encerrada';
    alert('O transmissor saiu da sala.');
  }
};
