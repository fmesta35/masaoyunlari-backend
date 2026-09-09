/* GameVerse — Profesyonel çevrimiçi 8-top bilardo. Yaşam döngüsü js/online-arena.js'te. */
(function () {
  'use strict';
  if (window.__gvBilardoOnlineLoaded) return;
  window.__gvBilardoOnlineLoaded = true;

  var C = { W: 900, H: 450, L: 58, R: 842, T: 58, B: 392, r: 10.5, pocketR: 22 };
  var COLORS = {1:'#e9c331',2:'#245dcc',3:'#d93036',4:'#6b3fa0',5:'#e67825',6:'#23834d',7:'#7c1f28',8:'#111318',9:'#e9c331',10:'#245dcc',11:'#d93036',12:'#6b3fa0',13:'#e67825',14:'#23834d',15:'#7c1f28'};
  var define = function (d) {
    if (window.GVArena) return window.GVArena.define(d);
    (window.__gvArenaQueue = window.__gvArenaQueue || []).push(d);
  };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function names(m) {
    var p = (m && m.players) || [];
    return { p1: esc((p[0] && (p[0].name || p[0].username)) || 'Oyuncu 1'), p2: esc((p[1] && (p[1].name || p[1].username)) || 'Oyuncu 2') };
  }
  function pockets() { return [{x:C.L,y:C.T},{x:450,y:C.T-4},{x:C.R,y:C.T},{x:C.L,y:C.B},{x:450,y:C.B+4},{x:C.R,y:C.B}]; }
  function normalizedBall(b, state) {
    /* Eski 640×320 sunucudan gelen odalar da geçiş sırasında doğru görünür. */
    var cue = state && state.balls && state.balls.find(function (q) { return String(q.id) === 'cue'; });
    var old = !!(cue && Number(cue.x) < 200);
    return { id:String(b.id), n:Number(b.n || b.id) || 0, type:b.type, potted:!!b.potted, x:old ? Number(b.x)*900/640 : Number(b.x), y:old ? Number(b.y)*450/320 : Number(b.y) };
  }
  function drawBall(x, b) {
    var r=C.r, g; x.save(); x.translate(b.x,b.y);
    x.fillStyle='rgba(0,0,0,.38)'; x.beginPath(); x.ellipse(3,6,r*.98,r*.55,0,0,Math.PI*2); x.fill();
    if (b.type==='cue') { g=x.createRadialGradient(-4,-5,1,0,0,r); g.addColorStop(0,'#fff'); g.addColorStop(.72,'#eeeae0'); g.addColorStop(1,'#aaa69c'); x.fillStyle=g; x.beginPath(); x.arc(0,0,r,0,Math.PI*2); x.fill(); }
    else { var col=COLORS[b.n]||'#ba3030'; g=x.createRadialGradient(-4,-5,1,0,0,r); g.addColorStop(0,'#fff'); g.addColorStop(.12,col); g.addColorStop(1,'#080808'); x.fillStyle=g; x.beginPath(); x.arc(0,0,r,0,Math.PI*2); x.fill(); if(b.type==='stripe'){x.fillStyle='#f5f2e9';x.beginPath();x.arc(0,0,r*.86,0,Math.PI*2);x.fill();x.fillStyle=col;x.fillRect(-r,-r*.42,r*2,r*.84);} x.fillStyle=b.n===8?'#fff':'#f8f6ef';x.beginPath();x.arc(0,0,r*.44,0,Math.PI*2);x.fill();x.fillStyle='#111';x.font='700 8px Arial';x.textAlign='center';x.textBaseline='middle';x.fillText(String(b.n),0,.5); }
    x.fillStyle='rgba(255,255,255,.72)';x.beginPath();x.arc(-4,-5,2.1,0,Math.PI*2);x.fill();x.restore();
  }
  function ray(state, cue, angle) {
    var dx=Math.cos(angle),dy=Math.sin(angle),best=Infinity,hit=null;
    state.balls.map(function(b){return normalizedBall(b,state);}).forEach(function(b){if(b.potted||b.id==='cue')return;var ox=b.x-cue.x,oy=b.y-cue.y,t=ox*dx+oy*dy;if(t<=0)return;var p2=ox*ox+oy*oy-t*t,R=C.r*2;if(p2<=R*R){var q=t-Math.sqrt(R*R-p2);if(q<best){best=q;hit=b;}}});
    var walls=[dx>0?(C.R-C.r-cue.x)/dx:(C.L+C.r-cue.x)/dx,dy>0?(C.B-C.r-cue.y)/dy:(C.T+C.r-cue.y)/dy].filter(function(v){return v>0;});
    return {len:Math.min(best,Math.min.apply(Math,walls),520),hit:hit};
  }
  function paint(canvas, state, aim, power, canAim) {
    if(!canvas)return; var x=canvas.getContext('2d'),g; x.clearRect(0,0,C.W,C.H);
    g=x.createLinearGradient(0,0,0,C.H);g.addColorStop(0,'#80552f');g.addColorStop(.28,'#3f2918');g.addColorStop(1,'#1d130d');x.fillStyle=g;x.beginPath();x.roundRect(8,8,C.W-16,C.H-16,25);x.fill();x.strokeStyle='#b98a51';x.lineWidth=2;x.stroke();
    g=x.createRadialGradient(450,205,45,450,225,520);g.addColorStop(0,'#16815e');g.addColorStop(.62,'#096344');g.addColorStop(1,'#043d2c');x.fillStyle=g;x.fillRect(C.L,C.T,C.R-C.L,C.B-C.T);x.strokeStyle='rgba(255,255,255,.08)';x.strokeRect(C.L,C.T,C.R-C.L,C.B-C.T);
    pockets().forEach(function(p){g=x.createRadialGradient(p.x-4,p.y-4,2,p.x,p.y,C.pocketR);g.addColorStop(0,'#181818');g.addColorStop(1,'#000');x.fillStyle=g;x.beginPath();x.arc(p.x,p.y,C.pocketR,0,Math.PI*2);x.fill();x.strokeStyle='#2c1a10';x.lineWidth=4;x.stroke();});
    var balls=(state.balls||[]).map(function(b){return normalizedBall(b,state);}),cue=balls.find(function(b){return b.id==='cue'&&!b.potted;});
    if(canAim&&cue){var q=ray(state,cue,aim),dx=Math.cos(aim),dy=Math.sin(aim);x.save();x.setLineDash([8,8]);x.strokeStyle='rgba(255,255,255,.72)';x.lineWidth=1.4;x.beginPath();x.moveTo(cue.x+dx*14,cue.y+dy*14);x.lineTo(cue.x+dx*q.len,cue.y+dy*q.len);x.stroke();x.setLineDash([]);var pull=18+power*62;x.translate(cue.x-dx*pull,cue.y-dy*pull);x.rotate(aim);g=x.createLinearGradient(-235,0,0,0);g.addColorStop(0,'#26201c');g.addColorStop(.48,'#9a6030');g.addColorStop(.9,'#e0b66a');g.addColorStop(1,'#f1e3c2');x.fillStyle=g;x.fillRect(-235,-3,225,6);x.restore();}
    balls.forEach(function(b){if(!b.potted)drawBall(x,b);});
  }
  define({
    id:'bilardo', kinds:['bilardo'], reject:['bilardoRejected'],
    render:function(m){
      var s=m.state||{}, mine=s.turn===m.seat&&!m.isSpectator, n=names(m), score=s.score||[0,0], groups=s.groups||[null,null];
      return '<div class="bil-wrap bil-online"><div class="bil-hud"><div class="bil-player '+(s.turn===0?'active':'')+'"><div class="bil-avatar">P1</div><div><div class="bil-player-name">'+n.p1+'</div><div class="bil-player-score">'+(groups[0]==='solid'?'Düz toplar':groups[0]==='stripe'?'Çizgili toplar':'Açık masa')+'</div></div></div><div class="bil-match"><div class="bil-round">CANLI 8-TOP</div><div class="bil-match-score">'+Number(score[0]||0)+' — '+Number(score[1]||0)+'</div></div><div class="bil-player right '+(s.turn===1?'active':'')+'"><div><div class="bil-player-name">'+n.p2+'</div><div class="bil-player-score">'+(groups[1]==='solid'?'Düz toplar':groups[1]==='stripe'?'Çizgili toplar':'Açık masa')+'</div></div><div class="bil-avatar">P2</div></div></div><div class="bil-stage"><div class="bil-canvas-wrap"><canvas class="bil-canvas" id="bilOnlineCanvas" width="900" height="450" aria-label="Çevrimiçi 8-top bilardo masası"></canvas></div><div class="bil-controls"><div class="bil-help">'+(m.isSpectator?'👁️ İzleyici modundasınız.':mine?'<b>Sıra sizde.</b> Nişan alın; basılı tutup geriye çekin ve bırakın.':'Rakibin vuruşu bekleniyor…')+'</div><div><div class="bil-power-label"><span>VURUŞ GÜCÜ</span><span id="bilOnlinePowerText">0%</span></div><div class="bil-power"><i id="bilOnlinePowerFill"></i></div></div><button class="bil-reset" id="bilOnlineShoot" '+(mine?'':'disabled')+'>Vuruşu Yap</button></div></div></div>';
    },
    bind:function(root,m){
      var c=root.querySelector('#bilOnlineCanvas'),btn=root.querySelector('#bilOnlineShoot'),fill=root.querySelector('#bilOnlinePowerFill'),txt=root.querySelector('#bilOnlinePowerText'),s=m.state||{},mine=s.turn===m.seat&&!m.isSpectator,aim=0,power=0,drag=false,start=null;
      function ui(){if(fill)fill.style.width=Math.round(power*100)+'%';if(txt)txt.textContent=Math.round(power*100)+'%';paint(c,s,aim,power,mine);}
      function pt(e){var r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*C.W/r.width,y:(e.clientY-r.top)*C.H/r.height};}
      function emit(){if(!mine||power<.035)return;m.emit('bilardoShoot',{angle:aim,power:Math.max(.04,Math.min(1,power)),clientVersion:2});power=0;ui();if(btn)btn.disabled=true;}
      if(c&&mine){c.addEventListener('pointermove',function(e){var p=pt(e),cue=(s.balls||[]).map(function(b){return normalizedBall(b,s);}).find(function(b){return b.id==='cue'&&!b.potted;});if(!cue)return;if(drag){power=Math.min(1,Math.hypot(p.x-start.x,p.y-start.y)/180);}else aim=Math.atan2(p.y-cue.y,p.x-cue.x);ui();});c.addEventListener('pointerdown',function(e){drag=true;start=pt(e);power=0;c.setPointerCapture&&c.setPointerCapture(e.pointerId);ui();});c.addEventListener('pointerup',function(){if(!drag)return;drag=false;emit();});}
      if(btn)btn.addEventListener('click',function(){if(power<.12)power=.55;emit();});ui();
    }
  });
})();
