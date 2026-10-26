/* ============================================================================
 * ŞİFRELİ ÖZEL MASA — istemci
 * ============================================================================
 * Kullanıcı isteği: "Özel oluşturulan masalarda oda kurucuları şifre
 * belirleyebilir ve şifreyi bilen diğer üyeler odalara şifreyle katılabilir.
 * Ya kurucu daveti ile ya da şifre ile odaya katılabilirler."
 *
 *   · Masa Oluştur → "Özel Oda" seçilince "Oda Şifresi" alanı çıkar. Masa
 *     kurulup kurucu oturunca şifre sunucuya yazılır.
 *   · Masadaki kurucu "🔐 Şifre" düğmesiyle şifreyi değiştirir/kaldırır.
 *   · Şifreli masalar lobide 🔐 ile görünür; "Şifreyle Katıl" şifreyi sorar.
 *     Masa numarasını bilen üye lobideki "🔐 Şifreli Masaya Katıl" ile de
 *     girebilir. Doğru şifre üyeyi davetli sayar; ziyaretçi giremez.
 * Kimlik, PHP'nin imzaladığı üyelik belgesiyle (GVAuth.attestation) taşınır.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.GVOdaSifre) return;
  var BACKEND = String(window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com').replace(/\/+$/, '');

  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(m, t) { try { if (window.GV && GV.toast) GV.toast(m, t || 'info'); } catch (_) {} }
  function uye() { return !!(window.st && st.user && !st.isGuest && Number(st.user.id) > 0); }
  function belge() { try { return window.GVAuth && GVAuth.attestation ? GVAuth.attestation() : null; } catch (_) { return null; } }
  function post(yol, govde) {
    return fetch(BACKEND + yol, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ att: belge() }, govde || {})) })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: 'Sunucuya ulaşılamadı.' }; });
  }

  function stil() {
    if (document.getElementById('gv-oda-sifre-stil')) return;
    var s = document.createElement('style');
    s.id = 'gv-oda-sifre-stil';
    s.textContent =
      '.gos-modal{max-width:400px;width:92%}' +
      '.gos-modal label{display:block;margin:12px 0 6px;color:var(--text2);font-size:.85em;text-align:left}' +
      '.gos-modal input{width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);box-sizing:border-box}' +
      '.gos-hata{min-height:1.2em;margin-top:8px;font-size:.84em;color:#ff7675;text-align:left}' +
      '.gos-not{font-size:.78em;color:var(--text3);margin-top:10px;line-height:1.5;text-align:left}' +
      '.gos-dugmeler{display:flex;gap:10px;margin-top:16px}.gos-dugmeler .btn{flex:1}';
    (document.head || document.documentElement).appendChild(s);
  }

  /* Ortak küçük pencere */
  function pencere(baslik, govdeHtml, onay, onayAd) {
    stil();
    var m = document.getElementById('gvOdaSifreModal');
    if (!m) {
      m = document.createElement('div');
      m.className = 'modal-bg'; m.id = 'gvOdaSifreModal';
      ((window.__gvKaplamaKati && window.__gvKaplamaKati()) || document.body).appendChild(m);
      m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('show'); });
    }
    m.innerHTML = '<div class="modal gos-modal"><button class="modal-x" type="button" aria-label="Kapat">✕</button>' +
      '<h2 style="margin:0 0 4px;font-size:1.2em">' + baslik + '</h2>' + govdeHtml +
      '<div class="gos-hata" id="gosHata"></div>' +
      '<div class="gos-dugmeler"><button class="btn btn-s" type="button" data-iptal>İptal</button>' +
      '<button class="btn btn-p" type="button" data-onay>' + (onayAd || 'Tamam') + '</button></div></div>';
    m.querySelector('.modal-x').onclick = m.querySelector('[data-iptal]').onclick = function () { m.classList.remove('show'); };
    var b = m.querySelector('[data-onay]');
    var calis = function () {
      if (b.disabled) return;
      b.disabled = true;
      Promise.resolve(onay(m)).then(function (kapat) {
        b.disabled = false;
        if (kapat) m.classList.remove('show');
      }, function () { b.disabled = false; });
    };
    b.onclick = calis;
    m.querySelectorAll('input').forEach(function (i) {
      i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); calis(); } });
    });
    if (window.GV && GV.showModal) GV.showModal('gvOdaSifreModal'); else m.classList.add('show');
    try { if (window.GVSifre) GVSifre.tara(m); } catch (_) {}
    setTimeout(function () { var i = m.querySelector('input:not([readonly])'); if (i) try { i.focus(); } catch (_) {} }, 80);
    return m;
  }
  function hata(m) { var h = document.getElementById('gosHata'); if (h) h.textContent = m || ''; }

  function uyeUyarisi() {
    if (window.GVCanli && GVCanli.bilgi) {
      return GVCanli.bilgi({ baslik: '🔐 Şifreli Masa', ikon: '🔐',
        altBaslik: 'Şifreli masalara yalnızca üyeler katılabilir',
        metin: 'Şifreli bir özel masaya girmek için üye girişi yapın. Üyelik ücretsizdir.',
        dugmeler: [{ ad: '🔑 Üye Girişi Yap', fn: function () { GV.showModal('loginModal'); } },
                   { ad: '📝 Üye Ol', sinif: 'btn-o', fn: function () { GV.showModal('registerModal'); } }] });
    }
    if (window.GV && GV.showModal) GV.showModal('guestPromptModal');
  }

  /* Şifreyle katıl — roomId verilmezse masa numarası da sorulur. */
  function sor(roomId, gameId) {
    if (!uye()) return uyeUyarisi();
    var govde = (roomId
      ? '<p style="margin:6px 0 0;color:var(--text2);font-size:.9em;text-align:left">Masa <b>#' + esc(roomId) + '</b> şifreyle korunuyor.</p>'
      : '<label for="gosNo">Masa numarası</label><input id="gosNo" type="text" inputmode="numeric" placeholder="Örn: 4821" autocomplete="off">') +
      '<label for="gosSifre">Masa şifresi</label><input id="gosSifre" type="password" autocomplete="off" placeholder="Kurucunun verdiği şifre">' +
      '<div class="gos-not">Şifreyi masa kurucusundan öğrenebilirsin. Kurucu seni davet ederse şifre gerekmez.</div>';
    pencere('🔐 Şifreli Masaya Katıl', govde, function () {
      var no = roomId || String((document.getElementById('gosNo') || {}).value || '').replace(/[^0-9]/g, '');
      var sifre = String((document.getElementById('gosSifre') || {}).value || '');
      if (!no) { hata('Masa numarasını yazın.'); return false; }
      if (!sifre) { hata('Şifreyi yazın.'); return false; }
      hata('');
      return post('/api/rooms/' + encodeURIComponent(no) + '/sifre-dene', { sifre: sifre }).then(function (r) {
        if (!r || !r.ok) {
          if (r && r.uyeGerekli) { uyeUyarisi(); return true; }
          hata((r && r.error) || 'Katılınamadı.');
          return false;
        }
        toast('🔓 Şifre doğru — ' + (r.name || ('Masa #' + r.roomId)) + ' masasına giriliyor.', 'success');
        if (window.st) st.curGame = r.gameId || gameId || st.curGame;
        setTimeout(function () { if (window.GV && GV.joinRoom) GV.joinRoom(String(r.roomId)); }, 50);
        return true;
      });
    }, '🔓 Katıl');
  }

  /* Kurucu: şifreyi yaz (masa kurulunca sunucuda oluşması birkaç saniye
     sürebilir — kurucu oturana kadar kısa aralıklarla yeniden denenir). */
  function belirle(roomId, sifre, sessiz) {
    var deneme = 0;
    return new Promise(function (coz) {
      (function dene() {
        post('/api/rooms/' + encodeURIComponent(roomId) + '/sifre-belirle', { sifre: sifre }).then(function (r) {
          if (r && r.ok) {
            if (!sessiz) toast(r.sifreli
              ? '🔐 Masa şifresi ayarlandı. Masa No: #' + roomId + ' — şifreyi verdiğin üyeler lobideki "🔐 Şifreyle Katıl" ile girebilir.'
              : '🔓 Masa şifresi kaldırıldı — artık yalnız davetliler girebilir.', 'success');
            return coz(r);
          }
          if (r && r.bekle && deneme++ < 12) return setTimeout(dene, 1500);
          if (!sessiz) toast('⚠️ ' + ((r && r.error) || 'Şifre ayarlanamadı.'), 'error');
          coz(r);
        });
      })();
    });
  }

  function degistir() {
    var r = window.__gvActiveRoom || {};
    var id = r.id || (window.st && st.curRoom);
    if (!id) return;
    pencere('🔐 Masa Şifresi', '<p style="margin:6px 0 0;color:var(--text2);font-size:.9em;text-align:left">Masa <b>#' + esc(id) +
      '</b>. Şifreyi bilen üyeler davetsiz katılabilir. Boş bırakırsan şifre kaldırılır.</p>' +
      '<label for="gosYeni">Yeni şifre</label><input id="gosYeni" type="password" maxlength="32" autocomplete="new-password" placeholder="3-32 karakter">',
      function () {
        var s = String((document.getElementById('gosYeni') || {}).value || '').trim();
        if (s && (s.length < 3 || s.length > 32)) { hata('Şifre 3-32 karakter olmalı.'); return false; }
        return belirle(id, s).then(function (x) { return !!(x && x.ok); });
      }, 'Kaydet');
  }

  /* Masadaki kurucuya "🔐 Şifre" düğmesi. */
  function dugmeTazele() {
    var bar = document.querySelector('#pg-room .gr-actions');
    if (!bar) return;
    var r = window.__gvActiveRoom || null;
    var benim = !!(r && r.isPrivate && uye() && Number(r.creatorId) === Number(st.user.id));
    var b = document.getElementById('gvOdaSifreBtn');
    if (benim && !b) {
      b = document.createElement('button');
      b.id = 'gvOdaSifreBtn'; b.type = 'button'; b.className = 'btn btn-o btn-sm';
      b.title = 'Özel masa şifresini belirle / değiştir';
      b.textContent = '🔐 Şifre';
      b.addEventListener('click', degistir);
      bar.insertBefore(b, bar.firstChild ? bar.firstChild.nextSibling : null);
    }
    if (b) b.style.display = benim ? '' : 'none';
  }
  setInterval(dugmeTazele, 1500);

  /* Masa Oluştur penceresi: "Özel Oda" seçilince şifre alanı. */
  function olusturAlani() {
    var tur = document.getElementById('crRoomType');
    if (!tur || document.getElementById('crSifreGrup')) return;
    var g = document.createElement('div');
    g.id = 'crSifreGrup';
    g.style.cssText = 'margin-bottom:15px;text-align:left;display:none';
    g.innerHTML = '<label style="display:block;margin-bottom:6px;color:var(--text2);font-size:.85em">🔐 Oda Şifresi (isteğe bağlı):</label>' +
      '<input type="password" id="crRoomPass" maxlength="32" autocomplete="new-password" placeholder="Boş bırakırsan yalnız davetliler girer" class="inp" ' +
      'style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);box-sizing:border-box">' +
      '<div style="font-size:.74em;color:var(--text3);margin-top:5px">Şifreyi verdiğin üyeler lobideki 🔐 ile davetsiz katılabilir.</div>';
    var kap = tur.parentNode;
    kap.parentNode.insertBefore(g, kap.nextSibling);
    var guncelle = function () { g.style.display = tur.value === 'private' ? '' : 'none'; };
    tur.addEventListener('change', guncelle);
    guncelle();
    try { if (window.GVSifre) GVSifre.tara(g); } catch (_) {}
  }

  /* GV.createRoom'u sar: özel + şifre yazıldıysa masa kurulunca şifreyi ayarla. */
  function sar() {
    if (!window.GV || !GV.createRoom || GV.createRoom.__gvSifre) return false;
    var asil = GV.createRoom;
    var yeni = function () {
      var tur = document.getElementById('crRoomType');
      var inp = document.getElementById('crRoomPass');
      var sifre = (tur && tur.value === 'private' && inp) ? String(inp.value || '').trim() : '';
      if (sifre && (sifre.length < 3 || sifre.length > 32)) { toast('Oda şifresi 3-32 karakter olmalı.', 'warning'); return; }
      if (inp) inp.value = '';
      var sonuc = asil.apply(this, arguments);
      var rid = window.st && st.roomConfig && st.roomConfig.isPrivate ? st.roomConfig.roomId : null;
      if (sifre && rid) setTimeout(function () { belirle(rid, sifre); }, 1200);
      return sonuc;
    };
    yeni.__gvSifre = true;
    GV.createRoom = yeni;
    try { window.createRoom = yeni; } catch (_) {}
    return true;
  }

  function kur() { olusturAlani(); if (!sar()) setTimeout(kur, 500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kur, { once: true });
  else kur();

  window.GVOdaSifre = { sor: sor, belirle: belirle, degistir: degistir };
})();
