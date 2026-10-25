/* ============================================================================
 * ŞİFREYİ GÖSTER / GİZLE — sitedeki TÜM parola kutuları
 * ============================================================================
 * Kullanıcı isteği: "Şifre girerken doğru mu girildi yanlış mı girildi bilgisi
 * yok, şifre görünür ikonu ekleyelim. Aynı şekilde şifre değiştirirken de."
 *
 * Her <input type="password"> kutusunun sağına bir göz düğmesi eklenir;
 * dokununca yazılan şifre görünür, tekrar dokununca gizlenir. Giriş, kayıt,
 * parola değiştirme, hesap silme ve "şifremi unuttum → yeni şifre" pencereleri
 * dahil — sonradan JS ile oluşturulan kutular da (MutationObserver) kapsanır.
 *
 * Güvenlik: şifre yalnız kullanıcı isteyince ve yalnız o kutuda görünür;
 * pencere kapanıp yeniden açıldığında ya da form gönderilince kutu tekrar
 * gizli (type=password) hâle döner. Tarayıcının parola yöneticisi kutuyu
 * parola alanı olarak tanımaya devam eder.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvSifreGoster) return;
  window.__gvSifreGoster = true;

  var GOZ = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var GOZ_KAPALI = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function stil() {
    if (document.getElementById('gv-sifre-stil')) return;
    var s = document.createElement('style');
    s.id = 'gv-sifre-stil';
    s.textContent =
      '.gv-pw{position:relative;display:block;width:100%}' +
      '.gv-pw>input{padding-right:46px!important;box-sizing:border-box}' +
      '.gv-pw-btn{position:absolute;right:4px;top:50%;transform:translateY(-50%);' +
        'width:38px;height:38px;display:flex;align-items:center;justify-content:center;' +
        'background:none;border:none;border-radius:8px;padding:0;margin:0;cursor:pointer;' +
        'color:var(--text3,#9aa0b4);-webkit-tap-highlight-color:transparent}' +
      '.gv-pw-btn:hover,.gv-pw-btn:focus-visible{color:var(--text,#fff);background:rgba(255,255,255,.07);outline:none}' +
      '.gv-pw-btn.acik{color:var(--accent,#00cec9)}';
    (document.head || document.documentElement).appendChild(s);
  }

  function gizle(inp, btn) {
    inp.type = 'password';
    btn.innerHTML = GOZ;
    btn.classList.remove('acik');
    btn.setAttribute('aria-label', 'Şifreyi göster');
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Şifreyi göster';
  }
  function goster(inp, btn) {
    inp.type = 'text';
    btn.innerHTML = GOZ_KAPALI;
    btn.classList.add('acik');
    btn.setAttribute('aria-label', 'Şifreyi gizle');
    btn.setAttribute('aria-pressed', 'true');
    btn.title = 'Şifreyi gizle';
  }

  function donat(inp) {
    if (!inp || inp.__gvPw || !inp.parentNode) return;
    inp.__gvPw = true;
    stil();
    var sar = document.createElement('span');
    sar.className = 'gv-pw';
    /* Kutunun dış boşluğu sarmalayıcıya taşınır ki göz düğmesi kutunun
       TAM ortasında dursun (bazı kutular satır içi margin taşıyor). */
    try {
      var cs = window.getComputedStyle(inp);
      sar.style.marginTop = cs.marginTop; sar.style.marginBottom = cs.marginBottom;
      inp.style.marginTop = '0'; inp.style.marginBottom = '0';
    } catch (_) {}
    inp.parentNode.insertBefore(sar, inp);
    sar.appendChild(inp);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gv-pw-btn';
    btn.tabIndex = 0;
    gizle(inp, btn);
    /* Dokunuşta kutu odağını kaybetmesin (telefonda klavye kapanmasın). */
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (inp.type === 'password') goster(inp, btn); else gizle(inp, btn);
      try {
        inp.focus();
        var n = inp.value.length; inp.setSelectionRange(n, n);
      } catch (_) {}
    });
    sar.appendChild(btn);
    inp.__gvPwBtn = btn;
    if (inp.form) inp.form.addEventListener('submit', function () { gizle(inp, btn); });
  }

  function tara(kok) {
    var k = kok || document;
    if (k.nodeType === 1 && k.matches && k.matches('input[type="password"]')) donat(k);
    if (!k.querySelectorAll) return;
    var l = k.querySelectorAll('input[type="password"]');
    for (var i = 0; i < l.length; i++) donat(l[i]);
  }

  /* Pencere kapanınca (modal "show" sınıfını kaybedince) açık bırakılan
     şifre yeniden gizlenir. */
  function pencereKapandi(m) {
    var l = m.querySelectorAll ? m.querySelectorAll('input') : [];
    for (var i = 0; i < l.length; i++) {
      if (l[i].__gvPwBtn && l[i].type === 'text') gizle(l[i], l[i].__gvPwBtn);
    }
  }

  function kur() {
    tara(document);
    try {
      new MutationObserver(function (kayitlar) {
        for (var i = 0; i < kayitlar.length; i++) {
          var k = kayitlar[i];
          if (k.type === 'childList') {
            for (var j = 0; j < k.addedNodes.length; j++) {
              var n = k.addedNodes[j];
              if (n.nodeType === 1) tara(n);
            }
          } else if (k.type === 'attributes' && k.target.classList &&
                     k.target.classList.contains('modal-bg') && !k.target.classList.contains('show')) {
            pencereKapandi(k.target);
          }
        }
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kur, { once: true });
  else kur();

  window.GVSifre = { tara: tara };
})();
