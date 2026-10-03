/* GameVerse — Online Kelimelik. Yaşam döngüsü js/online-arena.js'te.
 *
 * Bu dosya YALNIZ çizer ve hamle önerir. Kuralların ve sözlüğün tamamı
 * sunucuda (kelimelik-engine.js): istemci kelime uyduramaz, sözlük
 * denetimini kapatamaz, rakibin ıstakasını göremez (sunucu paketinde yok).
 */
(function () {
  'use strict';
  if (window.__gvKelimelikOnlineLoaded) return;
  window.__gvKelimelikOnlineLoaded = true;

  var define = function (d) {
    if (window.GVArena) return window.GVArena.define(d);
    (window.__gvArenaQueue = window.__gvArenaQueue || []).push(d);
  };

  /* ---- yerel (sunucuya gitmemiş) hamle taslağı -------------------------
     Oyuncu ıstakadan tahtaya taş bırakırken hamle HENÜZ sunucuya gitmez;
     "Onayla" denince tek pakette gider. Taslak burada tutulur. */
  var gecici = [];          // [{r,c,harf,joker,idx}]
  var secili = null;        // ıstakada seçili taşın indeksi
  var takasModu = false, takasSecim = {};
  var sonRet = [];          // sunucunun reddettiği kelimeler (Kelime Bildir)
  var olcek = 0;            // 0 sığdır · 1 orta · 2 yakın
  var OKUNUR_HC = 18, ORTA_HC = 26, YAKIN_HC = 38, BOSLUK = 2, N = 15;
  var KADEME_AD = ['Sığdır', 'Orta', 'Yakın'];

  function sifirla() { gecici = []; secili = null; takasModu = false; takasSecim = {}; sonRet = []; }
  window.addEventListener('gv:roomLeft', sifirla);

  function trBuyuk(s) {
    try { return String(s).toLocaleUpperCase('tr-TR'); }
    catch (_) { return String(s).replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase(); }
  }
  function trKucuk(s) {
    try { return String(s).toLocaleLowerCase('tr-TR'); }
    catch (_) { return String(s).replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase(); }
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
    return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }

  /* tahtanın o anki hâli = sunucu tahtası + yerel taslak */
  function kareOku(s, r, c) {
    for (var i = 0; i < gecici.length; i++) if (gecici[i].r === r && gecici[i].c === c) return gecici[i];
    return s.board[r][c];
  }

  // ------------------------------------------------------------- ÇİZİM
  define({
    id: 'kelimelik', kinds: ['kelimelik'], reject: ['kelimelikRejected'],
    events: {
      /* Sunucu hamleyi reddettiğinde sebebi + reddedilen kelimeleri yollar;
         kelimeler "📣 Kelime Bildir" için saklanır. */
      kelimelikRejected: function (p) {
        if (p && Array.isArray(p.kelimeler) && p.kelimeler.length) {
          sonRet = p.kelimeler.slice(0, 5);
          try {
            if (window.GV && GV.toast)
              GV.toast('📖 Sözlükte yok: ' + sonRet.join(', ') + ' — 📣 Kelime Bildir ile iletebilirsin.', 'warning');
          } catch (_) {}
          try { if (window.GVArena) GVArena.repaint(); } catch (_) {}
        }
      },
      /* Sunucu otomatik pas geçtiğinde oyuncuya sebebini söyle. */
      kelimelikAutoPass: function (p) {
        try {
          if (window.GV && GV.toast)
            GV.toast('⏭️ ' + ((p && p.ad) || 'Oyuncu') + ' için hamle bulunamadı — otomatik pas geçildi.', 'info');
        } catch (_) {}
      },
      kelimelikReported: function () {
        try { if (window.GV && GV.toast) GV.toast('📣 Bildirimin alındı, teşekkürler!', 'success'); } catch (_) {}
      }
    },

    /* Tuvalde değil HTML'de yaşıyor ama rövanşta skor da tahta da aynı
       görünebiliyor; damga ile yeni el mutlaka yeniden çizilir. */
    damga: function (m) {
      var s = m.state || {}, b = s.board || [], p = '', r, c;
      for (r = 0; r < b.length; r++) for (c = 0; c < b[r].length; c++)
        p += b[r][c] ? b[r][c].harf : '.';
      return (s.status || '') + '#' + s.turn + '#' + (s.scores || []).join(':') +
             '#' + (s.bag || 0) + '#' + p + '#' + gecici.length + '#' + secili +
             '#' + (takasModu ? 'T' : '-') + Object.keys(takasSecim).join(',') +
             '#' + olcek + '#' + sonRet.join(',');
    },

    render: function (m) {
      var s = m.state;
      var benim = !m.isSpectator && s.turn === m.seat && s.status === 'playing';
      var istaka = s.rack || [];
      var h = '<div class="kl-wrap">';

      /* durum şeridi + ölçek kumandası */
      var durum = s.status !== 'playing' ? '🏁 Maç bitti.'
        : m.isSpectator ? '👁️ İzliyorsunuz — sıra ' + (s.turn === 0 ? '1. oyuncuda' : '2. oyuncuda')
        : benim ? '👉 <b>Sıra sizde</b> — ıstakadan harf seçip tahtaya bırakın.'
        : '⏳ Rakip oynuyor…';
      h += '<div class="kl-durum"><span class="kl-durum-metin">' + durum + '</span>' +
           '<span class="kl-arac">' +
             '<button class="btn btn-sm kl-kucult" type="button" title="Küçült"' + (olcek === 0 ? ' disabled' : '') + '>➖</button>' +
             '<span class="kl-olcek-et">' + KADEME_AD[olcek] + '</span>' +
             '<button class="btn btn-sm kl-buyut" type="button" title="Büyüt"' + (olcek === 2 ? ' disabled' : '') + '>➕</button>' +
             '<button class="btn btn-sm kl-merkez" type="button" title="Merkeze git">🎯</button>' +
           '</span></div>';

      /* skor / torba şeridi */
      var sk = s.scores || [0, 0];
      h += '<div class="kl-skor">' +
           '<span class="kl-sk' + (s.turn === 0 ? ' aktif' : '') + '">' +
             (m.seat === 0 ? '🔵 Siz' : '🔵 1. oyuncu') + ' <b>' + sk[0] + '</b></span>' +
           '<span class="kl-torba">🎒 ' + (s.bag || 0) + ' taş</span>' +
           '<span class="kl-sk' + (s.turn === 1 ? ' aktif' : '') + '">' +
             (m.seat === 1 ? '🔴 Siz' : '🔴 2. oyuncu') + ' <b>' + sk[1] + '</b></span>' +
           '<span class="kl-pas" title="Üst üste pas — 3 olunca diskalifiye">⏭️ ' +
             ((s.passStreak || [0, 0])[s.turn] || 0) + '/3</span>' +
           '<span class="gv-arena-clock kl-saat">—</span></div>';

      /* tahta */
      h += '<div class="kl-kutu"><div class="kl-tahta">';
      for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
        var b = (s.bonus && s.bonus[r] && s.bonus[r][c]) || '';
        var t = kareOku(s, r, c);
        var yeni = !!(t && t.yeniMi);
        var sn = 'kl-hc' + (b && b !== 'merkez' ? ' ' + b : '') + (b === 'merkez' ? ' merkez' : '');
        if ((s.lastSquares || []).some(function (q) { return q[0] === r && q[1] === c; })) sn += ' son';
        var ic = '';
        if (t) {
          ic = '<span class="kl-tas' + (yeni ? ' yeni' : '') + (t.joker ? ' joker' : '') + '">' +
               esc(t.harf) + '<span class="pv">' + (t.joker ? 0 : (s.puanlar && s.puanlar[t.harf]) || 0) + '</span></span>';
        } else if (b === 'merkez') ic = '★';
        else if (b) ic = b.toUpperCase().replace('2', '²').replace('3', '³');
        h += '<div class="' + sn + '" data-r="' + r + '" data-c="' + c + '">' + ic + '</div>';
      }
      h += '</div></div>';

      /* ıstaka */
      h += '<div class="kl-istaka-kutu"><div class="kl-istaka">';
      if (m.isSpectator) {
        h += '<div class="kl-izleyici">👁️ İzleyicisiniz — ıstaka gizli.</div>';
      } else {
        for (var i = 0; i < 7; i++) {
          var harf = istaka[i];
          if (harf == null) { h += '<div class="kl-rt bos"></div>'; continue; }
          var kullanildi = gecici.some(function (g) { return g.idx === i; });
          h += '<div class="kl-rt' + (secili === i ? ' sec' : '') + (takasSecim[i] ? ' takas' : '') +
               (harf === '*' ? ' joker' : '') + (kullanildi ? ' kullanildi' : '') +
               '" data-i="' + i + '">' + (harf === '*' ? '★' : esc(harf)) +
               '<span class="pv">' + ((s.puanlar && s.puanlar[harf]) || 0) + '</span></div>';
        }
      }
      h += '</div></div>';

      /* kumanda */
      if (!m.isSpectator) {
        var kapali = !benim ? ' disabled' : '';
        h += '<div class="kl-kumanda">' +
          '<button class="btn btn-a kl-onay" type="button"' + kapali + '>✅ <span class="uz">Hamleyi </span>Onayla</button>' +
          '<button class="btn kl-geri" type="button"' + kapali + '>↩️ Geri<span class="uz"> Al</span></button>' +
          '<button class="btn kl-temiz" type="button"' + kapali + '>🧹<span class="uz"> Temizle</span></button>' +
          '<button class="btn kl-karistir" type="button"' + kapali + '>🔀<span class="uz"> Karıştır</span></button>' +
          '<button class="btn kl-takas" type="button"' + kapali + '>' +
            (takasModu ? '✔️ <span class="uz">Değişimi </span>Onayla' : '🔁 <span class="uz">Harf </span>Değiştir') + '</button>' +
          '<button class="btn kl-pas" type="button"' + kapali + '>⏭️ Pas<span class="uz"> Geç</span></button>' +
          '<button class="btn kl-bildir" type="button"' + (sonRet.length ? '' : ' disabled') + '>📣<span class="uz"> Kelime Bildir</span></button>' +
          '</div>';
      }
      return h + '</div>';
    },

    bind: function (root, m) {
      var s = m.state;
      var benim = !m.isSpectator && s.turn === m.seat && s.status === 'playing';
      var tahta = root.querySelector('.kl-tahta');
      var kutu = root.querySelector('.kl-kutu');

      function yeniden() { try { GVArena.repaint(); } catch (_) {} }
      function uyar(t, tur) { try { if (window.GV && GV.toast) GV.toast(t, tur || 'info'); } catch (_) {} }

      // ---------------- ölçek (web + mobil görüntü optimizasyonu) --------
      function gorunurY() { return window.visualViewport ? window.visualViewport.height : window.innerHeight; }
      function sigdirHc(kenar) { return ((kenar - 18) - 8 - (N - 1) * BOSLUK) / N; }
      function alanOlc() {
        var alan = document.getElementById('boardArea');
        var g = alan ? alan.clientWidth : 600;
        var alti = 0;
        ['.kl-istaka-kutu', '.kl-kumanda'].forEach(function (sec) {
          var e = root.querySelector(sec);
          if (e) alti += e.getBoundingClientRect().height + 8;
        });
        var ust = kutu ? kutu.getBoundingClientRect().top : 160;
        var y = gorunurY() - ust - alti - 10;
        return { g: Math.max(150, g), y: Math.max(150, y) };
      }
      function olcuYaz() {
        if (!tahta || !kutu) return;
        var a = alanOlc(), kenar = Math.min(a.g, a.y);
        /* Sığdır kademesinde hücre okunabilirlik eşiğinin altına düşerse
           kademe kendiliğinden yükselir (oyuncu ➖ ile geri dönebilir). */
        if (olcek === 0 && sigdirHc(kenar) < OKUNUR_HC) olcek = 1;
        if (olcek === 0) {
          tahta.classList.remove('yakin');
          tahta.style.width = ''; tahta.style.height = '';
          kutu.style.width = kenar + 'px'; kutu.style.height = '';
          tahta.style.setProperty('--hc', Math.max(4, sigdirHc(kenar)).toFixed(2) + 'px');
        } else {
          var hc = (olcek === 1) ? ORTA_HC : YAKIN_HC;
          var tam = N * hc + (N - 1) * BOSLUK + 8;
          tahta.classList.add('yakin');
          tahta.style.width = tam + 'px'; tahta.style.height = tam + 'px';
          /* Kutu KARE olmak zorunda değil: yakınlaştırmada kaydırılan bir
             penceredir. Kareye zorlanınca yatay telefonda ekranın genişliği
             boşa gidip tahtadan yalnız 7 sütun görünüyordu (ölçüldü). */
          kutu.style.width = Math.min(a.g, tam + 18) + 'px';
          kutu.style.height = Math.min(a.y, tam + 18) + 'px';
          tahta.style.setProperty('--hc', hc + 'px');
        }
        var gercek = parseFloat(tahta.style.getPropertyValue('--hc')) || 0;
        tahta.classList.toggle('ufak', gercek < 17);
        var et = root.querySelector('.kl-olcek-et');
        if (et) et.textContent = KADEME_AD[olcek];
        var kb = root.querySelector('.kl-kucult'), bb = root.querySelector('.kl-buyut');
        if (kb) kb.disabled = (olcek === 0);
        if (bb) bb.disabled = (olcek === 2);
      }
      function merkezeGit() {
        if (!kutu) return;
        kutu.scrollLeft = (kutu.scrollWidth - kutu.clientWidth) / 2;
        kutu.scrollTop = (kutu.scrollHeight - kutu.clientHeight) / 2;
      }
      olcuYaz();
      requestAnimationFrame(olcuYaz);
      if (olcek > 0) requestAnimationFrame(merkezeGit);
      if (root.__klOlcuDinleyici) window.removeEventListener('resize', root.__klOlcuDinleyici);
      root.__klOlcuDinleyici = function () { olcuYaz(); };
      window.addEventListener('resize', root.__klOlcuDinleyici);

      var kb2 = root.querySelector('.kl-kucult');
      if (kb2) kb2.addEventListener('click', function () { if (olcek > 0) { olcek--; olcuYaz(); } });
      var bb2 = root.querySelector('.kl-buyut');
      if (bb2) bb2.addEventListener('click', function () { if (olcek < 2) { olcek++; olcuYaz(); merkezeGit(); } });
      var mb = root.querySelector('.kl-merkez');
      if (mb) mb.addEventListener('click', merkezeGit);

      if (m.isSpectator) return;

      // ---------------- yerleştirme -------------------------------------
      function istakaBos(i) { return s.rack[i] == null || gecici.some(function (g) { return g.idx === i; }); }
      function koy(r, c, i) {
        if (!benim) { uyar('Sıra sizde değil.', 'info'); return; }
        if (kareOku(s, r, c)) return;
        var harf = s.rack[i];
        if (harf == null) return;
        if (harf === '*') { jokerSor(r, c, i); return; }
        gecici.push({ r: r, c: c, harf: harf, joker: false, idx: i });
        secili = null; yeniden();
      }
      function jokerSor(r, c, i) {
        var kat = (window.__gvKaplamaKati ? window.__gvKaplamaKati() : document.body);
        var ov = document.createElement('div');
        ov.className = 'kl-joker-ov';
        ov.innerHTML = '<div class="kl-joker-kart"><h3>★ Joker harfi</h3>' +
          '<p>Joker hangi harfin yerine geçsin? (0 puan)</p><div class="kl-joker-liste">' +
          'ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ'.split('').map(function (x) {
            return '<button type="button" class="btn btn-sm kl-jk" data-h="' + x + '">' + x + '</button>';
          }).join('') + '</div><button type="button" class="btn kl-jk-iptal">Vazgeç</button></div>';
        kat.appendChild(ov);
        ov.querySelectorAll('.kl-jk').forEach(function (b) {
          b.addEventListener('click', function () {
            gecici.push({ r: r, c: c, harf: this.dataset.h, joker: true, idx: i });
            secili = null; ov.remove(); yeniden();
          });
        });
        ov.querySelector('.kl-jk-iptal').addEventListener('click', function () { ov.remove(); });
        ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
      }
      function geriAlKare(r, c) {
        for (var i = 0; i < gecici.length; i++) if (gecici[i].r === r && gecici[i].c === c) {
          gecici.splice(i, 1); yeniden(); return true;
        }
        return false;
      }

      root.querySelectorAll('.kl-rt').forEach(function (x) {
        x.addEventListener('click', function () {
          var i = Number(this.dataset.i);
          if (s.rack[i] == null) return;
          if (takasModu) { takasSecim[i] = !takasSecim[i]; yeniden(); return; }
          if (!benim) { uyar('Sıra sizde değil.', 'info'); return; }
          if (istakaBos(i)) return;
          secili = (secili === i) ? null : i;
          yeniden();
        });
      });
      root.querySelectorAll('.kl-hc').forEach(function (x) {
        x.addEventListener('click', function () {
          var r = Number(this.dataset.r), c = Number(this.dataset.c);
          if (geriAlKare(r, c)) return;
          if (s.board[r][c]) return;
          if (!benim) { uyar('Sıra sizde değil.', 'info'); return; }
          if (secili == null) { uyar('Önce ıstakadan bir harf seç.', 'info'); return; }
          koy(r, c, secili);
        });
      });

      /* sürükle-bırak (fare + dokunmatik tek kod) */
      var srk = null;
      root.querySelectorAll('.kl-rt').forEach(function (t) {
        t.addEventListener('pointerdown', function (e) {
          if (takasModu || !benim) return;
          var i = Number(this.dataset.i);
          if (s.rack[i] == null || istakaBos(i)) return;
          e.preventDefault();
          var k = this.getBoundingClientRect(), kl = this.cloneNode(true);
          kl.className = 'kl-rt kl-hayalet';
          kl.style.width = k.width + 'px'; kl.style.height = k.height + 'px';
          (window.__gvKaplamaKati ? window.__gvKaplamaKati() : document.body).appendChild(kl);
          srk = { i: i, el: kl, kaynak: this, tasindi: false };
          this.style.opacity = '.3';
          tasi(e.clientX, e.clientY);
        });
      });
      function tasi(x, y) {
        if (!srk) return;
        srk.el.style.left = x + 'px'; srk.el.style.top = y + 'px';
        var alt = document.elementFromPoint(x, y);
        var hc = alt && alt.closest ? alt.closest('.kl-hc') : null;
        root.querySelectorAll('.kl-hc.hedef').forEach(function (h) { h.classList.remove('hedef'); });
        if (hc && !kareOku(s, Number(hc.dataset.r), Number(hc.dataset.c))) hc.classList.add('hedef');
      }
      function bitirSurukle(e) {
        if (!srk) return;
        var alt = document.elementFromPoint(e.clientX, e.clientY);
        var hc = alt && alt.closest ? alt.closest('.kl-hc') : null;
        root.querySelectorAll('.kl-hc.hedef').forEach(function (h) { h.classList.remove('hedef'); });
        srk.el.remove(); srk.kaynak.style.opacity = '';
        var i = srk.i, tasindi = srk.tasindi; srk = null;
        if (hc && tasindi) {
          var r = Number(hc.dataset.r), c = Number(hc.dataset.c);
          if (!kareOku(s, r, c)) koy(r, c, i);
        }
      }
      if (root.__klSurukle) {
        document.removeEventListener('pointermove', root.__klSurukle.move);
        document.removeEventListener('pointerup', root.__klSurukle.up);
        document.removeEventListener('pointercancel', root.__klSurukle.cancel);
      }
      root.__klSurukle = {
        move: function (e) { if (!srk) return; srk.tasindi = true; e.preventDefault(); tasi(e.clientX, e.clientY); },
        up: bitirSurukle,
        cancel: function () { if (!srk) return; srk.el.remove(); srk.kaynak.style.opacity = ''; srk = null; }
      };
      document.addEventListener('pointermove', root.__klSurukle.move, { passive: false });
      document.addEventListener('pointerup', root.__klSurukle.up);
      document.addEventListener('pointercancel', root.__klSurukle.cancel);

      // ---------------- kumanda -----------------------------------------
      function dgm(sec, fn) { var e = root.querySelector(sec); if (e) e.addEventListener('click', fn); }
      dgm('.kl-onay', function () {
        if (!benim) return;
        if (!gecici.length) { uyar('Tahtaya hiç harf koymadın.', 'warning'); return; }
        m.emit('kelimelikMove', { konumlar: gecici.map(function (g) {
          return { r: g.r, c: g.c, harf: g.harf, joker: !!g.joker }; }) });
        gecici = []; secili = null;
      });
      dgm('.kl-geri', function () { if (gecici.length) { gecici.pop(); yeniden(); } });
      dgm('.kl-temiz', function () { if (gecici.length) { gecici = []; secili = null; yeniden(); } });
      dgm('.kl-karistir', function () { m.emit('kelimelikShuffle', {}); });
      dgm('.kl-pas', function () {
        if (!benim) return;
        gecici = []; secili = null;
        m.emit('kelimelikPass', {});
      });
      dgm('.kl-takas', function () {
        if (!benim) return;
        if (!takasModu) {
          if (!(s.bag > 0)) { uyar('Torbada taş kalmadı, değişim yapılamaz.', 'warning'); return; }
          gecici = []; secili = null; takasModu = true; takasSecim = {};
          uyar('Değiştirmek istediğin harfleri seç, sonra onayla.', 'info');
          yeniden(); return;
        }
        var sec = Object.keys(takasSecim).filter(function (k) { return takasSecim[k]; }).map(Number);
        if (!sec.length) { uyar('Hiç harf seçmedin.', 'warning'); return; }
        m.emit('kelimelikSwap', { indeksler: sec });
        takasModu = false; takasSecim = {};
      });
      dgm('.kl-bildir', function () { kelimeBildir(m); });
    }
  });

  /* KELİME BİLDİR — Kelimelik'te sözlükte olup oyunda çıkmayan kelimeler
     e-posta ile bildiriliyor. Bizde oyun içinden yönetici paneline düşer. */
  function kelimeBildir(m) {
    if (!sonRet.length) return;
    var kat = (window.__gvKaplamaKati ? window.__gvKaplamaKati() : document.body);
    var ov = document.createElement('div');
    ov.className = 'kl-joker-ov kl-bildir-ov';
    ov.innerHTML = '<div class="kl-joker-kart kl-bildir-kart"><h3>📣 Kelime Bildir</h3>' +
      '<p>Aşağıdaki kelime(ler) sözlüğümüzde bulunamadı. TDK Güncel Türkçe Sözlük\'te ' +
      '<b>madde başı</b> olduğunu düşünüyorsan bildir; yönetici paneline düşer, ' +
      'doğrulanırsa sözlüğe eklenir.</p><div class="kl-bildir-liste">' +
      sonRet.map(function (w, i) {
        return '<label><input type="checkbox" class="kl-bdr" value="' + esc(w) + '"' +
          (i === 0 ? ' checked' : '') + '> <b>' + esc(w) + '</b> ' +
          '<a href="https://sozluk.gov.tr/?q=' + encodeURIComponent(trKucuk(w)) +
          '" target="_blank" rel="noopener">sozluk.gov.tr ↗</a></label>';
      }).join('') + '</div>' +
      '<input type="text" class="kl-bdr-not" maxlength="120" placeholder="Not (isteğe bağlı)">' +
      '<div class="kl-bildir-dgm">' +
        '<button type="button" class="btn btn-p kl-bdr-yolla">📤 Gönder</button>' +
        '<button type="button" class="btn kl-jk-iptal">Vazgeç</button></div></div>';
    kat.appendChild(ov);
    ov.querySelector('.kl-jk-iptal').addEventListener('click', function () { ov.remove(); });
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    ov.querySelector('.kl-bdr-yolla').addEventListener('click', function () {
      var sec = [].slice.call(ov.querySelectorAll('.kl-bdr')).filter(function (x) { return x.checked; })
                  .map(function (x) { return x.value; });
      if (!sec.length) { try { GV.toast('Hiç kelime seçmedin.', 'warning'); } catch (_) {} return; }
      m.emit('kelimelikReport', { kelimeler: sec, not: (ov.querySelector('.kl-bdr-not').value || '').trim() });
      sonRet = [];
      ov.remove();
      try { GVArena.repaint(); } catch (_) {}
    });
  }

  /* Test/teşhis köprüsü */
  window.__gvKelimelik = {
    taslak: function () { return gecici.slice(); },
    olcek: function (k) { if (k != null) olcek = k; return olcek; },
    ret: function () { return sonRet.slice(); },
    sifirla: sifirla
  };
})();
