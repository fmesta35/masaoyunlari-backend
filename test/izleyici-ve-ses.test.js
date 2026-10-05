'use strict';
/* ============================================================================
 * 1) İZLEYİCİ/MİSAFİR PUAN UYARILARI  —  2) SES ANAHTARI VE HAMLE SÜRESİ SESİ
 * ============================================================================
 * Kullanıcı isteği (madde 1): "İzleyici neden puan kaybetsin? İzleyicide
 * değil, sadece oyuncularda (oyuncular içerisinde sadece giriş yapanlarda)
 * puan durumu olur. Bu sebeple üye girişi yapan oyuncularda o puanla ilgili
 * ceza vs. pop-up durumları gözükecek."
 *
 * Kullanıcı isteği (madde 2): "Oyunlarda ses açma ve kapatma hepsinde geçerli
 * olsun. Tekrar test et. Sadece hamle süresi ses kapalı da olsa ses vermeye
 * devam etsin."
 *
 * NE ÖLÇÜLÜYOR
 *   1) index.html'de terk/pes uyarıları ortak süzgeçten (puanliOyuncuMu)
 *      geçiyor; hasActiveMatch izleyicide hiç "aktif maç" demiyor.
 *   2) leave-guard penceresi izleyiciye HİÇ açılmıyor; misafir oyuncuda
 *      "ceza puanı" cümlesi yok, üyede var.
 *   3) GVDeniz: ses kapalıyken cal() susuyor, calZorla() ÇALIYOR.
 *   4) move-clock: son 10 saniyede yalnız KENDİ sıramda uyarı tonunu
 *      calZorla ile çalıyor (yani ses kapalı olsa da duyulur).
 *   5) Bütün oyun istemcileri sesi tek yoldan (GVDeniz.ses.cal) çalıyor —
 *      yani oda başlığındaki anahtar hepsinde geçerli; satranç, tavla ve
 *      ortak yaşam döngüsündeki yedi oyun da artık sessiz değil.
 * ========================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const KOK = path.join(__dirname, '..');
const oku = f => fs.readFileSync(path.join(KOK, f), 'utf8');
const uyu = ms => new Promise(r => setTimeout(r, ms));

function dom(govde) {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  return new JSDOM('<!doctype html><html><body>' + govde + '</body></html>',
    { runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true,
      url: 'http://localhost/' });   // localStorage için gerçek bir köken şart
}

/* --------------------------------------------------------------------------
   1) KAYNAK SÖZLEŞMESİ: puan uyarıları tek süzgeçten geçiyor mu?
   -------------------------------------------------------------------------- */
function bolum1() {
  const s = oku('index.html');

  assert.ok(/function izleyiciMi\(\)/.test(s), 'izleyiciMi() olmalı');
  assert.ok(/function puanliOyuncuMu\(\)\s*\{\s*return !izleyiciMi\(\) && !st\.isGuest; \}/.test(s),
    'puanliOyuncuMu: izleyici ve misafir dışlanmalı');

  // hasActiveMatch izleyicide erken dönmeli (terk akışı hiç çalışmasın)
  const ham = s.match(/function hasActiveMatch\(\)\{[\s\S]*?\n/)[0];
  assert.ok(/if\(izleyiciMi\(\)\)return false;/.test(ham),
    'hasActiveMatch izleyicide false dönmeli');

  // Ceza bildirimi ve uyarı metni ortak yerden üretiliyor; eski sabit
  // metinler (her oyuncuya "Puan kaybedeceksin" diyen) kalmamalı.
  assert.ok(/function terkUyariMetni\(botDevralir\)/.test(s), 'terkUyariMetni olmalı');
  assert.ok(/function terkCezasiBildir\(\)/.test(s), 'terkCezasiBildir olmalı');
  const kacak = s.split('\n').filter(l =>
    /Puan kaybedeceksin\.|Terk cezası puanı düşecek/.test(l) &&
    !/terkUyariMetni|const puan =/.test(l));
  assert.deepStrictEqual(kacak, [],
    'puan cümlesi yalnız terkUyariMetni içinde kalmalı:\n' + kacak.join('\n'));
  const toastKacak = s.split('\n').filter(l => /toast\('❌ Terk cezası uygulandı!/.test(l) &&
    !/puanliOyuncuMu\(\)/.test(l));
  assert.deepStrictEqual(toastKacak, [],
    'ceza bildirimi doğrudan değil terkCezasiBildir ile verilmeli');

  // Terk cezası uygulanan her yerde bildirim de süzgeçten geçmeli
  assert.ok(/awardPoints\(st\.curGame, 'forfeit'\);\s*\n\s*terkCezasiBildir\(\);/.test(s) &&
            /awardPoints\(st\.curGame,'forfeit'\);\s*\n\s*terkCezasiBildir\(\);/.test(s),
    'guardNavigation ve leaveRoom terkCezasiBildir kullanmalı');

  // Dışa açık köprüler (leave-guard aynı ölçüyü kullanıyor)
  assert.ok(/window\.__gvIzleyiciMi = izleyiciMi;/.test(s), 'izleyici ölçüsü dışa verilmeli');
  assert.ok(/window\.__gvPuanliOyuncu = puanliOyuncuMu;/.test(s), 'puan ölçüsü dışa verilmeli');
  console.log('  ✓ 1) terk/ceza uyarıları tek süzgeçten geçiyor, izleyici akışın dışında');
}

/* --------------------------------------------------------------------------
   2) LEAVE-GUARD: izleyiciye pencere yok, misafirde ceza cümlesi yok
   -------------------------------------------------------------------------- */
async function bolum2() {
  const d = dom('<div id="pg-room" class="active"></div>');
  const win = d.window;
  win.GV = { page: () => { win.__gidildi = (win.__gidildi || 0) + 1; },
             openLobby: () => { win.__gidildi = (win.__gidildi || 0) + 1; } };
  win.st = { curPage: 'room', isGuest: false };
  win.GVArena = { state: () => ({ status: 'playing' }) };     // canlı tahta
  win.eval(oku('js/leave-guard.js'));
  await uyu(30);

  // --- İZLEYİCİ: pencere HİÇ açılmamalı, gezinme serbest olmalı
  win.__gvIzleyiciMi = () => true;
  win.__gvPuanliOyuncu = () => false;
  win.GV.openLobby('okey');
  await uyu(20);
  assert.strictEqual(win.document.querySelector('.gvlg-overlay'), null,
    'izleyiciye terk onayı açılmamalı');
  assert.ok(win.__gidildi >= 1, 'izleyici lobiye doğrudan gidebilmeli');

  // --- MİSAFİR OYUNCU: pencere açılır ama "ceza puanı" cümlesi OLMAZ
  win.__gvIzleyiciMi = () => false;
  win.__gvPuanliOyuncu = () => false;
  win.GV.openLobby('okey');
  await uyu(20);
  let ov = win.document.querySelector('.gvlg-overlay');
  assert.ok(ov, 'oyuncuya terk onayı açılmalı');
  let metin = ov.textContent;
  assert.ok(/hükmen mağlup/.test(metin), 'mağlubiyet uyarısı misafirde de kalmalı');
  assert.ok(!/ceza puanı/.test(metin), 'misafirde ceza puanı cümlesi olmamalı');
  win.__gvLeaveGuard.closeModal();

  // --- ÜYE OYUNCU: ceza puanı cümlesi görünür
  win.__gvPuanliOyuncu = () => true;
  win.GV.openLobby('okey');
  await uyu(20);
  ov = win.document.querySelector('.gvlg-overlay');
  assert.ok(ov, 'üyeye de pencere açılmalı');
  assert.ok(/ceza puanı/.test(ov.textContent), 'üyede ceza puanı cümlesi olmalı');
  console.log('  ✓ 2) pencere: izleyiciye hiç, misafirde cezasız, üyede cezalı');
  d.window.close();
}

/* --------------------------------------------------------------------------
   3) SES MOTORU: anahtar her sesi kapatır, hamle süresi tonu hariç
   -------------------------------------------------------------------------- */
function sahteAudio(win, kayit) {
  function dugum(ad) {
    return {
      gain: { value: 0, setValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(v){ this.value = v; } },
      frequency: { value: 0, setValueAtTime(){}, exponentialRampToValueAtTime(){} },
      Q: { value: 0 }, type: '', buffer: null,
      connect(h) { this.__hedef = h; if (ad === 'kaynak' || ad === 'osc') kayit.baglantilar.push(h); },
      start(){}, stop(){}, __ad: ad
    };
  }
  win.AudioContext = function () {
    const ctx = {
      currentTime: 0, state: 'running', sampleRate: 44100,
      destination: { __ad: 'cikis' },
      resume(){}, createGain(){ const g = dugum('gain'); kayit.gainler.push(g); return g; },
      createOscillator(){ const o = dugum('osc'); return o; },
      createBiquadFilter(){ return dugum('filtre'); },
      createBufferSource(){ return dugum('kaynak'); },
      createBuffer(){ return { getChannelData: () => new Float32Array(16) }; }
    };
    return ctx;
  };
}

function bolum3() {
  const d = dom('<button id="gvSoundBtn">🔊 Ses</button>');
  const win = d.window;
  const kayit = { gainler: [], baglantilar: [] };
  sahteAudio(win, kayit);
  // Ses KAPALI başla
  win.localStorage.setItem('gv-ses', 'off');
  win.eval(oku('js/deniz-sinematik.js'));

  const ses = win.GVDeniz.ses;
  assert.strictEqual(ses.acik(), false, 'kapalı tercih okunmalı');
  assert.ok(typeof ses.calZorla === 'function', 'calZorla olmalı');

  // Normal ses: kapalıyken HİÇ çalmaz
  assert.strictEqual(ses.cal('tas'), false, 'ses kapalıyken normal ses çalmamalı');
  assert.strictEqual(kayit.baglantilar.length, 0, 'kapalıyken osilatör kurulmamalı');

  // Hamle süresi tonu: kapalıyken de ÇALAR
  assert.strictEqual(ses.calZorla('sure'), true, 'hamle süresi tonu kapalıyken de çalmalı');
  assert.ok(kayit.baglantilar.length > 0, 'zorunlu ses gerçekten kurulmalı');

  /* Ve KISILMAYAN çıkıştan çalmalı: iki gain düğümü var (ana + zorunlu);
     ana düğümün kazancı 0 olmalı, zorunlu tonun bağlandığı düğüm 0 OLMAMALI. */
  const anaGain = kayit.gainler[0];
  assert.strictEqual(anaGain.gain.value, 0, 'ses kapalıyken ana çıkış kısık olmalı');
  const zorunluGain = kayit.gainler[1];
  assert.ok(zorunluGain && zorunluGain.gain.value > 0, 'zorunlu çıkış kısılmamalı');
  // ton()/gurultu() kendi zarf gain'ini ÇIKIŞA bağlar; o çıkış zorunlu olmalı
  assert.ok(kayit.gainler.some(g => g.__hedef === zorunluGain),
    'zorunlu ses zorunlu çıkışa bağlanmalı');
  assert.ok(!kayit.gainler.some(g => g.__hedef === anaGain),
    'ses kapalıyken kısık ana çıkışa bağlanmamalı');

  // Anahtar açılınca normal sesler de çalar ve ana çıkış açılır
  ses.ayarla(true);
  assert.strictEqual(ses.cal('tas'), true, 'ses açıkken normal ses çalmalı');
  assert.ok(anaGain.gain.value > 0, 'ses açılınca ana çıkış açılmalı');
  assert.ok(kayit.gainler.some(g => g.__hedef === anaGain),
    'normal ses ana çıkışa bağlanmalı');
  console.log('  ✓ 3) ses anahtarı her sesi kapatıyor; hamle süresi tonu kapalıyken de çalıyor');
  d.window.close();
}

/* --------------------------------------------------------------------------
   4) MOVE-CLOCK: uyarı tonu yalnız kendi sıramda, calZorla ile
   -------------------------------------------------------------------------- */
async function bolum4() {
  const d = dom('<div id="topTimers"><div class="timer"></div><div class="timer"></div></div>');
  const win = d.window;
  const calinan = [], calinanZorla = [];
  win.GVDeniz = { ses: {
    acik: () => false,                               // SES KAPALI
    cal: ad => { calinan.push(ad); return false; },
    calZorla: ad => { calinanZorla.push(ad); return true; }
  } };
  win.eval(oku('js/move-clock.js'));

  // Kendi sıram, 8 saniye kaldı → tonu duymalıyım (ses kapalı olsa da)
  win.GVMoveClock.set({ activeIndex: 0, remainingMs: 8000, limitMs: 60000, benim: true });
  await uyu(60);
  assert.ok(calinanZorla.includes('sure'), 'kendi sıramda son 10 sn tonu çalmalı');
  assert.deepStrictEqual(calinan, [], 'uyarı tonu anahtarı dinleyen yoldan GEÇMEMELİ');
  const ilkSayi = calinanZorla.length;

  // Aynı saniye tekrar boyanınca iki kez çalmamalı
  await uyu(300);
  assert.strictEqual(calinanZorla.length, ilkSayi, 'aynı saniyede tek kez çalmalı');

  // Rakibin sırası → ses yok
  calinanZorla.length = 0;
  win.GVMoveClock.set({ activeIndex: 1, remainingMs: 7000, limitMs: 60000, benim: false });
  await uyu(60);
  assert.deepStrictEqual(calinanZorla, [], 'rakibin süresi için ton çalmamalı');

  // Süre bol → ses yok
  win.GVMoveClock.set({ activeIndex: 0, remainingMs: 45000, limitMs: 60000, benim: true });
  await uyu(60);
  assert.deepStrictEqual(calinanZorla, [], 'süre bolken ton çalmamalı');
  win.GVMoveClock.clear();
  console.log('  ✓ 4) hamle süresi tonu: yalnız kendi sıramda, son 10 sn, anahtardan bağımsız');
  d.window.close();
}

/* --------------------------------------------------------------------------
   5) BÜTÜN OYUNLAR: ses tek yoldan geçiyor ve artık sessiz oyun yok
   -------------------------------------------------------------------------- */
function bolum5() {
  // Hiçbir istemci kendi başına ses üretmemeli (anahtarı atlatırdı).
  const dosyalar = fs.readdirSync(path.join(KOK, 'js')).filter(f => f.endsWith('.js'));
  for (const f of dosyalar) {
    if (f === 'deniz-sinematik.js') continue;
    const s = oku('js/' + f);
    assert.ok(!/new Audio\(|new\s+(window\.)?AudioContext|createOscillator\(/.test(s),
      f + ': ses yalnız GVDeniz üzerinden üretilmeli (anahtar geçerli olsun)');
  }

  // Eskiden sessiz olan oyunlar artık ses çalıyor.
  for (const [dosya, not] of [
    ['js/chess-online.js', 'satranç'],
    ['js/tavla-online.js', 'tavla'],
    ['js/online-arena.js', 'ortak yedi oyun (dama, reversi, gomoku, 4 sıra, pişti, batak…)']
  ]) {
    const s = oku(dosya);
    assert.ok(/function sesleriIsle\(/.test(s), not + ': hamle/sıra sesi eklenmeli');
    assert.ok(/GVDeniz\.ses\.cal\(/.test(s), not + ': ses anahtara uyan yoldan çalmalı');
    assert.ok(/benim:/.test(s), not + ': hamle süresi tonu için "benim" bayrağı geçilmeli');
  }

  // Okey'in hamle süresi tonu zorunlu yola taşındı; diğer okey sesleri değil.
  const ok = oku('js/okey-online.js');
  assert.ok(/sesCalZorla\('sure'\)/.test(ok), 'okey hamle süresi tonu zorunlu yoldan çalmalı');
  assert.ok(/sesCal\('tas'\)/.test(ok) && /sesCal\('zil'\)/.test(ok),
    'okey taş ve zil sesleri anahtara uymaya devam etmeli');
  assert.ok(!/sesCalZorla\('tas'\)|sesCalZorla\('zil'\)/.test(ok),
    'yalnız hamle süresi tonu anahtarı atlamalı');
  console.log('  ✓ 5) ses tek yoldan geçiyor; satranç, tavla ve ortak oyunlar artık sessiz değil');
}

(async () => {
  try {
    bolum1();
    await bolum2();
    bolum3();
    await bolum4();
    bolum5();
    console.log('OK izleyici puan uyarıları + ses anahtarı ve hamle süresi sesi');
  } catch (e) {
    console.error('İZLEYİCİ/SES HATASI:', e);
    process.exit(1);
  }
})();
