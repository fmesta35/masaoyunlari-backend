/* ============================================================================
 * GameVerse — ÇEVRİMİÇİ 8-TOP BİLARDO (istemci). Yaşam döngüsü js/online-arena.js.
 * ============================================================================
 * Sunucudaki gerçek fizik motoruyla (bilardo-engine.js) birlikte baştan
 * yazıldı. Artık oyuncu yalnız açı ve güç değil, GERÇEK BİR ISTEKA gibi
 * vuruş noktasını ve ısteka açısını da seçer:
 *
 *   • Nişan        : imleci masada gezdir (hayalet top + hedef doğrultusu görünür)
 *   • Güç          : güç çubuğu ya da masada geriye çekip bırakma
 *   • FALSO        : beyaz top yüzü üzerinde vuruş noktası (üst/alt/yan)
 *   • ISTEKA AÇISI : masse / piqué için yükseklik açısı
 *
 * Bu değerler sunucuya gönderilir; fizik ORADA çözülür (hileye kapalı) ve
 * vuruşun tamamı kare kare geri yayınlanır. Masa ölçüleri de sunucudan gelir
 * (state.table) — istemci kendi kopyasını tutmaz, iki taraf asla birbirinden
 * kopmaz.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvBilardoOnlineLoaded) return;
  window.__gvBilardoOnlineLoaded = true;

  // Sunucu geometrisi gelene kadar kullanılacak yedek değerler.
  var C = { W: 900, H: 500, L: 58, R: 842, T: 54, B: 446, r: 8.8, pocketR: 19, pockets: null, scale: 308.66 };
  var COLORS = { 1:'#e9c331',2:'#245dcc',3:'#d93036',4:'#6b3fa0',5:'#e67825',6:'#23834d',7:'#7c1f28',
                 8:'#111318',9:'#e9c331',10:'#245dcc',11:'#d93036',12:'#6b3fa0',13:'#e67825',14:'#23834d',15:'#7c1f28' };

  var define = function (d) {
    if (window.GVArena) return window.GVArena.define(d);
    (window.__gvArenaQueue = window.__gvArenaQueue || []).push(d);
  };
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function names(m) {
    var p = (m && m.players) || [];
    return {
      p1: esc((p[0] && (p[0].name || p[0].username)) || 'Oyuncu 1'),
      p2: esc((p[1] && (p[1].name || p[1].username)) || 'Oyuncu 2')
    };
  }
  /* Masa ölçülerini SUNUCUDAN al. Eski sürümde istemci kendi sabitlerini
     tutuyordu; sunucu geometrisi değişince toplar yanlış yere çiziliyordu. */
  function useTable(s) {
    var t = s && s.table;
    if (!t || !Number(t.W)) return;
    C.W = t.W; C.H = t.H; C.L = t.L; C.R = t.R; C.T = t.T; C.B = t.B;
    C.r = t.r; C.pocketR = t.pocketR; C.scale = t.scale || C.scale;
    if (Array.isArray(t.pockets)) C.pockets = t.pockets;
  }
  function pockets() {
    if (C.pockets) return C.pockets;
    var mx = (C.L + C.R) / 2;
    return [{x:C.L,y:C.T},{x:mx,y:C.T},{x:C.R,y:C.T},{x:C.L,y:C.B},{x:mx,y:C.B},{x:C.R,y:C.B}];
  }

  // --------------------------------------------------------------- ÇİZİM
  function drawScene(x) {
    if (!x) return;                       // 2D bağlam yoksa sessizce çık (jsdom)
    var g;
    x.clearRect(0, 0, C.W, C.H);
    // Ahşap çerçeve
    g = x.createLinearGradient(0, 0, 0, C.H);
    g.addColorStop(0, '#80552f'); g.addColorStop(.28, '#3f2918'); g.addColorStop(1, '#1d130d');
    x.fillStyle = g; x.beginPath(); x.roundRect(8, 8, C.W - 16, C.H - 16, 25); x.fill();
    x.strokeStyle = '#b98a51'; x.lineWidth = 2; x.stroke();
    // Çuha
    var cx = (C.L + C.R) / 2, cy = (C.T + C.B) / 2;
    g = x.createRadialGradient(cx, cy - 20, 45, cx, cy, (C.R - C.L) * .62);
    g.addColorStop(0, '#16815e'); g.addColorStop(.62, '#096344'); g.addColorStop(1, '#043d2c');
    x.fillStyle = g; x.fillRect(C.L, C.T, C.R - C.L, C.B - C.T);
    x.strokeStyle = 'rgba(255,255,255,.08)'; x.lineWidth = 2;
    x.strokeRect(C.L, C.T, C.R - C.L, C.B - C.T);
    // Baş çizgisi (kitchen) — gerçek masalarda vardır, nişan için de yardımcı
    var head = C.L + (C.R - C.L) * 0.25;
    x.strokeStyle = 'rgba(255,255,255,.10)'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(head, C.T); x.lineTo(head, C.B); x.stroke();
    // Cepler
    pockets().forEach(function (p) {
      var pr = p.r || C.pocketR;
      g = x.createRadialGradient(p.x - 4, p.y - 4, 2, p.x, p.y, pr);
      g.addColorStop(0, '#181818'); g.addColorStop(1, '#000');
      x.fillStyle = g; x.beginPath(); x.arc(p.x, p.y, pr, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#2c1a10'; x.lineWidth = 4; x.stroke();
    });
  }

  /* Top çizimi. z (havada olma) gölgeyi ayırır ve topu büyütür; spin
     (yuvarlanma) görsel olarak numaranın/şeridin dönmesiyle verilir. */
  function drawBall(x, b) {
    var z = Number(b.z) || 0;
    var lift = Math.min(28, z);                     // px
    var r = C.r * (1 + Math.min(0.35, lift / 90));
    var rot = Number(b.rot) || 0;
    var g;
    x.save();
    // Gölge yerde kalır, top yükseldikçe ayrışır ve solar
    x.fillStyle = 'rgba(0,0,0,' + (0.38 - Math.min(0.22, lift / 120)) + ')';
    x.beginPath(); x.ellipse(b.x + 3 + lift * .25, b.y + 6 + lift * .35, r * .98, r * .55, 0, 0, Math.PI * 2); x.fill();
    x.translate(b.x, b.y - lift);
    if (b.type === 'cue') {
      g = x.createRadialGradient(-r * .45, -r * .5, 1, 0, 0, r);
      g.addColorStop(0, '#fff'); g.addColorStop(.72, '#eeeae0'); g.addColorStop(1, '#aaa69c');
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill();
      // Dönüşü belli eden ince kırmızı nokta (gerçek antrenman toplarındaki gibi)
      x.save(); x.rotate(rot);
      x.fillStyle = 'rgba(200,60,60,.75)'; x.beginPath(); x.arc(r * .5, 0, r * .16, 0, Math.PI * 2); x.fill();
      x.restore();
    } else {
      var col = COLORS[b.n] || '#ba3030';
      g = x.createRadialGradient(-r * .45, -r * .5, 1, 0, 0, r);
      g.addColorStop(0, '#fff'); g.addColorStop(.12, col); g.addColorStop(1, '#080808');
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill();
      x.save(); x.rotate(rot);
      if (b.type === 'stripe') {
        x.fillStyle = '#f5f2e9'; x.beginPath(); x.arc(0, 0, r * .86, 0, Math.PI * 2); x.fill();
        x.fillStyle = col; x.fillRect(-r, -r * .42, r * 2, r * .84);
      }
      x.fillStyle = b.n === 8 ? '#fff' : '#f8f6ef';
      x.beginPath(); x.arc(0, 0, r * .44, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#111';
      x.font = '700 ' + Math.max(6, Math.round(r * .82)) + 'px Arial';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(String(b.n), 0, .5);
      x.restore();
    }
    x.fillStyle = 'rgba(255,255,255,.72)';
    x.beginPath(); x.arc(-r * .45, -r * .5, r * .22, 0, Math.PI * 2); x.fill();
    x.restore();
  }

  function liveBalls(s) {
    return (s.balls || []).map(function (b) {
      return { id: String(b.id), n: Number(b.n || b.id) || 0, type: b.type,
               potted: !!b.potted, x: Number(b.x), y: Number(b.y), z: Number(b.z) || 0, rot: 0 };
    });
  }

  /* Nişan yardımı: ilk temas ettiği topu ve hayalet top konumunu bulur. */
  function ray(balls, cue, angle) {
    var dx = Math.cos(angle), dy = Math.sin(angle), best = Infinity, hit = null;
    balls.forEach(function (b) {
      if (b.potted || b.id === 'cue') return;
      var ox = b.x - cue.x, oy = b.y - cue.y, t = ox * dx + oy * dy;
      if (t <= 0) return;
      var perp2 = ox * ox + oy * oy - t * t, D = C.r * 2;
      if (perp2 <= D * D) {
        var q = t - Math.sqrt(D * D - perp2);
        if (q > 0 && q < best) { best = q; hit = b; }
      }
    });
    var walls = [];
    if (dx > 0) walls.push((C.R - C.r - cue.x) / dx); else if (dx < 0) walls.push((C.L + C.r - cue.x) / dx);
    if (dy > 0) walls.push((C.B - C.r - cue.y) / dy); else if (dy < 0) walls.push((C.T + C.r - cue.y) / dy);
    var wall = walls.length ? Math.min.apply(Math, walls.filter(function (v) { return v > 0; })) : 600;
    return { len: Math.min(best, wall), hit: hit };
  }

  /* Vuruş anında ıstekanın topa doğru İLERLEMESİ için geri çekme mesafesi
     dışarıdan verilebilir (bkz. vurusAnimasyonu). Negatif değer, ıstekanın
     topun içine kadar girdiği "temas" anıdır. */
  function paint(canvas, s, aim, power, canAim, cekmePx) {
    if (!canvas) return;
    var x = canvas.getContext('2d');
    if (!x) return;
    drawScene(x);
    var balls = liveBalls(s);
    var cue = balls.find(function (b) { return b.id === 'cue' && !b.potted; });
    if (canAim && cue) {
      var q = ray(balls, cue, aim), dx = Math.cos(aim), dy = Math.sin(aim);
      var gx = cue.x + dx * q.len, gy = cue.y + dy * q.len;
      x.save();
      // Nişan çizgisi
      x.setLineDash([8, 8]);
      x.strokeStyle = 'rgba(255,255,255,.72)'; x.lineWidth = 1.4;
      x.beginPath(); x.moveTo(cue.x + dx * C.r, cue.y + dy * C.r); x.lineTo(gx, gy); x.stroke();
      x.setLineDash([]);
      if (q.hit) {
        // Hayalet top + hedef topun tahmini doğrultusu
        x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 1;
        x.beginPath(); x.arc(gx, gy, C.r, 0, Math.PI * 2); x.stroke();
        var ox = q.hit.x - gx, oy = q.hit.y - gy, on = Math.hypot(ox, oy) || 1;
        x.strokeStyle = 'rgba(255,214,102,.85)'; x.lineWidth = 1.6;
        x.beginPath(); x.moveTo(q.hit.x, q.hit.y);
        x.lineTo(q.hit.x + ox / on * 58, q.hit.y + oy / on * 58); x.stroke();
      }
      // Isteka
      var pull = (cekmePx == null) ? (18 + power * 62) : cekmePx;
      x.translate(cue.x - dx * pull, cue.y - dy * pull);
      x.rotate(aim);
      var g = x.createLinearGradient(-235, 0, 0, 0);
      g.addColorStop(0, '#26201c'); g.addColorStop(.48, '#9a6030');
      g.addColorStop(.9, '#e0b66a'); g.addColorStop(1, '#f1e3c2');
      x.fillStyle = g; x.fillRect(-235, -3, 225, 6);
      x.restore();
    }
    balls.forEach(function (b) { if (!b.potted) drawBall(x, b); });
  }

  /* ==========================================================================
     ANINDA VURUŞ (kullanıcı isteği: "ıstakayı bıraktığı anda ıstakayla topa
     vurması gerek gecikme olmadan")
     --------------------------------------------------------------------------
     ÖLÇÜLEN DURUM: fiziğin tamamını sunucu çözüyor (28 ms) ve kareleri
     yayınlıyor; istemci ESKİDEN fare bırakıldıktan sonra kareler GELENE KADAR
     hiçbir şey yapmıyordu. Sunucuya gidiş-dönüş + ~74 KB kare paketi, uzak
     sunucuda 2-3 saniyeye çıkabiliyor ve oyuncu "ıstekayı bıraktım, bir şey
     olmadı" diye görüyordu.
     ÇÖZÜM: temas ANINDA yerelde canlandırılır — ısteka topa doğru atılır,
     değme sesi çalar, nişan çizgisi kalkar. Sunucunun kareleri geldiğinde
     toplar oradan devam eder. Fizik hâlâ TAMAMEN sunucuda; yerelde yalnız
     ıstekanın hareketi çizilir (top konumu değiştirilmez, hile kapısı yok).
     ========================================================================== */
  var vurusAnim = { raf: null, token: 0 };
  function vurusAnimDurdur() {
    if (vurusAnim.raf != null) { cAF(vurusAnim.raf); vurusAnim.raf = null; }
    vurusAnim.token++;
  }
  function vurusAnimasyonu(canvas, s, aim, power) {
    vurusAnimDurdur();
    var jeton = vurusAnim.token;
    var basPull = 18 + power * 62;          // ıstekanın o anki geri çekilmişliği
    var sure = 90;                          // ms — insan gözüne "anında" gelen süre
    var t0 = nowMs();
    try { if (window.GVDeniz && GVDeniz.ses) GVDeniz.ses.cal('isteka'); } catch (_) {}
    (function adim() {
      if (jeton !== vurusAnim.token) return;
      var k = Math.min(1, (nowMs() - t0) / sure);
      // Hızlanarak ilerleyen vuruş: geri çekmeden topa (ve biraz içine) doğru
      var pull = basPull + (-(C.r * 0.55) - basPull) * (k * k);
      paint(canvas, s, aim, power, true, pull);
      if (k < 1) { vurusAnim.raf = rAF(adim); return; }
      // Temas bitti: ısteka sahneden çekilir, toplar sunucunun karelerini bekler
      paint(canvas, s, aim, power, false);
      vurusAnim.raf = null;
    })();
  }

  function drawBallsOnly(canvas, balls) {
    if (!canvas) return;
    var x = canvas.getContext('2d');
    if (!x) return;
    drawScene(x);
    balls.forEach(function (b) { if (!b.potted) drawBall(x, b); });
  }

  /* ---------- VURUŞ ANİMASYONU (kare kare canlı akış) ----------
     Sunucu vuruşun TÜM fiziğini tek seferde (senkron, hileye kapalı) çözer ve
     topların yol boyunca konumlarını "frames" olarak yayınlar.

     SENKRONİZASYON GÜVENLİĞİ (kullanıcı raporu: "bir görünüyor bir kayboluyor"):
      (1) kare seçimi DUVAR SAATİNE göre yapılır (requestAnimationFrame +
          geçen gerçek süre) — sekme arkaya alınınca kuyruklanmış onlarca eski
          kareyi art arda oynatmak yerine doğrudan o ana denk gelen kareye atlar;
      (2) her animasyonun bir JETONU (token) vardır — yeni vuruş ya da bind()
          eskisini anında geçersiz kılar;
      (3) bind() her çağrıldığında (yani sunucudan taze yetkili durum geldiğinde)
          önce stopShotAnim() çalışır; hiçbir eski kare taze çizimin üzerine yazamaz. */
  var shotAnim = { raf: null, token: 0 };
  var rAF = window.requestAnimationFrame ? function (fn) { return window.requestAnimationFrame(fn); }
                                         : function (fn) { return setTimeout(fn, 16); };
  var cAF = window.cancelAnimationFrame ? function (id) { window.cancelAnimationFrame(id); }
                                        : function (id) { clearTimeout(id); };
  var nowMs = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };

  function stopShotAnim() {
    if (shotAnim.raf != null) { cAF(shotAnim.raf); shotAnim.raf = null; }
    shotAnim.token++;
    vurusAnimDurdur();      // yerel ısteka vuruşu da kesilir (kareler geldi)
  }
  /* Kareden topları kur. Dönme açısı, topun o ana kadar aldığı YOLDAN
     türetilir (yuvarlanan bir topta dönüş = yol / yarıçap) — sunucunun
     ekstra veri göndermesine gerek kalmaz. */
  function ballsFromFrame(frames, meta, idx, rotAcc) {
    var frame = frames[idx];
    if (!frame) return null;
    var prev = idx > 0 ? frames[idx - 1] : null;
    var out = [];
    for (var k = 0; k < frame.length; k++) {
      var pos = frame[k];
      if (!pos) continue;
      var mb = meta[k] || {};
      if (prev && prev[k]) {
        var d = Math.hypot(pos[0] - prev[k][0], pos[1] - prev[k][1]);
        rotAcc[k] = (rotAcc[k] || 0) + d / Math.max(1, C.r);
      }
      out.push({ id: mb.id, n: mb.n, type: mb.type, potted: false,
                 x: pos[0], y: pos[1], z: pos[2] || 0, rot: rotAcc[k] || 0 });
    }
    return out;
  }
  function playShotFrames(payload) {
    if (!payload || !Array.isArray(payload.frames) || !payload.frames.length) return;
    stopShotAnim();
    var myToken = shotAnim.token;
    var meta = Array.isArray(payload.meta) ? payload.meta : [];
    var frames = payload.frames;
    var stepMs = Math.max(8, Number(payload.frameMs) || 17);
    var roomId = String(payload.roomId == null ? '' : payload.roomId);
    var totalMs = (frames.length - 1) * stepMs;
    var t0 = nowMs();
    var rotAcc = [];
    var lastIdx = -1;
    (function tick() {
      if (myToken !== shotAnim.token) return;
      if (window.GVArena && String(window.GVArena.roomId()) !== roomId) return;
      var c = document.getElementById('bilOnlineCanvas');
      if (!c) return;
      var elapsed = nowMs() - t0;
      var idx = elapsed >= totalMs ? frames.length - 1
              : Math.min(frames.length - 1, Math.floor(elapsed / stepMs));
      // Atlanan kareler için de dönüşü biriktir (arka planda kalan sekme)
      for (var k = lastIdx + 1; k < idx; k++) ballsFromFrame(frames, meta, k, rotAcc);
      lastIdx = idx;
      var balls = ballsFromFrame(frames, meta, idx, rotAcc);
      if (balls) drawBallsOnly(c, balls);
      if (elapsed >= totalMs) return;
      shotAnim.raf = rAF(tick);
    })();
  }

  // ------------------------------------------------------------- ADAPTÖR
  // Vuruş ayarları render'lar arası KORUNUR (sunucudan durum gelince tahta
  // yeniden çizilir; oyuncunun seçtiği falso/açı sıfırlanmamalı).
  var setup = { spinX: 0, spinY: 0, elevation: 0, power: 0.55, aim: 0, roomId: null };
  // ESC ile ıstekayı bırakma: dinleyici BİR KEZ bağlanır, güncel iptal
  // fonksiyonunu buradan okur (her bind()'de yeni dinleyici eklenmez).
  var iptalEdici = null;
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && typeof iptalEdici === 'function') iptalEdici();
  });
  function resetSetupIfRoomChanged(m) {
    var rid = String(m.roomId == null ? '' : m.roomId);
    if (setup.roomId !== rid) { setup = { spinX: 0, spinY: 0, elevation: 0, power: 0.55, aim: 0, roomId: rid }; }
  }

  function spinWidget(root) {
    var cv = root.querySelector('#bilSpin');
    if (!cv) return;
    var x = cv.getContext && cv.getContext('2d');
    if (!x) return;
    var R = cv.width / 2, cxp = R, cyp = R, ballR = R - 6;
    x.clearRect(0, 0, cv.width, cv.height);
    var g = x.createRadialGradient(cxp - ballR * .4, cyp - ballR * .45, 2, cxp, cyp, ballR);
    g.addColorStop(0, '#fff'); g.addColorStop(.75, '#efece4'); g.addColorStop(1, '#b9b5aa');
    x.fillStyle = g; x.beginPath(); x.arc(cxp, cyp, ballR, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(cxp - ballR, cyp); x.lineTo(cxp + ballR, cyp); x.stroke();
    x.beginPath(); x.moveTo(cxp, cyp - ballR); x.lineTo(cxp, cyp + ballR); x.stroke();
    // Kaçak vuruş (miscue) sınırı: yarıçapın yarısı
    x.setLineDash([3, 3]); x.strokeStyle = 'rgba(200,40,40,.45)';
    x.beginPath(); x.arc(cxp, cyp, ballR, 0, Math.PI * 2); x.stroke();
    x.setLineDash([]);
    // Seçili vuruş noktası
    var px = cxp + (setup.spinX / 0.5) * ballR;
    var py = cyp - (setup.spinY / 0.5) * ballR;
    x.fillStyle = '#d63031'; x.beginPath(); x.arc(px, py, 5, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.stroke();
  }

  define({
    id: 'bilardo', kinds: ['bilardo'], reject: ['bilardoRejected'],
    events: { bilardoShotFrames: function (payload) { playShotFrames(payload); } },
    render: function (m) {
      var s = m.state || {};
      useTable(s);
      resetSetupIfRoomChanged(m);
      var mine = s.turn === m.seat && !m.isSpectator;
      var n = names(m), score = s.score || [0, 0], groups = s.groups || [null, null];
      var grup = function (g) { return g === 'solid' ? 'Düz toplar' : g === 'stripe' ? 'Çizgili toplar' : 'Açık masa'; };
      var durum = m.isSpectator ? '👁️ İzleyici modundasınız.'
        : mine ? '<b>Sıra sizde.</b> Nişan alın, falso ve gücü ayarlayıp vurun. ' +
                 '<span class="bil-hint">Çekişi iptal edip yeniden nişan almak için <b>sağ tık</b> (veya ESC).</span>'
               : 'Rakibin vuruşu bekleniyor…';
      var faul = (s.lastShot && s.lastShot.foul) ? '<div class="bil-foul">⚠️ Son vuruş fauldü — beyaz top yeniden yerleştirildi.</div>' : '';

      return '<div class="bil-wrap bil-online">' +
        '<div class="bil-hud">' +
          '<div class="bil-player ' + (s.turn === 0 ? 'active' : '') + '"><div class="bil-avatar">P1</div><div>' +
            '<div class="bil-player-name">' + n.p1 + '</div><div class="bil-player-score">' + grup(groups[0]) + '</div></div></div>' +
          '<div class="bil-match"><div class="bil-round">CANLI 8-TOP</div>' +
            '<div class="bil-match-score">' + Number(score[0] || 0) + ' — ' + Number(score[1] || 0) + '</div></div>' +
          '<div class="bil-player right ' + (s.turn === 1 ? 'active' : '') + '"><div>' +
            '<div class="bil-player-name">' + n.p2 + '</div><div class="bil-player-score">' + grup(groups[1]) + '</div></div>' +
            '<div class="bil-avatar">P2</div></div>' +
        '</div>' +
        '<div class="bil-stage"><div class="bil-canvas-wrap">' +
          '<canvas class="bil-canvas" id="bilOnlineCanvas" width="' + C.W + '" height="' + C.H + '" ' +
          'aria-label="Çevrimiçi 8-top bilardo masası"></canvas></div>' +
          faul +
          '<div class="bil-controls">' +
            '<div class="bil-help">' + durum + '</div>' +
            '<div class="bil-tools">' +
              '<div class="bil-tool"><div class="bil-tool-h">FALSO</div>' +
                '<canvas id="bilSpin" width="78" height="78" title="Vuruş noktası: üst=takip, alt=çekme, yan=falso"></canvas>' +
                '<button type="button" class="bil-mini" id="bilSpinReset">Merkez</button></div>' +
              '<div class="bil-tool grow">' +
                '<div class="bil-power-label"><span>VURUŞ GÜCÜ</span><span id="bilOnlinePowerText">' +
                  Math.round(setup.power * 100) + '%</span></div>' +
                '<input type="range" id="bilPower" min="5" max="100" value="' + Math.round(setup.power * 100) + '" ' +
                  (mine ? '' : 'disabled') + '>' +
                '<div class="bil-power-label"><span>ISTEKA AÇISI</span><span id="bilElevText">' +
                  Math.round(setup.elevation * 180 / Math.PI) + '°</span></div>' +
                '<input type="range" id="bilElev" min="0" max="60" value="' +
                  Math.round(setup.elevation * 180 / Math.PI) + '" ' + (mine ? '' : 'disabled') + '>' +
              '</div>' +
            '</div>' +
            '<button class="bil-reset" id="bilOnlineShoot" ' + (mine ? '' : 'disabled') + '>Vuruşu Yap</button>' +
          '</div>' +
        '</div></div>';
    },
    bind: function (root, m) {
      // Taze yetkili durum geldi: eski animasyon döngüsünü ANINDA iptal et.
      stopShotAnim();
      var s = m.state || {};
      useTable(s);
      var c = root.querySelector('#bilOnlineCanvas');
      var btn = root.querySelector('#bilOnlineShoot');
      var txt = root.querySelector('#bilOnlinePowerText');
      var pw = root.querySelector('#bilPower');
      var el = root.querySelector('#bilElev');
      var elTxt = root.querySelector('#bilElevText');
      var spinCv = root.querySelector('#bilSpin');
      var spinReset = root.querySelector('#bilSpinReset');
      var mine = s.turn === m.seat && !m.isSpectator;
      var drag = false, start = null;

      function redraw() {
        if (txt) txt.textContent = Math.round(setup.power * 100) + '%';
        if (elTxt) elTxt.textContent = Math.round(setup.elevation * 180 / Math.PI) + '°';
        spinWidget(root);
        paint(c, s, setup.aim, setup.power, mine);
      }
      function pt(e) {
        var r = c.getBoundingClientRect();
        return { x: (e.clientX - r.left) * C.W / (r.width || C.W),
                 y: (e.clientY - r.top) * C.H / (r.height || C.H) };
      }
      function fire() {
        if (!mine) return;
        /* ÖNCE vuruşu göster, SONRA sunucuya gönder: ekranda bekleme olmaz.
           (Emit senkron değil; animasyonu başlatmak paketi geciktirmez.) */
        vurusAnimasyonu(c, s, setup.aim, setup.power);
        m.emit('bilardoShoot', {
          angle: setup.aim,
          power: Math.max(0.05, Math.min(1, setup.power)),
          spinX: setup.spinX, spinY: setup.spinY, elevation: setup.elevation,
          clientVersion: 3
        });
        if (btn) btn.disabled = true;
      }

      /* ISTEKAYI BIRAK (kullanıcı isteği): güç aşamasına geçildikten sonra
         açı kilitleniyordu; oyuncu nişanı yanlış aldığını fark edince
         vuruşu yapmadan geri dönemiyordu. Artık SAĞ TIK (ya da ESC) ıstekayı
         serbest bırakır: çekiş iptal olur, güç sıfırlanır ve nişan moduna
         dönülür — hiçbir vuruş gönderilmez. */
      var iptal = false;
      function istekayiBirak() {
        if (!drag) return;
        drag = false; iptal = true;
        setup.power = pw ? Math.max(0.05, Math.min(1, Number(pw.value) / 100)) : setup.power;
        redraw();
        if (window.GV && GV.toast) GV.toast('🎯 Isteka bırakıldı — yeniden nişan alabilirsiniz.', 'info');
      }
      iptalEdici = istekayiBirak;          // ESC için (tek, modül düzeyinde dinleyici)
      if (c && mine) {
        c.addEventListener('contextmenu', function (e) { e.preventDefault(); istekayiBirak(); });
        c.addEventListener('pointermove', function (e) {
          var p = pt(e);
          var cue = liveBalls(s).find(function (b) { return b.id === 'cue' && !b.potted; });
          if (!cue) return;
          if (drag) {
            // Geriye çekme mesafesi gücü belirler (klasik bilardo hissi)
            setup.power = Math.max(0.05, Math.min(1, Math.hypot(p.x - start.x, p.y - start.y) / 170));
            if (pw) pw.value = Math.round(setup.power * 100);
          } else {
            setup.aim = Math.atan2(p.y - cue.y, p.x - cue.x);
          }
          redraw();
        });
        c.addEventListener('pointerdown', function (e) {
          if (e.button === 2) { e.preventDefault(); istekayiBirak(); return; }   // sağ tık: bırak
          drag = true; iptal = false; start = pt(e);
          if (c.setPointerCapture) { try { c.setPointerCapture(e.pointerId); } catch (_) {} }
        });
        c.addEventListener('pointerup', function () {
          if (!drag) { iptal = false; return; }
          drag = false;
          if (iptal) { iptal = false; return; }        // iptal edilmiş çekiş vuruş YAPMAZ
          if (setup.power >= 0.05) fire();
        });
        // İmleç masadan çıkarsa çekişi iptal et (yanlışlıkla vuruş olmasın)
        c.addEventListener('pointerleave', function () { if (drag) istekayiBirak(); });
      }
      if (pw) pw.addEventListener('input', function () {
        setup.power = Math.max(0.05, Math.min(1, Number(pw.value) / 100));
        redraw();
      });
      if (el) el.addEventListener('input', function () {
        setup.elevation = Math.max(0, Math.min(60, Number(el.value))) * Math.PI / 180;
        redraw();
      });
      if (spinCv && mine) {
        var setSpin = function (e) {
          var r = spinCv.getBoundingClientRect();
          var R = (r.width || spinCv.width) / 2;
          var dx = (e.clientX - r.left - R) / (R - 6);
          var dy = (e.clientY - r.top - R) / (R - 6);
          var d = Math.hypot(dx, dy);
          if (d > 1) { dx /= d; dy /= d; }          // kaçak vuruş sınırına kırp
          setup.spinX = Math.max(-0.5, Math.min(0.5, dx * 0.5));
          setup.spinY = Math.max(-0.5, Math.min(0.5, -dy * 0.5));
          redraw();
        };
        spinCv.addEventListener('pointerdown', function (e) { setSpin(e); spinCv.__d = true; });
        spinCv.addEventListener('pointermove', function (e) { if (spinCv.__d) setSpin(e); });
        spinCv.addEventListener('pointerup', function () { spinCv.__d = false; });
        spinCv.addEventListener('pointerleave', function () { spinCv.__d = false; });
      }
      if (spinReset) spinReset.addEventListener('click', function () {
        setup.spinX = 0; setup.spinY = 0; redraw();
      });
      if (btn) btn.addEventListener('click', function () { fire(); });
      redraw();
    }
  });
})();
