const $=s=>document.querySelector(s);
const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);
let role=null,code=null,name='NVS',sourceStream=null,processedStream=null,canvas=null,ctx=null,sourceVideo=null,renderTimer=null,pcs=new Map();
let cfg={w:1280,h:720,f:30};

function send(x){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(x))}
function setStatus(text,ok=false){
  $('#status').textContent=text;
  const i=document.querySelector('.topstatus i'); if(i)i.style.background=ok?'#39d98a':'#e5a400';
  $('#statusRoom').textContent=ok?'Conexão':'Desconectado';
}
function rnd(){return Math.random().toString(36).slice(2,8).toUpperCase()}
function openModal(v=''){
  $('#input').value=v; $('#modal').hidden=false; $('#nameInput').focus();
}
function enterRoom(){
  $('#landing').hidden=true; $('#roomApp').hidden=false;
  $('#roomCode').textContent=code;
  $('#username').textContent=name; $('#sideName').textContent=name;
  const initial=(name.trim()[0]||'N').toUpperCase();
  $('#avatar').textContent=initial; $('#sideAvatar').textContent=initial;
  $('#welcomeTitle').textContent=role==='host'?'Bem-vindo, '+name+'!':'Bem-vindo, '+name+'!';
  $('#welcomeText').textContent=role==='host'?'Compartilhe sua tela usando a barra de baixo.':'Aguardando o transmissor iniciar a tela.';
  history.replaceState(null,'','?room='+code);
}
function addMessage(user,text,system=false){
  const box=$('#messages');
  if(system){const d=document.createElement('div');d.className='system-msg';d.textContent=text;box.appendChild(d);box.scrollTop=box.scrollHeight;return}
  const row=document.createElement('div');row.className='message';
  const av=document.createElement('span');av.className='avatar';av.textContent=(user[0]||'N').toUpperCase();
  const b=document.createElement('div');b.className='bubble';
  const strong=document.createElement('strong');strong.textContent=user;
  const p=document.createElement('p');p.textContent=text;
  b.append(strong,p);row.append(av,b);box.appendChild(row);box.scrollTop=box.scrollHeight;
}
function setPeople(list){
  const host=list.find(x=>x.role==='host');
  $('#count').textContent=list.length;
  const side=$('.people');
  side.querySelectorAll('.person:not(:first-child)').forEach(x=>x.remove());
  list.forEach((p,i)=>{
    if(i===0){
      const el=side.querySelector('.person');
      if(!el)return;
      el.querySelector('.avatar').textContent=(p.name?.[0]||'N').toUpperCase();
      el.querySelector('strong').textContent=p.name||'NVS';
      el.querySelector('small').textContent=p.role==='host'?'● transmissor • você':'● espectador';
      return;
    }
    const row=document.createElement('div');row.className='person';
    row.innerHTML='<span class="avatar big"></span><div><strong></strong><small></small></div><span class="signal">▮▮▮</span>';
    row.querySelector('.avatar').textContent=(p.name?.[0]||'N').toUpperCase();
    row.querySelector('strong').textContent=p.name||'NVS';
    row.querySelector('small').textContent=p.role==='host'?'● transmissor':'● espectador';
    side.appendChild(row);
  });
}
ws.onopen=()=>{
  setStatus('Conectado',true);
  const c=new URLSearchParams(location.search).get('room');
  if(c)openModal(c.toUpperCase());
};
ws.onclose=()=>setStatus('Desconectado');

$('#create').onclick=()=>{
  $('#createModal').hidden=false;
  $('#createNameInput').focus();
  $('#createNameInput').select();
};
$('#createClose').onclick=()=>$('#createModal').hidden=true;
$('#createGo').onclick=()=>{
  name=($('#createNameInput').value.trim()||'NVS').slice(0,18);
  role='host'; code=rnd(); $('#createModal').hidden=true; send({type:'create',code,name});
};
$('#createNameInput').onkeydown=e=>{if(e.key==='Enter')$('#createGo').click()};
$('#join').onclick=()=>openModal();
$('#close').onclick=()=>$('#modal').hidden=true;
$('#go').onclick=()=>{
  const c=$('#input').value.trim().toUpperCase();
  name=($('#nameInput').value.trim()||'NVS').slice(0,18);
  if(!/^[A-Z0-9]{6}$/.test(c))return alert('Digite um código de 6 caracteres.');
  role='viewer';code=c;send({type:'join',code:c,name});$('#modal').hidden=true;
};
$('#input').onkeydown=e=>{if(e.key==='Enter')$('#go').click()};
$('#nameInput').onkeydown=e=>{if(e.key==='Enter')$('#input').focus()};
$('#roomCode').onclick=async()=>{await navigator.clipboard.writeText(code);addMessage('NVS','Código copiado.',true)};
$('#copyLink').onclick=async()=>{await navigator.clipboard.writeText(location.origin+'?room='+code);addMessage('NVS','Convite copiado.',true)};
$('#leave').onclick=()=>location.href=location.pathname;
$('#activities').onclick=()=>addMessage('NVS','Atividades: transmissão P2P, qualidade '+(cfg.w===1920?'1080p':'720p')+' / '+cfg.f+' FPS.',true);
$('#more').onclick=()=>addMessage('NVS','Sala '+code+' • '+name,true);

function setQuality(btn){
  document.querySelectorAll('.q').forEach(x=>x.classList.remove('active'));btn.classList.add('active');
  cfg={w:+btn.dataset.w,h:+btn.dataset.h,f:+btn.dataset.f};
}
document.querySelectorAll('.q').forEach(btn=>btn.onclick=async()=>{setQuality(btn);if(sourceStream)await rebuildProcessedStream()});

function fit(srcW,srcH,dstW,dstH){
  const r=srcW/srcH,R=dstW/dstH;let dw,dh,dx,dy;
  if(r>R){dh=dstH;dw=dh*r;dx=(dstW-dw)/2;dy=0}else{dw=dstW;dh=dw/r;dx=0;dy=(dstH-dh)/2}
  return{dx,dy,dw,dh}
}
function startCanvasLoop(){
  cancelAnimationFrame(renderTimer);
  const draw=()=>{
    if(!sourceVideo||!canvas||!ctx||sourceVideo.readyState<2){renderTimer=requestAnimationFrame(draw);return}
    ctx.fillStyle='#000';ctx.fillRect(0,0,cfg.w,cfg.h);
    const f=fit(sourceVideo.videoWidth||cfg.w,sourceVideo.videoHeight||cfg.h,cfg.w,cfg.h);
    ctx.drawImage(sourceVideo,f.dx,f.dy,f.dw,f.dh);renderTimer=requestAnimationFrame(draw)
  };draw()
}
async function rebuildProcessedStream(){
  if(!sourceStream)return;
  if(processedStream)processedStream.getTracks().forEach(t=>t.stop());
  canvas=canvas||document.createElement('canvas');canvas.width=cfg.w;canvas.height=cfg.h;
  ctx=canvas.getContext('2d',{alpha:false});
  if(!sourceVideo){sourceVideo=document.createElement('video');sourceVideo.muted=true;sourceVideo.playsInline=true;sourceVideo.autoplay=true}
  sourceVideo.srcObject=sourceStream;await sourceVideo.play().catch(()=>{});startCanvasLoop();
  const vt=canvas.captureStream(cfg.f).getVideoTracks()[0];
  processedStream=new MediaStream([vt]);
  const at=sourceStream.getAudioTracks()[0];if(at)processedStream.addTrack(at);
  $('#video').srcObject=processedStream;$('#empty').style.display='none';
  $('#liveBadge').hidden=false;
  if(role==='host'){
    const ids=[...pcs.keys()];pcs.forEach(pc=>pc.close());pcs.clear();ids.forEach(id=>offerFor(id))
  }
}
$('#share').onclick=async()=>{
  if(role!=='host')return alert('Somente o criador da sala pode compartilhar a tela.');
  try{
    sourceStream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:cfg.w,max:cfg.w},height:{ideal:cfg.h,max:cfg.h},frameRate:{ideal:cfg.f,max:cfg.f}},audio:$('#audio').checked});
    await rebuildProcessedStream();send({type:'host-ready'});
    sourceStream.getVideoTracks()[0].onended=stop;
    addMessage('NVS','Você começou a compartilhar a tela.',true);
  }catch(e){sourceStream=null;alert('Compartilhamento cancelado ou bloqueado pelo navegador.')}
};
$('#camera').onclick=async()=>{
  try{
    if(sourceStream){sourceStream.getTracks().forEach(t=>t.stop());sourceStream=null}
    sourceStream=await navigator.mediaDevices.getUserMedia({video:true,audio:$('#audio').checked});
    await rebuildProcessedStream();send({type:'host-ready'});
    sourceStream.getVideoTracks()[0].onended=stop;
  }catch(e){alert('Não foi possível abrir a câmera.')}
};
$('#mic').onclick=async()=>{
  if(!sourceStream)return alert('Inicie a transmissão primeiro.');
  try{
    const a=await navigator.mediaDevices.getUserMedia({audio:true});
    const track=a.getAudioTracks()[0];
    const old=sourceStream.getAudioTracks()[0];if(old)sourceStream.removeTrack(old);
    sourceStream.addTrack(track);await rebuildProcessedStream();addMessage('NVS','Microfone/áudio ativado.',true)
  }catch(e){alert('Não foi possível acessar o microfone.')}
};
$('#chatForm').onsubmit=e=>{
  e.preventDefault();const input=$('#chatInput');const text=input.value.trim();if(!text)return;
  send({type:'chat',text,name});input.value='';addMessage(name,text)
};
function stop(){
  if(renderTimer)cancelAnimationFrame(renderTimer);renderTimer=null;
  if(sourceStream)sourceStream.getTracks().forEach(t=>t.stop());
  if(processedStream)processedStream.getTracks().forEach(t=>t.stop());
  pcs.forEach(pc=>pc.close());pcs.clear();sourceStream=null;processedStream=null;sourceVideo=null;canvas=null;ctx=null;
  $('#video').srcObject=null;$('#empty').style.display='flex';$('#liveBadge').hidden=true;
  $('#welcomeText').textContent=role==='host'?'Compartilhe sua tela usando a barra de baixo.':'Aguardando o transmissor iniciar a tela.';
}
async function offerFor(id){
  if(!processedStream)return;
  const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
  processedStream.getTracks().forEach(t=>pc.addTrack(t,processedStream));
  pc.onicecandidate=e=>{if(e.candidate)send({type:'ice',target:id,candidate:e.candidate})};
  pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(pc.connectionState)&&pcs.get(id)===pc)pcs.delete(id)};
  pcs.set(id,pc);const offer=await pc.createOffer();await pc.setLocalDescription(offer);send({type:'offer',target:id,offer})
}
ws.onmessage=async e=>{
  const m=JSON.parse(e.data);
  if(m.type==='error'){alert(m.message);return}
  if(m.type==='created'){
    enterRoom();$('#roleText').textContent='● transmissor • você';
    setPeople([{name:name,role:'host'}]);
    addMessage('NVS','Sala criada. Envie o convite para quem vai assistir.',true);
  }
  if(m.type==='joined'){
    enterRoom();$('#roleText').textContent='● espectador • você';
    if(m.people)setPeople(m.people);
    addMessage('NVS','Você entrou na sala.',true);
  }
  if(m.type==='people'){
    setPeople(m.people||[]);
  }
  if(m.type==='user-joined'){
    setPeople(m.people||[]);
    addMessage(m.name||'NVS','entrou na sala.',true);
    if(role==='host' && m.viewerId && processedStream)offerFor(m.viewerId);
  }
  if(m.type==='user-left'){
    setPeople(m.people||[]);
    addMessage(m.name||'NVS','saiu da sala.',true);
  }
  if(m.type==='viewer-joined'&&role==='host'){
    $('#count').textContent=(m.count||0)+1;
    if(processedStream)offerFor(m.viewerId);
  }
  if(m.type==='viewer-left'&&role==='host')$('#count').textContent=(m.count||0)+1;
  if(m.type==='chat')addMessage(m.name||'NVS',m.text||'');
  if(m.type==='host-ready'&&role==='viewer')send({type:'viewer-ready'});
  if(m.type==='offer'&&role==='viewer'){
    const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});pcs.set(m.from,pc);
    pc.ontrack=e=>{$('#video').srcObject=e.streams[0];$('#empty').style.display='none';$('#liveBadge').hidden=false;$('#welcomeText').textContent='Transmissão ao vivo'};
    pc.onicecandidate=e=>{if(e.candidate)send({type:'ice',target:m.from,candidate:e.candidate})};
    pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(pc.connectionState))pcs.delete(m.from)};
    await pc.setRemoteDescription(m.offer);const ans=await pc.createAnswer();await pc.setLocalDescription(ans);send({type:'answer',target:m.from,answer:ans})
  }
  if(m.type==='answer'){const pc=pcs.get(m.from);if(pc)await pc.setRemoteDescription(m.answer)}
  if(m.type==='ice'){const pc=pcs.get(m.from);if(pc)try{await pc.addIceCandidate(m.candidate)}catch{}}
  if(m.type==='host-left'){$('#welcomeText').textContent='O transmissor encerrou a transmissão.';$('#liveBadge').hidden=true;alert('O transmissor saiu da sala.')}
};