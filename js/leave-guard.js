/* GameVerse — Oyundan Yanlışlıkla Ayrılmayı Önleme (leave guard)
 *
 *  Aktif online maç SIRASINDA:
 *   - Sayfada gezinme (GV.page / GV.openLobby) veya oda ÇIKIŞ düğmesi
 *     (.gv-leave) → onay penceresi: "Oyunu Terk Etmek İstediğinize Emin
 *     Misiniz? ... mağlup sayılacak ve ceza puanı alacaksınız."
 *     HAYIR → oyunda kal (tıklanan yerde işlem yapılmaz); EVET → tıklanan
 *     yere gidilebilir ve terk işlemi akışına devam eder.
 *   - Pencere 30 sn içinde yanıtlanmazsa kendiliğinden kapanır (oyunda
 *     kalınır); hamle süresi zaten işlediği için cevapsız oyuncu süreden
 *     hükmen mağlup olur ve lobiye yönlendirilir (mevcut sunucu akışı).
 *   - Sekme kapatma / sayfa yenileme → tarayıcının yerel "sayfadan ayrıl"
 *     onayı gösterilir (beforeunload).
 *
 *  Maç durumu bu penceredeki ortak oda soketinden (window.__gvRoomSocket)
 *  gameStarted / gameEnded / playerLeft / disconnect olaylarıyla izlenir;
 *  satranç/tavla/okey istemcilerine dokunmaya gerek yoktur. İzleyici modunda
 *  bekçi devre dışıdır.
 */
(function () {
  'use strict';

  let inGame = false;
  let overlay = null;
  let cdInt = null;
  let pendingYes = null;
  let attachedSock = null;
  let wrapped = false;

  const MODAL_MS = () => Number(window.__gvLeaveGuardModalMs) || 30000;

  function isSpectator() { return !!(window.__gvIsSpectator || window.__gvJoinAsSpectator); }
  function active() { return inGame && !isSpectator(); }

  // ---------- Soket izleme (ortak oda soketi) ----------
  function attach(sock) {
    if (!sock || sock.__gvLeaveGuard) return;
    sock.__gvLeaveGuard = true;
    sock.on('gameStarted', p => { if (p && !p.isSpectator) inGame = true; });
    sock.on('gameEnded', () => { inGame = false; closeModal(); });
    sock.on('playerLeft', () => { /* maç bitişi gameEnded ile de gelebilir; bekçiyi kapatma, oyun sürüyor olabilir (okey 3-4 kişi) */ });
    sock.on('okeyMatchEnded', () => { inGame = false; closeModal(); });
    sock.on('roomClosed', () => { inGame = false; closeModal(); });
    sock.on('disconnect', () => { inGame = false; closeModal(); });
  }
  function scanSock() {
    const s = window.__gvRoomSocket;
    if (s && s !== attachedSock) { attach(s); attachedSock = s; }
  }

  // Terk işlemini GERÇEKLEŞTİR: onay veren oyuncu hükmen mağlup olur (sunucu
  // leaveRoom/playerLeft akışıyla işler), soket kapanır, bekçi sıfırlanır.
  // Bu yapılmazsa hedef fonksiyonun içindeki çağrılar bekçiye tekrar takılır
  // ve "Evet dedim ama yönlendirilmedim" yaşanır.
  function doLeaveNow() {
    inGame = false;
    try { if (typeof window.__gvRealChessLeave === 'function') window.__gvRealChessLeave(); } catch (_) {}
    try {
      const s = window.__gvRoomSocket;
      if (s) {
        if (s.connected) { try { s.emit('leaveRoom'); } catch (_) {} }
        try { s.disconnect(); } catch (_) {}
      }
    } catch (_) {}
  }

  // ---------- Onay penceresi ----------
  function css() {
    if (document.getElementById('gv-leave-guard-style')) return;
    const s = document.createElement('style');
    s.id = 'gv-leave-guard-style';
    s.textContent = `
      .gvlg-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(6,7,20,.82);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center}
      .gvlg-box{background:#12122b;border:1px solid rgba(255,255,255,.16);border-radius:18px;max-width:430px;width:92%;padding:26px;text-align:center;color:#fff;box-shadow:0 24px 70px rgba(0,0,0,.7)}
      .gvlg-box .gvlg-ic{font-size:2.6rem}
      .gvlg-box h2{margin:10px 0 8px;font-size:1.25rem;color:#f9ca24}
      .gvlg-box p{color:#c6c9db;font-size:.93rem;line-height:1.55;margin:0 0 8px}
      .gvlg-box .gvlg-cd{font-size:.8rem;color:#8b8fa9;margin-bottom:16px}
      .gvlg-box .gvlg-cd b{color:#ff6b81;font-variant-numeric:tabular-nums}
      .gvlg-btns{display:flex;gap:10px}
      .gvlg-btns button{flex:1;padding:12px;border:none;border-radius:10px;font-weight:800;font-size:.95rem;cursor:pointer}
      .gvlg-yes{background:linear-gradient(135deg,#e74c3c,#c0392b);color:#fff}
      .gvlg-no{background:linear-gradient(135deg,#00b894,#00a381);color:#fff}
    `;
    document.head.appendChild(s);
  }

  function closeModal() {
    if (overlay) { overlay.remove(); overlay = null; }
    if (cdInt) { clearInterval(cdInt); cdInt = null; }
    pendingYes = null;
  }

  function askLeave(onYes) {
    if (overlay) return; // tek örnek
    css();
    pendingYes = onYes;
    const total = Math.max(1, Math.round(MODAL_MS() / 1000));
    let left = total;
    overlay = document.createElement('div');
    overlay.className = 'gvlg-overlay';
    overlay.innerHTML =
      '<div class="gvlg-box" role="dialog" aria-modal="true">' +
      '<div class="gvlg-ic">⚠️</div>' +
      '<h2>Oyunu Terk Etmek İstediğinize Emin Misiniz?</h2>' +
      '<p>Devam eden maçtan ayrılırsanız <b>hükmen mağlup</b> sayılacak ve <b>ceza puanı</b> alacaksınız.</p>' +
      '<div class="gvlg-cd">Bu uyarı <b class="gvlg-cd-n">' + left + '</b> saniye içinde kendiliğinden kapanır (oyunda kalırsınız).</div>' +
      '<div class="gvlg-btns">' +
      '<button type="button" class="gvlg-yes">🚪 Evet, Terk Et</button>' +
      '<button type="button" class="gvlg-no">🛡️ Hayır, Oyunda Kal</button>' +
      '</div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.gvlg-yes').addEventListener('click', () => {
      const fn = pendingYes;
      closeModal();
      if (typeof fn === 'function') fn();
    });
    overlay.querySelector('.gvlg-no').addEventListener('click', closeModal);
    cdInt = setInterval(() => {
      left--;
      const n = overlay && overlay.querySelector('.gvlg-cd-n');
      if (n) n.textContent = String(Math.max(0, left));
      if (left <= 0) closeModal(); // yanıtsız → oyunda kalır (istek gereği)
    }, 1000);
  }

  // ---------- Gezinme sarmalama (GV.page / GV.openLobby) ----------
  function wrapNav() {
    if (wrapped || !window.GV) return;
    const GV = window.GV;
    ['page', 'openLobby'].forEach(fn => {
      const orig = GV[fn];
      if (typeof orig !== 'function' || orig.__gvLeaveGuard) return;
      const guarded = function () {
        if (!active()) return orig.apply(this, arguments);
        const args = Array.prototype.slice.call(arguments);
        askLeave(() => { doLeaveNow(); orig.apply(GV, args); });
        return undefined;
      };
      guarded.__gvLeaveGuard = true;
      guarded.__gvOriginal = orig;
      GV[fn] = guarded;
    });
    // Oyun içi "Odadan Ayrıl / Lobiye Dön" butonlarının çağırdığı merkez:
    // leaveRoom da aynı onay penceresinden geçirilir (native confirm susturulur).
    if (typeof GV.leaveRoom === 'function' && !GV.leaveRoom.__gvLeaveGuard) {
      const origLeave = GV.leaveRoom;
      const guardedLeave = function () {
        if (!active()) return origLeave.apply(this, arguments);
        const args = Array.prototype.slice.call(arguments);
        askLeave(() => {
          doLeaveNow();
          const oc = window.confirm;
          window.confirm = () => true;
          try { origLeave.apply(GV, args); } finally { window.confirm = oc; }
        });
        return undefined;
      };
      guardedLeave.__gvLeaveGuard = true;
      guardedLeave.__gvOriginal = origLeave;
      GV.leaveRoom = guardedLeave;
    }
    wrapped = true;
  }

  // ---------- Oda çıkış düğmesi (dinamik .gv-leave) ----------
  let bypassOnce = false;
  document.addEventListener('click', e => {
    if (!active() || bypassOnce) return;
    const btn = e.target && e.target.closest ? e.target.closest('.gv-leave') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    askLeave(() => {
      doLeaveNow();
      bypassOnce = true;
      btn.click();
      const gid = (window.st && window.st.curGame) || 'chess';
      setTimeout(() => {
        bypassOnce = false;
        // Onay veren oyuncuyu bastığı/isteyeceği yere GÖTÜR: oyunun lobisi.
        try { if (window.GV && typeof GV.openLobby === 'function') GV.openLobby(gid); } catch (_) {}
      }, 160);
    });
  }, true);

  // ---------- Sekme kapatma / yenileme (yerel tarayıcı onayı) ----------
  window.addEventListener('beforeunload', e => {
    if (!active()) return undefined;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });

  // Test ve hata ayıklama dış kapısı
  Object.defineProperty(window, '__gvLeaveGuard', {
    get: () => ({ inGame, askLeave, closeModal, active })
  });

  setInterval(() => { scanSock(); wrapNav(); }, 800);
  scanSock(); wrapNav();
})();
