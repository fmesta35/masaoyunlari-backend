/* GameVerse — Online Kelimelik. Yaşam döngüsü js/online-arena.js'te.
 *
 * Bu dosya YALNIZ çizer ve hamle önerir. Kuralların ve sözlüğün tamamı
 * sunucuda (kelimelik-engine.js): istemci kelime uyduramaz, sözlük
 * denetimini kapatamaz, rakibin ıstakasını göremez (sunucu paketinde yok).
 *
 * ÖNEMLİ TASARIM — NEDEN YEREL DEĞİŞİKLİKLER TAHTAYI YENİDEN ÇİZMEZ?
 * İlk sürümde ıstakadan bir taş seçmek ya da tahtaya bırakmak GVArena.repaint()
 * çağırıyordu; bu da 225 hücre + ıstaka + kumandayı innerHTML ile BAŞTAN
 * yazıyordu. Sonuç (kullanıcı raporu: "ekranda harf takılmaları var, sürükle
 * ve harfi yerine bırakma durumları"): sürükleme sırasında kaynak düğüm
 * DOM'dan düşüyor, hayalet taş ekranda asılı kalıyor, dokunmatikte bırakma
 * ıskalanıyordu. Artık yerel hamle taslağı DOĞRUDAN DOM'a işlenir (tek hücre
 * + tek ıstaka taşı); tam çizim yalnız SUNUCU durumu değiştiğinde yapılır.
 * Bu yüzden damga() yerel duruma (taslak/seçim) BAKMAZ.
 */
(function () {
  'use strict';
  if (window.__gvKelimelikOnlineLoaded) return;
  window.__gvKelimelikOnlineLoaded = true;

  var define = function (d) {
    if (window.GVArena) return window.GVArena.define(d);
    (window.__gvArenaQueue = window.__gvArenaQueue || []).push(d);
  };

  var N = 15;

  /* ---- yerel (sunucuya gitmemiş) hamle taslağı ------------------------- */
  var gecici = [];        // [{r,c,harf,joker,idx}] — tahtaya bırakılmış, onaylanmamış
  var bekleyen = [];      // sunucuya gönderildi, yanıt bekleniyor
  var secili = null;      // ıstakada seçili taşın indeksi
  var takasModu = false, takasSecim = {};
  var sonRet = [];        // sunucunun reddettiği kelimeler (Kelime Bildir)
  var sonHamleSayisi = -1;

  function sifirla() {
    gecici = []; bekleyen = []; secili = null;
    takasModu = false; takasSecim = {}; sonRet = []; sonHamleSayisi = -1;
  }
  window.addEventListener('gv:roomLeft', sifirla);

  function trKucuk(s) {
    try { return String(s).toLocaleLowerCase('tr-TR'); }
    catch (_) { return String(s).replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase(); }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c];
    });
  }
  function ses(ad) { try { if (window.GVDeniz && GVDeniz.ses) GVDeniz.ses.cal(ad); } catch (_) {} }
  function uyar(t, tur) { try { if (window.GV && GV.toast) GV.toast(t, tur || 'info'); } catch (_) {} }

  /* tahtanın o anki hâli = sunucu tahtası + yerel taslak + bekleyen */
  function taslakta(r, c) {
    var i;
    for (i = 0; i < gecici.length; i++) if (gecici[i].r === r && gecici[i].c === c) return gecici[i];
    for (i = 0; i < bekleyen.length; i++) if (bekleyen[i].r === r && bekleyen[i].c === c) return bekleyen[i];
    return null;
  }
  function kareOku(s, r, c) { return taslakta(r, c) || s.board[r][c]; }
  /* YALNIZ bu turda konmuş, henüz onaylanmamış taş (gecici). Sürüklenebilen
     tek taş budur: 'bekleyen' sunucuya gönderilmiştir, tahtadaki eski taşlar
     ise kalıcıdır. */
  function taslakBul(r, c) {
    for (var i = 0; i < gecici.length; i++)
      if (gecici[i].r === r && gecici[i].c === c) return gecici[i];
    return null;
  }
  function istakaKullanildi(i) {
    var k;
    for (k = 0; k < gecici.length; k++) if (gecici[k].idx === i) return true;
    for (k = 0; k < bekleyen.length; k++) if (bekleyen[k].idx === i) return true;
    return false;
  }

  function bonusEtiketi(b) {
    if (b === 'merkez') return '★';
    if (!b) return '';
    return b.toUpperCase().replace('2', '²').replace('3', '³');
  }
  function tasHtml(t, puanlar, yeniMi) {
    return '<span class="kl-tas' + (yeniMi ? ' yeni' : '') + (t.joker ? ' joker' : '') + '">' +
      esc(t.harf) + '<span class="pv">' + (t.joker ? 0 : (puanlar && puanlar[t.harf]) || 0) +
      '</span></span>';
  }

  /* ------------------------------------------------------------- HAMLE SESİ
     Kullanıcı isteği: "Bonus puanlarda ses efekti ayrı olsun, hamle oynama
     sesleri de olsun taş koyma ve kaldırma."
     Taş koyma/kaldırma sesleri doğrudan sürükle-bırak kodundan çalar
     (klTas / klGeri). Buradaki üçlü ise SUNUCU bir hamleyi kabul ettiğinde
     çalar; kendi hamlen de rakibinki de duyulur, çünkü ikisi de aynı
     history akışından gelir. Öncelik: bingo > bonus > sade onay — tek
     hamlede üç ses üst üste binmesin.
     onceki < 0 ise bu ilk çizimdir (odaya yeni girildi ya da sayfa
     tazelendi): geçmişteki bütün hamleler için ses çalmak saçma olur,
     sessiz geçilir. */
  function hamleSesi(h, onceki) {
    if (onceki < 0 || h.length <= onceki) return;
    var bingo = false, bonus = false, hamle = false, i;
    for (i = onceki; i < h.length; i++) {
      if (!h[i] || h[i].tur !== 'move') continue;
      hamle = true;
      if (h[i].bingo) bingo = true;
      else if (h[i].bonus) bonus = true;
    }
    if (bingo) ses('klBingo');
    else if (bonus) ses('klBonus');
    else if (hamle) ses('klOnay');
  }

  /* ------------------------------------------------------------- HAMLE KAYDI
     Kullanıcı isteği: "Oyunlarda yapılan hamleler de kazanılan puanlar ve
     kelimeler not edilsin." Sunucu her hamleyi history'de yolluyor; buraya
     odanın kendi "📝 Hamleler" paneline (#moveHist) yazılır. */
  function hamleleriYaz(m) {
    var el = document.getElementById('moveHist');
    if (!el) return;
    var s = m.state, h = s.history || [];
    if (h.length === sonHamleSayisi && el.childElementCount) return;
    var onceki = sonHamleSayisi;
    sonHamleSayisi = h.length;
    hamleSesi(h, onceki);
    var benim = function (seat) { return !m.isSpectator && seat === m.seat; };
    var ad = function (seat) { return benim(seat) ? 'Siz' : (seat === 0 ? '1. oyuncu' : '2. oyuncu'); };
    if (!h.length) {
      el.innerHTML = '<div class="mv" style="opacity:.6"><span>—</span><span>Henüz hamle yok.</span></div>';
      return;
    }
    el.innerHTML = h.map(function (g, i) {
      var sol = '<span>' + (i + 1) + '.</span>', sag = '';
      if (g.tur === 'move') {
        sag = '<b style="color:' + (benim(g.seat) ? 'var(--accent)' : 'var(--danger)') + '">' + ad(g.seat) + '</b> ' +
              esc((g.kelimeler || []).join(' + ')) +
              ' <b style="color:var(--success)">+' + Number(g.puan || 0) + '</b>' +
              (g.bingo ? ' 🎉' : (g.bonus ? ' ✨' : ''));
      } else if (g.tur === 'swap') {
        sag = '<b>' + ad(g.seat) + '</b> ' + Number(g.adet || 0) + ' harf değiştirdi';
      } else if (g.tur === 'auto') {
        sag = '<b>' + ad(g.seat) + '</b> hamle bulamadı — otomatik pas';
      } else if (g.tur === 'pass') {
        sag = '<b>' + ad(g.seat) + '</b> pas geçti (' + Number(g.pas || 0) + '/3)';
      } else if (g.tur === 'dq') {
        sag = '<b style="color:var(--danger)">' + ad(g.seat) + '</b> diskalifiye (3 pas)';
      } else if (g.tur === 'resign') {
        sag = '<b style="color:var(--danger)">' + ad(g.seat) + '</b> pes etti';
      } else return '';
      return '<div class="mv">' + sol + '<span>' + sag + '</span></div>';
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  /* Torba ve üst üste pas bilgisi tahtanın ÜSTÜNDEN kaldırıldı (kullanıcı
     isteği); yan panelde hamle listesinin altında tek satır olarak durur. */
  function durumSeridiYaz(m) {
    var kart = document.getElementById('moveHist');
    if (!kart || !kart.parentNode) return;
    var el = document.getElementById('klYanDurum');
    if (!el) {
      el = document.createElement('div');
      el.id = 'klYanDurum';
      el.className = 'kl-yan-durum';
      kart.parentNode.appendChild(el);
    }
    var s = m.state;
    el.innerHTML = '🎒 <b>' + (s.bag || 0) + '</b> taş · ⏭️ üst üste pas <b>' +
      ((s.passStreak || [0, 0])[s.turn] || 0) + '/3</b>';
  }

  // ------------------------------------------------------------- ADAPTÖR
  define({
    id: 'kelimelik', kinds: ['kelimelik'], reject: ['kelimelikRejected'],
    events: {
      /* Sunucu hamleyi reddettiğinde taslak GERİ VERİLİR (oyuncu yeniden
         dizmek zorunda kalmasın) ve reddedilen kelimeler Kelime Bildir için
         saklanır. */
      kelimelikRejected: function (p) {
        if (bekleyen.length) { gecici = bekleyen.slice(); bekleyen = []; }
        if (p && Array.isArray(p.kelimeler) && p.kelimeler.length) {
          sonRet = p.kelimeler.slice(0, 5);
          /* "BUNU MU DEMEK İSTEDİN" — kullanıcı raporu: "MARMALAT kelimesi
             nasıl Türkçe olmaz". Doğrusu MARMELAT'tı ve sözlükte VARDI; oyuncu
             bunu göremediği için sözlüğü eksik sanıyordu. Sunucu yakın yazımları
             da yolluyor (kelimelik-engine.js benzerKelimeler). */
          var oneriMetin = '';
          if (p.oneriler) {
            var parcalar = [];
            for (var w in p.oneriler) {
              if (!Object.prototype.hasOwnProperty.call(p.oneriler, w)) continue;
              var liste = p.oneriler[w] || [];
              if (liste.length) parcalar.push(liste.join(' / '));
            }
            if (parcalar.length) oneriMetin = ' Bunu mu demek istedin: ' + parcalar.join(' · ') + '?';
          }
          uyar('📖 Sözlükte yok: ' + sonRet.join(', ') + '.' + oneriMetin +
               ' 📣 Kelime Bildir ile iletebilirsin.', 'warning');
        } else {
          /* ÖNCEDEN: sözlük dışı sebeplerde (temas yok, arada boşluk, tek hat
             değil…) HİÇBİR açıklama gösterilmiyordu — taşlar geri dönüyor,
             oyuncu "kelimemi kabul etmedi" sanıyordu. Ortak sözlük taşıyıcı
             (GVMsg) her sebebi Türkçe cümleye çevirir. */
          var neden = (window.GVMsg && GVMsg.red) ? GVMsg.red(p && p.reason)
                                                  : 'Bu hamle oyunun kurallarına uymuyor.';
          uyar(neden, 'warning');
        }
        ses('klRed');
        try { if (window.GVArena) GVArena.repaint(); } catch (_) {}
      },
      kelimelikAutoPass: function (p) {
        uyar('⏭️ ' + ((p && p.ad) || 'Oyuncu') + ' için hamle bulunamadı — otomatik pas geçildi.', 'info');
      },
      kelimelikReported: function () { uyar('📣 Bildirimin alındı, teşekkürler!', 'success'); }
    },

    /* Damga YALNIZ sunucu durumunu özetler: yerel seçim/taslak değişince
       tahta yeniden çizilmesin diye (bkz. dosya başındaki not). */
    damga: function (m) {
      var s = m.state || {}, b = s.board || [], p = '', r, c;
      for (r = 0; r < b.length; r++) for (c = 0; c < b[r].length; c++)
        p += b[r][c] ? b[r][c].harf : '.';
      return (s.status || '') + '#' + s.turn + '#' + (s.scores || []).join(':') +
             '#' + (s.bag || 0) + '#' + (s.rack || []).join('') + '#' + p;
    },

    render: function (m) {
      var s = m.state;
      bekleyeniTazele(s);          // onaylanan hamle bekleyenden düşsün
      var benim = !m.isSpectator && s.turn === m.seat && s.status === 'playing';
      var istaka = s.rack || [];
      var h = '<div class="kl-wrap">';

      /* TAHTA — üstünde hiçbir bilgi şeridi yok (kullanıcı isteği:
         "oyun üzerindeki bilgiler kalksın, yakınlaştırma - ve + kalksın").
         Sıra/süre/skor yan paneldeki süre kartlarında ve skor panosunda. */
      h += '<div class="kl-kutu"><div class="kl-tahta">';
      for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
        var b = (s.bonus && s.bonus[r] && s.bonus[r][c]) || '';
        var t = kareOku(s, r, c);
        var tasl = !!taslakta(r, c);
        var sn = 'kl-hc' + (b && b !== 'merkez' ? ' ' + b : '') + (b === 'merkez' ? ' merkez' : '');
        if (!tasl && (s.lastSquares || []).some(function (q) { return q[0] === r && q[1] === c; })) sn += ' son';
        h += '<div class="' + sn + '" data-r="' + r + '" data-c="' + c + '">' +
             (t ? tasHtml(t, s.puanlar, tasl) : bonusEtiketi(b)) + '</div>';
      }
      h += '</div></div>';

      /* ISTAKA + KUMANDA ortak sarıcıda.
         Kullanıcı isteği: "mobilde tam ekran yaptığımda ve yatay görüntüye
         geçtiğimde görüntü optimizasyonu korunamadı... yatay ve dikey
         otomatik optimizasyon." Alçak/geniş ekranda bu sarıcı tahtanın ALTINA
         değil YANINA geçer (bkz. olcuYaz → kl-yatay); dikeyde eskisi gibi
         alt alta durur. */
      h += '<div class="kl-sag">';

      /* ıstaka */
      h += '<div class="kl-istaka-kutu"><div class="kl-istaka">';
      if (m.isSpectator) {
        h += '<div class="kl-izleyici">👁️ İzleyicisiniz — ıstaka gizli.</div>';
      } else {
        for (var i = 0; i < 7; i++) {
          var harf = istaka[i];
          if (harf == null) { h += '<div class="kl-rt bos"></div>'; continue; }
          h += '<div class="kl-rt' + (secili === i ? ' sec' : '') + (takasSecim[i] ? ' takas' : '') +
               (harf === '*' ? ' joker' : '') + (istakaKullanildi(i) ? ' kullanildi' : '') +
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
      h += '</div>';            // .kl-sag
      return h + '</div>';
    },

    bind: function (root, m) {
      var s = m.state;
      var benim = !m.isSpectator && s.turn === m.seat && s.status === 'playing';
      /* Teşhis: bu çizimde sürükleme/tıklama açık mıydı? (testte ve hata
         ayıklamada "neden tepki vermedi" sorusunu tek bakışta yanıtlar.) */
      window.__gvKelimelikTani = { benim: benim, turn: s.turn, seat: m.seat,
                                   izleyici: !!m.isSpectator, durum: s.status,
                                   rack: (s.rack || []).join(',') };
      var tahta = root.querySelector('.kl-tahta');
      var kutu = root.querySelector('.kl-kutu');

      hamleleriYaz(m);
      durumSeridiYaz(m);

      /* --------------------------------------------------------- ÖLÇÜ
         Yakınlaştırma kademeleri KALDIRILDI (kullanıcı isteği). Tahta her
         zaman kalan alana TAM OTURUR; sayfa aşağı kaydırılmadan en büyük
         hâlinde görünür. Tam ekranda da aynı hesap geçerli, oraya daha çok
         yer kaldığı için tahta kendiliğinden büyür. */
      function gorunurY() {
        var vv = window.visualViewport;
        return Math.max(200, Math.round((vv && vv.height) ? vv.height : (window.innerHeight || 600)));
      }
      function olc(sec) {
        var e = root.querySelector(sec);
        return e ? e.getBoundingClientRect().height : 0;
      }
      /* TEK ÖLÇÜ YERİ — dikey ve yatay, normal ve tam ekran.
         ÖLÇÜLEN HATA: yükseklik bütçesi tahtanın o anki EKRAN KONUMUNDAN
         (getBoundingClientRect().top) çıkarılıyordu. Bu değer hem sayfa
         kaydırmasına hem de bir önceki ölçüye bağlı olduğu için, telefonda
         sayfa biraz kayınca bütçe şişiyor, tahta kendi kutusundan taşıp
         ıstakanın üstüne biniyordu (kullanıcı raporu: "harfler oyun alanının
         içerisinde kalıyor"). Artık bütçe boardArea'nın KENDİ kutusundan
         okunuyor ve ekranın altıyla sınırlanıyor.

         YATAY YERLEŞİM: ekran genişse ve alçaksa (telefon yatay, tam ekran)
         tahtayı ıstakanın üstüne koymak tahtayı okunmaz hale getiriyordu.
         O durumda ıstaka ve kumanda tahtanın YANINA geçer, tahta yüksekliğin
         tamamını kullanır. */
      function olcuYaz() {
        if (!tahta || !kutu) return;
        var sarici = root.querySelector('.kl-wrap') || root;
        var alan = document.getElementById('boardArea');
        var ar = alan ? alan.getBoundingClientRect() : null;
        var g = Math.max(160, ar ? ar.width : 600);
        /* Kullanılabilir yükseklik: boardArea'nın üst kenarından ekranın
           altına kadar (alanın kendi yüksekliği daha küçükse o geçerli). */
        var y = gorunurY() - (ar ? Math.max(0, ar.top) : 0) - 8;
        if (ar && ar.height > 40) y = Math.min(y, ar.height - 4);
        y = Math.max(160, y);

        /* Yatay yerleşim eşiği: genişlik yüksekliğin 1.3 katından fazlaysa VE
           yükseklik 560 px'in altındaysa yan yana dizilim kazandırır. */
        var yatay = (g > y * 1.3) && (y < 560);
        if (sarici.classList.contains('kl-yatay') !== yatay) {
          sarici.classList.toggle('kl-yatay', yatay);
        }

        var kenar;
        if (yatay) {
          /* Tahta yüksekliğin tamamını alır; genişliğin en çok %64'ü ona,
             kalanı ıstaka + kumanda sütununa. */
          kenar = Math.min(y, g * 0.64);
        } else {
          var alti = olc('.kl-istaka-kutu') + olc('.kl-kumanda') + 18;
          kenar = Math.min(g, y - alti);
        }
        kenar = Math.max(150, Math.floor(kenar));
        kutu.style.width = kenar + 'px';
        var hc = ((kenar - 18) - 8 - (N - 1) * 2) / N;
        tahta.style.setProperty('--hc', Math.max(4, hc).toFixed(2) + 'px');
        /* Hücre 17 px'in altındaysa puan rakamı ve bonus etiketi okunmuyor. */
        tahta.classList.toggle('ufak', hc < 17);
        /* Teşhis/test: hangi yerleşimde, hangi ölçüyle çizildi. */
        window.__gvKelimelikOlcu = { yatay: yatay, kenar: kenar, hc: hc, g: g, y: y };
      }
      olcuYaz();
      requestAnimationFrame(olcuYaz);
      setTimeout(olcuYaz, 120);
      if (root.__klOlcu) {
        window.removeEventListener('resize', root.__klOlcu);
        window.removeEventListener('orientationchange', root.__klOlcu);
      }
      root.__klOlcu = function () { olcuYaz(); setTimeout(olcuYaz, 60); setTimeout(olcuYaz, 260); };
      window.addEventListener('resize', root.__klOlcu);
      window.addEventListener('orientationchange', root.__klOlcu);
      /* Telefon tarayıcısında adres çubuğu açılıp kapandıkça GERÇEK görünür
         alan değişir ama 'resize' her zaman tetiklenmez; tam ekrana girip
         çıkmak da öyle. visualViewport bunların hepsini bildirir. */
      if (window.visualViewport) {
        if (root.__klVV) {
          window.visualViewport.removeEventListener('resize', root.__klVV);
          window.visualViewport.removeEventListener('scroll', root.__klVV);
        }
        root.__klVV = root.__klOlcu;
        window.visualViewport.addEventListener('resize', root.__klVV);
        window.visualViewport.addEventListener('scroll', root.__klVV);
      }
      document.addEventListener('fullscreenchange', root.__klOlcu);

      if (m.isSpectator) return;

      // ------------------------------------------------- YEREL DOM İŞLEMLERİ
      function hucre(r, c) { return root.querySelector('.kl-hc[data-r="' + r + '"][data-c="' + c + '"]'); }
      function rtEl(i) { return root.querySelector('.kl-rt[data-i="' + i + '"]'); }
      function secimiYaz() {
        root.querySelectorAll('.kl-rt.sec').forEach(function (x) { x.classList.remove('sec'); });
        if (secili != null) { var e = rtEl(secili); if (e) e.classList.add('sec'); }
      }
      function kumandaTazele() {
        var b = root.querySelector('.kl-bildir');
        if (b) b.disabled = !sonRet.length;
      }
      function tasKoyDom(g) {
        var hc = hucre(g.r, g.c);
        if (hc) hc.innerHTML = tasHtml(g, s.puanlar, true);
        var rt = rtEl(g.idx);
        if (rt) rt.classList.add('kullanildi');
      }
      function tasKaldirDom(g) {
        var hc = hucre(g.r, g.c);
        if (hc) hc.innerHTML = bonusEtiketi((s.bonus && s.bonus[g.r] && s.bonus[g.r][g.c]) || '');
        var rt = rtEl(g.idx);
        if (rt) rt.classList.remove('kullanildi');
      }

      function koy(r, c, i) {
        if (!benim) { uyar('Sıra sizde değil.', 'info'); return; }
        if (kareOku(s, r, c)) return;
        var harf = s.rack[i];
        if (harf == null || istakaKullanildi(i)) return;
        if (harf === '*') { jokerSor(r, c, i); return; }
        var g = { r: r, c: c, harf: harf, joker: false, idx: i };
        gecici.push(g);
        tasKoyDom(g);
        secili = null; secimiYaz();
        ses('klTas');
      }
      function geriAlKare(r, c) {
        for (var i = 0; i < gecici.length; i++) if (gecici[i].r === r && gecici[i].c === c) {
          var g = gecici.splice(i, 1)[0];
          tasKaldirDom(g);
          ses('klGeri');
          return true;
        }
        return false;
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
            var g = { r: r, c: c, harf: this.dataset.h, joker: true, idx: i };
            gecici.push(g); tasKoyDom(g);
            secili = null; secimiYaz();
            ov.remove(); ses('klTas');
          });
        });
        ov.querySelector('.kl-jk-iptal').addEventListener('click', function () { ov.remove(); });
        ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
      }

      // --------------------------------------------------------- TIKLAMA
      root.querySelectorAll('.kl-rt').forEach(function (x) {
        x.addEventListener('click', function () {
          var i = Number(this.dataset.i);
          if (s.rack[i] == null) return;
          if (takasModu) {
            takasSecim[i] = !takasSecim[i];
            this.classList.toggle('takas', !!takasSecim[i]);
            return;
          }
          if (!benim) { uyar('Sıra sizde değil.', 'info'); return; }
          if (istakaKullanildi(i)) return;
          secili = (secili === i) ? null : i;
          secimiYaz();
        });
      });
      root.querySelectorAll('.kl-hc').forEach(function (x) {
        x.addEventListener('click', function () {
          /* Sürükleme gerçekten taşındıysa ardından gelen 'click' olayı
             taşı hemen geri alıyordu (taş yeni karesine kondu, tıklama onu
             ıstakaya geri gönderdi). O tıklamayı bir kez yutuyoruz. */
          if (tiklamaYut) { tiklamaYut = false; return; }
          var r = Number(this.dataset.r), c = Number(this.dataset.c);
          if (geriAlKare(r, c)) return;
          if (s.board[r][c] || taslakta(r, c)) return;
          if (!benim) { uyar('Sıra sizde değil.', 'info'); return; }
          if (secili == null) { uyar('Önce ıstakadan bir harf seç.', 'info'); return; }
          koy(r, c, secili);
        });
      });

      /* --------------------------------------------- SÜRÜKLE-BIRAK
         Tek kod hem fare hem dokunmatik için. Pointer capture kullanılır:
         parmak tahtanın üstüne kaysa bile olaylar kaynağa gelir, böylece
         bırakma ıskalanmaz. Hayalet taş her çıkışta (up/cancel/kesinti)
         kaldırılır; artık ekranda asılı kalmaz. */
      var srk = null;
      var tiklamaYut = false;        // sürüklemeden sonraki tek 'click'i yut
      function hayaletTemizle() {
        if (!srk) return;
        try { srk.el.remove(); } catch (_) {}
        try { srk.kaynak.classList.remove('surukleniyor'); } catch (_) {}
        try { if (srk.kaynak.releasePointerCapture) srk.kaynak.releasePointerCapture(srk.pid); } catch (_) {}
        root.querySelectorAll('.kl-hc.hedef, .kl-istaka.hedef').forEach(function (h) {
          h.classList.remove('hedef');
        });
        srk = null;
      }

      /* ORTAK SÜRÜKLEME BAŞLATICI.
         Kullanıcı isteği: "harfi sürükleyerek yerleştirdikten sonra tekrar
         sürükleyemiyorum, harfe dokunarak geri almam gerekiyor. Sürükle-bırak
         hep düzgün çalışmalı hamle sırası sendeyse."
         Bu yüzden sürükleme artık İKİ kaynaktan başlar:
           kaynak 'istaka' → ıstakadaki harf (eski davranış)
           kaynak 'tahta'  → tahtaya bu turda konmuş TASLAK taş; başka bir
                             kareye taşınabilir ya da ıstakaya geri bırakılabilir.
         Sunucuya gönderilmiş (onaylanmış) taşlar sürüklenmez. */
      function suruklemeBasla(e, el, bilgi) {
        e.preventDefault();
        tiklamaYut = false;                   // yeni etkileşim: bayat bayrak kalmasın
        hayaletTemizle();
        var k = el.getBoundingClientRect();
        var kl = el.cloneNode(true);
        kl.className = 'kl-rt kl-hayalet';
        kl.style.width = k.width + 'px'; kl.style.height = k.height + 'px';
        (window.__gvKaplamaKati ? window.__gvKaplamaKati() : document.body).appendChild(kl);
        srk = { tur: bilgi.tur, i: bilgi.i, g: bilgi.g || null,
                el: kl, kaynak: el, tasindi: false, pid: e.pointerId };
        el.classList.add('surukleniyor');
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        tasi(e.clientX, e.clientY);
      }
      function sureklemeHareket(e) {
        if (!srk || srk.pid !== e.pointerId) return;
        srk.tasindi = true;
        e.preventDefault();
        tasi(e.clientX, e.clientY);
      }
      function sureklemeBirak(e) {
        if (!srk || srk.pid !== e.pointerId) return;
        birak(e.clientX, e.clientY);
      }
      function suruklemeBagla(el, bilgiVer) {
        el.addEventListener('pointerdown', function (e) {
          if (takasModu || !benim) return;
          var bilgi = bilgiVer.call(this);
          if (!bilgi) return;
          suruklemeBasla(e, this, bilgi);
        });
        el.addEventListener('pointermove', sureklemeHareket);
        el.addEventListener('pointerup', sureklemeBirak);
        el.addEventListener('pointercancel', function () { hayaletTemizle(); });
      }

      // ISTAKADAKİ HARF → tahtaya
      root.querySelectorAll('.kl-rt').forEach(function (t) {
        suruklemeBagla(t, function () {
          var i = Number(this.dataset.i);
          if (s.rack[i] == null || istakaKullanildi(i)) return null;
          return { tur: 'istaka', i: i };
        });
      });
      // TAHTADAKİ TASLAK TAŞ → başka kareye ya da ıstakaya geri
      root.querySelectorAll('.kl-hc').forEach(function (hc) {
        suruklemeBagla(hc, function () {
          var r = Number(this.dataset.r), c = Number(this.dataset.c);
          var g = taslakBul(r, c);
          if (!g) return null;                 // boş kare ya da onaylanmış taş
          return { tur: 'tahta', i: g.idx, g: g };
        });
      });
      function tasi(x, y) {
        if (!srk) return;
        srk.el.style.left = x + 'px'; srk.el.style.top = y + 'px';
        root.querySelectorAll('.kl-hc.hedef, .kl-istaka.hedef').forEach(function (h) {
          h.classList.remove('hedef');
        });
        var hedef = altindakiHucre(x, y);
        if (hedef) { hedef.classList.add('hedef'); return; }
        // Tahtadan sürüklenen taş ıstakanın üstünde de bırakılabilir (geri al).
        if (srk.tur === 'tahta' && istakaUstunde(x, y)) {
          var ist = root.querySelector('.kl-istaka');
          if (ist) ist.classList.add('hedef');
        }
      }
      /* İmlecin ıstakanın üstünde olup olmadığı: tahtadan sürüklenen taşı
         ıstakaya geri bırakmak için. */
      function istakaUstunde(x, y) {
        var ist = root.querySelector('.kl-istaka');
        if (!ist) return false;
        var k = ist.getBoundingClientRect();
        return x >= k.left && x <= k.right && y >= k.top && y <= k.bottom;
      }
      /* Hayalet taş imlecin ALTINDA durduğu için elementFromPoint onu
         döndürür; bu yüzden hayaleti bir an gizleyip altındaki hücreye
         bakıyoruz. Eskiden hayalet pointer-events:none olmasına rağmen
         bazı tarayıcılarda kapsayıcı yakalıyor, bırakma ıskalanıyordu. */
      function altindakiHucre(x, y) {
        if (!srk) return null;
        var eskiG = srk.el.style.display;
        srk.el.style.display = 'none';
        var alt = document.elementFromPoint(x, y);
        srk.el.style.display = eskiG;
        var hc = alt && alt.closest ? alt.closest('.kl-hc') : null;
        if (!hc || !root.contains(hc)) return null;
        var r = Number(hc.dataset.r), c = Number(hc.dataset.c);
        // Taşın KENDİ karesi geçerli hedeftir (yerinde bırakmak hamleyi bozmaz).
        if (srk && srk.tur === 'tahta' && srk.g && srk.g.r === r && srk.g.c === c) return hc;
        return kareOku(s, r, c) ? null : hc;
      }
      function birak(x, y) {
        if (!srk) return;
        var tasindi = srk.tasindi, tur = srk.tur, i = srk.i, g = srk.g;
        var hedef = tasindi ? altindakiHucre(x, y) : null;
        var istakayaBirak = tasindi && tur === 'tahta' && !hedef && istakaUstunde(x, y);
        hayaletTemizle();
        if (!tasindi) return;                 // parmak kıpırdamadı: tıklama işlesin
        /* Taşıma oldu: hemen ardından gelen 'click' yutulur. Bayrak ASILI
           KALMAMALI — tarayıcı o click'i pointerup ile aynı turda yollar,
           bu yüzden bir sonraki tura kalan bayrak temizlenir; yoksa sürükleme
           sonrası ilk normal tıklama da yutuluyordu. */
        tiklamaYut = true;
        setTimeout(function () { tiklamaYut = false; }, 0);
        if (tur === 'istaka') {
          if (hedef && i != null) koy(Number(hedef.dataset.r), Number(hedef.dataset.c), i);
          return;
        }
        // --- tahtadaki taslak taş ---
        if (istakayaBirak) { geriAlKare(g.r, g.c); return; }
        if (!hedef) return;                   // tahta dışına bırakıldı: yerinde kalsın
        var yr = Number(hedef.dataset.r), yc = Number(hedef.dataset.c);
        if (yr === g.r && yc === g.c) return; // aynı kare: değişiklik yok
        tasiTaslak(g, yr, yc);
      }
      /* TASLAK TAŞI BAŞKA KAREYE TAŞI — ıstakadan yeniden seçmeye gerek yok. */
      function tasiTaslak(g, yr, yc) {
        if (kareOku(s, yr, yc)) return;       // hedef dolu
        tasKaldirDom(g);
        g.r = yr; g.c = yc;
        tasKoyDom(g);
        ses('klTas');
      }
      /* Parmak/fare pencerenin dışında bırakılırsa da temizle. */
      if (root.__klIptal) window.removeEventListener('pointercancel', root.__klIptal);
      root.__klIptal = hayaletTemizle;
      window.addEventListener('pointercancel', root.__klIptal);

      // --------------------------------------------------------- KUMANDA
      function dgm(sec, fn) { var e = root.querySelector(sec); if (e) e.addEventListener('click', fn); }
      dgm('.kl-onay', function () {
        if (!benim) return;
        if (!gecici.length) { uyar('Tahtaya hiç harf koymadın.', 'warning'); return; }
        bekleyen = gecici.slice();          // yanıt gelene kadar tahtada kalsın
        gecici = [];
        sonRet = []; kumandaTazele();
        m.emit('kelimelikMove', { konumlar: bekleyen.map(function (g) {
          return { r: g.r, c: g.c, harf: g.harf, joker: !!g.joker }; }) });
      });
      dgm('.kl-geri', function () {
        if (!gecici.length) return;
        var g = gecici.pop();
        tasKaldirDom(g); ses('klGeri');
      });
      dgm('.kl-temiz', function () {
        if (!gecici.length) return;
        while (gecici.length) tasKaldirDom(gecici.pop());
        secili = null; secimiYaz(); ses('klGeri');
      });
      dgm('.kl-karistir', function () { m.emit('kelimelikShuffle', {}); });
      dgm('.kl-pas', function () {
        if (!benim) return;
        while (gecici.length) tasKaldirDom(gecici.pop());
        secili = null;
        m.emit('kelimelikPass', {});
      });
      dgm('.kl-takas', function () {
        if (!benim) return;
        if (!takasModu) {
          if (!(s.bag > 0)) { uyar('Torbada taş kalmadı, değişim yapılamaz.', 'warning'); return; }
          while (gecici.length) tasKaldirDom(gecici.pop());
          secili = null; secimiYaz();
          takasModu = true; takasSecim = {};
          uyar('Değiştirmek istediğin harfleri seç, sonra onayla.', 'info');
          this.innerHTML = '✔️ <span class="uz">Değişimi </span>Onayla';
          return;
        }
        var sec = Object.keys(takasSecim).filter(function (k) { return takasSecim[k]; }).map(Number);
        if (!sec.length) { uyar('Hiç harf seçmedin.', 'warning'); return; }
        m.emit('kelimelikSwap', { indeksler: sec });
        takasModu = false; takasSecim = {};
        this.innerHTML = '🔁 <span class="uz">Harf </span>Değiştir';
      });
      dgm('.kl-bildir', function () { kelimeBildir(m); });
    }
  });

  /* Sunucu durumu değiştiğinde bekleyen hamle yerine oturmuş demektir. */
  window.addEventListener('gv:kelimelikDurum', function () { bekleyen = []; });

  /* ÖLÇÜLEN HATA: yukarıdaki 'gv:kelimelikDurum' olayını HİÇBİR YER yaymıyordu,
     bu yüzden ONAYLANAN hamlenin taşları 'bekleyen' listesinde asılı kalıyordu.
     Sonuçları: ıstakanın o gözleri kalıcı olarak "kullanıldı" görünüyor, oraya
     gelen YENİ harfler ne tıklanabiliyor ne sürüklenebiliyor ve tahtada hayalet
     taş kalıyordu (kullanıcı raporu: "harfi yerleştirdikten sonra tekrar
     sürükleyemiyorum"). Artık her çizimde sunucu tahtasına bakılır: taş yerine
     oturduysa bekleyenden düşer. Ret durumunda zaten kelimelikRejected taşları
     taslağa geri alıyor. */
  function bekleyeniTazele(s) {
    if (!bekleyen.length || !s || !s.board) return;
    var kalan = [];
    for (var i = 0; i < bekleyen.length; i++) {
      var g = bekleyen[i];
      if (!(s.board[g.r] && s.board[g.r][g.c])) kalan.push(g);
    }
    bekleyen = kalan;
  }

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
      if (!sec.length) { uyar('Hiç kelime seçmedin.', 'warning'); return; }
      m.emit('kelimelikReport', { kelimeler: sec, not: (ov.querySelector('.kl-bdr-not').value || '').trim() });
      sonRet = [];
      ov.remove();
      try { GVArena.repaint(); } catch (_) {}
    });
  }

  /* Test/teşhis köprüsü */
  window.__gvKelimelik = {
    taslak: function () { return gecici.slice(); },
    bekleyen: function () { return bekleyen.slice(); },
    secili: function () { return secili; },
    ret: function () { return sonRet.slice(); },
    sifirla: sifirla
  };
})();
