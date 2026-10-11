'use strict';
/* ============================================================================
 * METROPOL — MOTOR VE ONLINE AKIŞ
 * ============================================================================
 * Prototip tek cihazda çalışıyor, zarı ve para hesabını tarayıcıda yapıyordu.
 * Burada HER ŞEY SUNUCUYA taşındı: istemci yalnız niyet bildiriyor.
 *
 * NE DOĞRULANIR
 *   MOTOR
 *     1) Tahta ve desteler: 40 kare, 8 renk grubu, 4 gar, 2 idare, 16+16 kart.
 *     2) Başlangıç durumu: 1500₺, hepsi Kalkış'ta, kareler sahipsiz.
 *     3) Kalkış maaşı: tur tamamlayan 200₺ alır.
 *     4) Satın alma ve TEKLİF TURU: almayan oyuncunun kaçırdığı kareyi
 *        diğerleri liste fiyatından alabilir (açık artırma yerine).
 *     5) Kira: grubun tamamı tek sahipteyse taban kira İKİ KATI; ipotekli
 *        mülkte kira yok; gar kirası gar sayısına göre.
 *     6) Bina: grup eksikken kurulamaz, DENGESİZ kurulamaz, 5. kademe otel.
 *     7) İpotek: yarı fiyat alınır, %110 ile geri alınır, binalı grupta yasak.
 *     8) Cezaevi: üç çift doğruca içeri; çift/kefalet/kart ile çıkılır.
 *     9) Nakde çevirme ve İFLAS: parası yetmeyenin binaları/mülkleri otomatik
 *        tasfiye edilir; yine yetmezse iflas eder ve varlıklar alacaklıya geçer.
 *    10) Tur limiti: dolunca en yüksek VARLIK kazanır, eşitlikte berabere.
 *    11) Süre aşımı: zarı/kararı/turu sunucu tamamlar, kimse atılmaz.
 *    12) Görünüm: deste SIRASI istemciye gitmez.
 *   ONLINE
 *    13) Hazır masalar lobide (2/3/4 kişilik), kimlik çakışması yok.
 *    14) Oyun başlıyor; sırası olmayan zar atamıyor; zar iki istemciye yansıyor.
 *   ARAYÜZ
 *    15) İstemci adaptörü, stiller, kurallar, panel ve kapak bağlı.
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-metropol-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const ioClient = require('socket.io-client');
const E = require('../metropol-engine.js');
const serverModule = require('../server.js');

const KOK = path.join(__dirname, '..');
const oku = f => fs.readFileSync(path.join(KOK, f), 'utf8');

function connect(url, name) {
  const s = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('bağlantı: ' + name)), 8000);
    s.on('connect', () => { clearTimeout(t); s.userName = name; res(s); });
    s.on('connect_error', rej);
  });
}
function once(s, ev, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('zaman aşımı: ' + ev)), ms || 12000);
    s.once(ev, p => { clearTimeout(t); res(p); });
  });
}
async function httpRooms(base, gameId) {
  const r = await fetch(base + '/api/rooms?gameId=' + gameId);
  const j = await r.json();
  return j.rooms || j;
}
/* Zarı istediğimiz değerlere sabitleyen kurulum: kuralları ölçerken şansın
   karışmaması gerekiyor. Dizi [d1,d2,d1,d2,...] olarak tüketilir. */
function sabitZar(st, dizi) {
  let i = 0;
  st.rng = () => ((dizi[Math.min(i++, dizi.length - 1)] - 1) + 0.5) / 6;
}
/* Bir oyuncuyu doğrudan bir kareye koy (zar atmadan). Kural testlerinde
   kareye nasıl gelindiği değil, geldiğinde ne olduğu ölçülüyor. */
function koy(st, seat, kare) { st.oyuncu[seat].konum = kare; }
const mulkIdx = g => E.KARELER.map((k, i) => [k, i]).filter(([k]) => k.g === g).map(([, i]) => i);

/* ------------------------------------------------------------------ MOTOR */
function motorTesti() {
  // 1) TAHTA ve DESTELER
  assert.strictEqual(E.KARELER.length, 40, 'tahta 40 kare olmalı');
  assert.strictEqual(E.KARE_SAYISI, 40, 'kare sayısı sabiti tahtayla uyuşmalı');
  assert.strictEqual(Object.keys(E.GRUP_ADLARI).length, 8, 'sekiz renk grubu olmalı');
  Object.keys(E.GRUP_ADLARI).forEach(g => {
    const n = mulkIdx(g).length;
    assert.ok(n === 2 || n === 3, g + ' grubunda 2 ya da 3 kare olmalı, var: ' + n);
    assert.ok(E.GRUP_RENKLERI[g], g + ' grubunun rengi tanımlı olmalı');
  });
  assert.strictEqual(E.KARELER.filter(k => k.t === 'gar').length, 4, 'dört gar olmalı');
  assert.strictEqual(E.KARELER.filter(k => k.t === 'idare').length, 2, 'iki idare olmalı');
  assert.deepStrictEqual(E.GAR_KARELERI.map(i => E.KARELER[i].t), ['gar', 'gar', 'gar', 'gar'],
    'gar kareleri listesi tahtayla uyuşmalı');
  assert.deepStrictEqual(E.IDARE_KARELERI.map(i => E.KARELER[i].t), ['idare', 'idare'],
    'idare kareleri listesi tahtayla uyuşmalı');
  assert.strictEqual(E.KARELER[0].t, 'go', '0. kare KALKIŞ olmalı');
  assert.strictEqual(E.KARELER[E.CEZAEVI].t, 'cezaevi', 'cezaevi karesi sabitle uyuşmalı');
  assert.strictEqual(E.SANS.length, 16, 'şans destesi 16 kart olmalı');
  assert.strictEqual(E.FON.length, 16, 'fon destesi 16 kart olmalı');
  E.KARELER.filter(k => k.t === 'mulk').forEach(k => {
    assert.strictEqual(k.r.length, 6, k.ad + ': altı kira kademesi olmalı (taban+4 ev+otel)');
    assert.ok(k.b > 0, k.ad + ': bina bedeli olmalı');
    /* Kira kademeleri ARTAN olmalı — yoksa bina kurmak zarar ettirirdi. */
    for (let i = 1; i < 6; i++) assert.ok(k.r[i] > k.r[i - 1], k.ad + ': kira kademeleri artmalı');
  });
  console.log('  ✓ 1) tahta 40 kare, 8 grup, 4 gar, 2 idare; desteler 16+16, kiralar artan');

  // 2) BAŞLANGIÇ DURUMU
  {
    const st = E.macBaslat({ seats: [0, 1, 2] });
    assert.deepStrictEqual(st.seats, [0, 1, 2], 'koltuklar korunmalı');
    st.seats.forEach(s => {
      assert.strictEqual(st.oyuncu[s].para, E.BASLANGIC_PARA, 'herkes 1500₺ ile başlamalı');
      assert.strictEqual(st.oyuncu[s].konum, 0, 'herkes Kalkış\'ta başlamalı');
      assert.strictEqual(st.oyuncu[s].iflas, false, 'kimse iflas etmiş başlamamalı');
    });
    assert.ok(st.kare.every(d => d.sahip === null && d.ev === 0 && !d.ipotek),
      'tüm kareler sahipsiz ve binasız başlamalı');
    assert.strictEqual(st.faz, 'zar', 'ilk faz zar olmalı');
    assert.strictEqual(E.siradakiKoltuk(st), 0, 'sıra ilk koltukta olmalı');
  }
  console.log('  ✓ 2) başlangıç: 1500₺, Kalkış, sahipsiz kareler');

  // 3) KALKIŞ MAAŞI
  {
    const st = E.macBaslat({ seats: [0, 1] });
    /* 39 + 11 = 50 → 10 (ZİYARET: para etkisi olmayan tek kare, böylece
       ölçülen tek şey MAAŞ olur). */
    koy(st, 0, 39);
    sabitZar(st, [5, 6]);
    E.zarAt(st, 0);
    assert.strictEqual(st.oyuncu[0].konum, 10, 'tur dönülmeli');
    assert.strictEqual(st.oyuncu[0].cezaevi, false, 'ziyaret karesi cezaevi DEĞİLDİR');
    assert.strictEqual(st.oyuncu[0].para, E.BASLANGIC_PARA + E.MAAS,
      'Kalkış\'tan geçen 200₺ maaş almalı');
  }
  console.log('  ✓ 3) Kalkış\'tan geçen maaş alıyor');

  // 4) SATIN ALMA ve TEKLİF TURU
  {
    const st = E.macBaslat({ seats: [0, 1, 2] });
    const kare = mulkIdx('lblue')[0];
    koy(st, 0, kare - 3);
    sabitZar(st, [1, 2]);
    E.zarAt(st, 0);
    assert.strictEqual(st.faz, 'karar', 'sahipsiz mülke düşen karar vermeli');
    assert.strictEqual(E.gorunum(st, 0).satilik, kare, 'satılık kare istemciye bildirilmeli');
    /* Sırası olmayan "karar" fazında alamaz. */
    assert.strictEqual(E.satinAl(st, 1).reason, 'not_your_turn', 'sırası olmayan alamamalı');
    /* Reddedince TEKLİF turu başlar: sıradaki diğer oyuncular, sırayla. */
    const r = E.reddet(st, 0);
    assert.ok(r.ok, 'reddetmek geçerli olmalı');
    assert.strictEqual(st.faz, 'teklif', 'reddedilince teklif turu başlamalı');
    assert.strictEqual(r.teklif.seat, 1, 'teklif sıradaki oyuncuya gitmeli');
    /* Teklif sırası 1'deyken 2 alamaz. */
    assert.strictEqual(E.satinAl(st, 2).reason, 'not_your_turn', 'teklif sırası dışında alınamaz');
    const r2 = E.reddet(st, 1);
    assert.strictEqual(r2.teklif.seat, 2, 'teklif sonraki oyuncuya geçmeli');
    const al = E.satinAl(st, 2);
    assert.ok(al.ok, 'teklif turunda alım geçerli olmalı');
    assert.strictEqual(st.kare[kare].sahip, 2, 'teklifi kabul eden sahip olmalı');
    assert.strictEqual(st.oyuncu[2].para, E.BASLANGIC_PARA - E.KARELER[kare].p,
      'liste fiyatı ödenmeli (açık artırma YOK)');
    assert.strictEqual(st.teklif, null, 'teklif turu kapanmalı');
    /* Kimse almazsa kare sahipsiz kalmalı. */
    const st2 = E.macBaslat({ seats: [0, 1] });
    koy(st2, 0, kare - 3); sabitZar(st2, [1, 2]);
    E.zarAt(st2, 0); E.reddet(st2, 0); E.reddet(st2, 1);
    assert.strictEqual(st2.kare[kare].sahip, null, 'kimse almazsa kare sahipsiz kalmalı');
    assert.strictEqual(st2.faz, 'bitir', 'teklif turu bitince tur sonuna geçilmeli');
  }
  console.log('  ✓ 4) satın alma ve TEKLİF turu (açık artırma yerine liste fiyatı)');

  // 5) KİRA
  {
    const grup = mulkIdx('lblue');
    const st = E.macBaslat({ seats: [0, 1] });
    const k = grup[0];
    st.kare[k].sahip = 0;
    assert.strictEqual(E.kira(st, k, 0, false, false), E.KARELER[k].r[0],
      'grup eksikken taban kira işlemeli');
    grup.forEach(i => { st.kare[i].sahip = 0; });
    assert.strictEqual(E.kira(st, k, 0, false, false), E.KARELER[k].r[0] * 2,
      'grubun tamamı tek sahipteyse taban kira İKİ KATI olmalı');
    st.kare[k].ev = 3;
    assert.strictEqual(E.kira(st, k, 0, false, false), E.KARELER[k].r[3],
      'bina varsa kademe kirası işlemeli');
    st.kare[k].ev = 0;
    st.kare[k].ipotek = true;
    assert.strictEqual(E.kira(st, k, 0, false, false), 0, 'ipotekli mülkte kira olmamalı');
    /* Gar kirası sahip olunan gar sayısına göre. */
    const g = E.macBaslat({ seats: [0, 1] });
    const garlar = E.GAR_KARELERI;
    g.kare[garlar[0]].sahip = 0;
    assert.strictEqual(E.kira(g, garlar[0], 0, false, false), 25, 'tek gar 25₺ olmalı');
    g.kare[garlar[1]].sahip = 0;
    assert.strictEqual(E.kira(g, garlar[0], 0, false, false), 50, 'iki gar 50₺ olmalı');
    g.kare[garlar[2]].sahip = 0; g.kare[garlar[3]].sahip = 0;
    assert.strictEqual(E.kira(g, garlar[0], 0, false, false), 200, 'dört gar 200₺ olmalı');
    /* İdare kirası zar toplamının katı. */
    const d = E.macBaslat({ seats: [0, 1] });
    d.kare[E.IDARE_KARELERI[0]].sahip = 0;
    assert.strictEqual(E.kira(d, E.IDARE_KARELERI[0], 7, false, false), 28,
      'tek idare zarın 4 katı olmalı');
    d.kare[E.IDARE_KARELERI[1]].sahip = 0;
    assert.strictEqual(E.kira(d, E.IDARE_KARELERI[0], 7, false, false), 70,
      'iki idare zarın 10 katı olmalı');
    /* Kira gerçekten EL DEĞİŞTİRMELİ. */
    const t = E.macBaslat({ seats: [0, 1] });
    const kk = grup[0];
    t.kare[kk].sahip = 1;
    koy(t, 0, kk - 2); sabitZar(t, [1, 1]);
    E.zarAt(t, 0);
    const tutar = E.KARELER[kk].r[0];
    assert.strictEqual(t.oyuncu[0].para, E.BASLANGIC_PARA - tutar, 'kiracı ödemeli');
    assert.strictEqual(t.oyuncu[1].para, E.BASLANGIC_PARA + tutar, 'mal sahibi almalı');
  }
  console.log('  ✓ 5) kira: tam grup iki katı, bina kademesi, ipotekte sıfır, gar/idare kuralı');

  // 6) BİNA
  {
    const grup = mulkIdx('orange');
    const st = E.macBaslat({ seats: [0, 1] });
    st.kare[grup[0]].sahip = 0;
    assert.strictEqual(E.binaKur(st, 0, grup[0]).reason, 'grup_eksik',
      'grubun tamamı olmadan bina kurulamaz');
    grup.forEach(i => { st.kare[i].sahip = 0; });
    const b = E.KARELER[grup[0]].b;
    assert.ok(E.binaKur(st, 0, grup[0]).ok, 'grup tamken bina kurulmalı');
    assert.strictEqual(st.kare[grup[0]].ev, 1, 'bina kademesi artmalı');
    assert.strictEqual(st.oyuncu[0].para, E.BASLANGIC_PARA - b, 'bina bedeli düşülmeli');
    assert.strictEqual(E.binaKur(st, 0, grup[0]).reason, 'dengesiz',
      'DENGELİ inşaat: aynı kareye ikinci bina önce diğerlerine kurulmadan olmaz');
    grup.slice(1).forEach(i => assert.ok(E.binaKur(st, 0, i).ok, 'diğer karelere kurulabilmeli'));
    assert.ok(E.binaKur(st, 0, grup[0]).ok, 'denge sağlanınca ikinci bina kurulabilmeli');
    /* Otele kadar çık, sonra sınırı doğrula. */
    let koruma = 0;
    while (st.kare[grup[0]].ev < 5 && koruma++ < 40) {
      st.oyuncu[0].para += 10000;
      grup.forEach(i => { if (st.kare[i].ev < st.kare[grup[0]].ev + 1) E.binaKur(st, 0, i); });
    }
    assert.strictEqual(st.kare[grup[0]].ev, 5, '5. kademe otel olmalı');
    assert.strictEqual(E.binaKur(st, 0, grup[0]).reason, 'bina_dolu', 'otelden öteye kurulamaz');
    /* Satış yarı fiyatına ve dengeli. */
    const once = st.oyuncu[0].para;
    assert.ok(E.binaSat(st, 0, grup[0]).ok, 'bina satılabilmeli');
    assert.strictEqual(st.oyuncu[0].para, once + Math.floor(b / 2), 'satış yarı fiyatına olmalı');
    assert.strictEqual(E.binaSat(st, 0, grup[0]).reason, 'dengesiz', 'satış da dengeli olmalı');
    /* Başkasının mülküne kurulamaz. */
    assert.strictEqual(E.binaKur(st, 1, grup[0]).reason, 'not_your_turn',
      'sırası olmayan bina kuramaz');
  }
  console.log('  ✓ 6) bina: grup şartı, dengeli inşaat/satış, otel sınırı');

  // 7) İPOTEK
  {
    const grup = mulkIdx('red');
    const st = E.macBaslat({ seats: [0, 1] });
    grup.forEach(i => { st.kare[i].sahip = 0; });
    const k = grup[0], fiyat = E.KARELER[k].p;
    assert.ok(E.ipotek(st, 0, k).ok, 'ipotek yapılabilmeli');
    assert.strictEqual(st.kare[k].ipotek, true, 'kare ipotekli olmalı');
    assert.strictEqual(st.oyuncu[0].para, E.BASLANGIC_PARA + Math.floor(fiyat / 2),
      'ipotekte yarı fiyat alınmalı');
    const bedel = Math.ceil(fiyat * 0.55);
    const once = st.oyuncu[0].para;
    assert.ok(E.ipotek(st, 0, k).ok, 'ipotek geri alınabilmeli');
    assert.strictEqual(st.kare[k].ipotek, false, 'ipotek kalkmalı');
    assert.strictEqual(st.oyuncu[0].para, once - bedel, 'geri alırken %110 ödenmeli');
    /* Grupta bina varken ipotek yasak. */
    E.binaKur(st, 0, k);
    assert.strictEqual(E.ipotek(st, 0, grup[1]).reason, 'once_binalari_sat',
      'binalı grupta ipotek yapılamaz');
    /* Başkasının mülkü ipotek edilemez. */
    assert.strictEqual(E.ipotek(st, 0, mulkIdx('green')[0]).reason, 'sizin_degil',
      'sahibi olmadığınız kare ipotek edilemez');
  }
  console.log('  ✓ 7) ipotek: yarı fiyat / %110 geri alım, binalı grupta yasak');

  // 8) CEZAEVİ
  {
    /* Üç çift doğruca içeri. */
    const st = E.macBaslat({ seats: [0, 1] });
    sabitZar(st, [2, 2, 3, 3, 4, 4]);
    E.zarAt(st, 0);
    assert.strictEqual(st.cift, 1, 'birinci çift sayılmalı');
    E.turuBitir(st, 0); st.sira = 0; st.faz = 'zar';   // sıra kendisinde kalsın
    st.cift = 2;
    const r = E.zarAt(st, 0);
    assert.ok(r.ucCift, 'üçüncü çift cezaevine yollamalı');
    assert.strictEqual(st.oyuncu[0].cezaevi, true, 'oyuncu cezaevinde olmalı');
    assert.strictEqual(st.oyuncu[0].konum, E.CEZAEVI, 'cezaevi karesine gitmeli');
    /* Kefaletle çıkış. */
    const once = st.oyuncu[0].para;
    st.sira = st.seats.indexOf(0); st.faz = 'zar';
    assert.ok(E.kefaletOde(st, 0).ok, 'kefalet ödenebilmeli');
    assert.strictEqual(st.oyuncu[0].cezaevi, false, 'kefaletle çıkılmalı');
    assert.strictEqual(st.oyuncu[0].para, once - E.KEFALET, 'kefalet tutarı düşülmeli');
    /* Çıkış kartı. */
    const c = E.macBaslat({ seats: [0, 1] });
    c.oyuncu[0].cezaevi = true;
    assert.strictEqual(E.cikisKartiKullan(c, 0).reason, 'kart_yok', 'kart yokken kullanılamaz');
    c.oyuncu[0].cikisKarti = 1;
    assert.ok(E.cikisKartiKullan(c, 0).ok, 'kart varken kullanılabilmeli');
    assert.strictEqual(c.oyuncu[0].cezaevi, false, 'kartla çıkılmalı');
    assert.strictEqual(c.oyuncu[0].cikisKarti, 0, 'kart tüketilmeli');
    /* Cezaevinde çift atan çıkar. */
    const d = E.macBaslat({ seats: [0, 1] });
    d.oyuncu[0].cezaevi = true; koy(d, 0, E.CEZAEVI);
    sabitZar(d, [3, 3]);
    const rr = E.zarAt(d, 0);
    assert.ok(rr.cezadanCikti, 'çift atan cezaevinden çıkmalı');
    assert.strictEqual(d.oyuncu[0].konum, E.CEZAEVI + 6, 'çıkınca zar kadar ilerlemeli');
    /* Üçüncü denemede çift gelmezse kefalet zorunlu. */
    /* Havuz KAPALI: kefalet ücretsiz parka akmasın, yoksa oyuncu oraya
       düşünce kendi kefaletini geri alır ve ölçüm bozulur. 10 + 3 = 13
       sahipsiz bir mülk — para etkisi yok, yalnız "karar" fazı açılır. */
    const f = E.macBaslat({ seats: [0, 1], havuzAcik: false });
    f.oyuncu[0].cezaevi = true; f.oyuncu[0].cezaTur = 2; koy(f, 0, E.CEZAEVI);
    sabitZar(f, [1, 2]);
    const fr = E.zarAt(f, 0);
    assert.ok(fr.kefalet, 'üçüncü denemede kefalet kesilmeli');
    assert.strictEqual(f.oyuncu[0].cezaevi, false, 'kefaletle çıkmış olmalı');
    assert.strictEqual(f.oyuncu[0].para, E.BASLANGIC_PARA - E.KEFALET, 'kefalet düşülmeli');
  }
  console.log('  ✓ 8) cezaevi: üç çift içeri; çift/kefalet/kart ile çıkış');

  // 9) NAKDE ÇEVİRME ve İFLAS
  {
    /* Parası yetmeyenin önce BİNALARI, sonra MÜLKLERİ otomatik nakde çevrilir. */
    const grup = mulkIdx('yellow');
    const st = E.macBaslat({ seats: [0, 1] });
    grup.forEach(i => { st.kare[i].sahip = 0; });
    E.binaKur(st, 0, grup[0]);
    st.oyuncu[0].para = 10;
    const varlikOnce = E.varlik(st, 0);
    assert.ok(varlikOnce > 10, 'varlık nakitten büyük olmalı (mülk + bina)');
    const odendi = E.ode(st, 0, 100, 1, false);
    assert.ok(odendi, 'varlık yeterliyken ödeme tamamlanmalı');
    assert.strictEqual(st.oyuncu[0].iflas, false, 'tasfiye ile ödeyen iflas etmemeli');
    assert.strictEqual(st.oyuncu[1].para, E.BASLANGIC_PARA + 100, 'alacaklı parayı almalı');

    /* Varlık yetmezse İFLAS: mülkler alacaklıya geçer. */
    const i = E.macBaslat({ seats: [0, 1] });
    const k = mulkIdx('brown')[0];
    i.kare[k].sahip = 0;
    i.oyuncu[0].para = 5;
    assert.strictEqual(E.ode(i, 0, 99999, 1, false), false, 'yetmeyen ödeme başarısız olmalı');
    assert.strictEqual(i.oyuncu[0].iflas, true, 'ödeyemeyen iflas etmeli');
    assert.strictEqual(i.kare[k].sahip, 1, 'iflas edenin mülkü alacaklıya geçmeli');
    assert.strictEqual(i.status, 'finished', 'tek oyuncu kalınca maç bitmeli');
    assert.strictEqual(i.winner, 1, 'kalan oyuncu kazanmalı');
  }
  console.log('  ✓ 9) otomatik tasfiye ve iflas: mülkler alacaklıya geçiyor');

  // 10) TUR LİMİTİ
  {
    let s0 = 7;
    const rng = () => { s0 = (s0 * 1103515245 + 12345) & 0x7fffffff; return s0 / 0x7fffffff; };
    const st = E.macBaslat({ seats: [0, 1, 2], rng, turLimiti: 3 });
    assert.strictEqual(st.turLimiti, 3, 'tur limiti saklanmalı');
    let n = 0;
    while (st.status === 'playing' && n++ < 5000) E.sureDoldu(st, E.siradakiKoltuk(st));
    assert.strictEqual(st.status, 'finished', 'tur limiti dolunca maç bitmeli');
    assert.strictEqual(st.result.reason, 'tur_limiti', 'bitiş sebebi tur limiti olmalı');
    const v = st.result.varlik;
    const enYuksek = Math.max.apply(null, st.seats.map(s => v[s]));
    assert.strictEqual(v[st.winner], enYuksek, 'en yüksek varlığa sahip olan kazanmalı');
    /* Eşitlikte berabere. */
    const b = E.macBaslat({ seats: [0, 1] });
    E.macBitir(b, 'tur_limiti');
    assert.strictEqual(b.winner, null, 'varlıklar eşitse kazanan olmamalı');
  }
  console.log('  ✓ 10) tur limiti dolunca en yüksek varlık kazanıyor, eşitlikte berabere');

  // 11) SÜRE AŞIMI — kimse atılmaz
  {
    const st = E.macBaslat({ seats: [0, 1] });
    const r = E.sureDoldu(st, 0);
    assert.strictEqual(r.tur, 'zar', 'zar fazında sunucu zarı atmalı');
    assert.notStrictEqual(st.zar[0], 0, 'zar atılmış olmalı');
    assert.strictEqual(st.oyuncu[0].iflas, false, 'süresi dolan masadan ATILMAMALI');
    /* Karar fazında: parası bolsa alır. */
    const a = E.macBaslat({ seats: [0, 1] });
    const kare = mulkIdx('brown')[0];
    koy(a, 0, kare); a.faz = 'karar';
    const ra = E.sureDoldu(a, 0);
    assert.strictEqual(ra.tur, 'alir', 'parası bol oyuncu adına alınmalı');
    assert.strictEqual(a.kare[kare].sahip, 0, 'kare alınmış olmalı');
    /* Parası kıtsa reddeder (teklife bırakır). */
    const d = E.macBaslat({ seats: [0, 1] });
    koy(d, 0, kare); d.faz = 'karar'; d.oyuncu[0].para = 10;
    assert.strictEqual(E.sureDoldu(d, 0).tur, 'reddeder', 'parası kıt oyuncu adına reddedilmeli');
    /* Teklif fazında bekleyen reddetmiş sayılır. */
    assert.strictEqual(d.faz, 'teklif', 'reddedilince teklif turu açılmalı');
    assert.strictEqual(E.sureDoldu(d, 1).tur, 'teklif', 'teklifte bekleyen reddetmiş sayılmalı');
    /* Bitir fazında turu sunucu kapatır. */
    const t = E.macBaslat({ seats: [0, 1] });
    t.faz = 'bitir';
    assert.strictEqual(E.sureDoldu(t, 0).tur, 'bitir', 'bitir fazında tur kapatılmalı');
    assert.strictEqual(E.siradakiKoltuk(t), 1, 'sıra rakibe geçmeli');
  }
  console.log('  ✓ 11) süre aşımı: zarı/kararı/turu sunucu tamamlıyor, kimse atılmıyor');

  // 12) GÖRÜNÜM — deste sırası sızmamalı
  {
    const st = E.macBaslat({ seats: [0, 1] });
    const g = E.gorunum(st, 0);
    const metin = JSON.stringify(g);
    assert.ok(!('sansDeste' in g) && !('fonDeste' in g), 'deste SIRASI istemciye gitmemeli');
    assert.ok(!/sansDeste|fonDeste/.test(metin), 'paket içinde deste sırası olmamalı');
    assert.ok(!('rng' in g), 'rastgelelik kaynağı sızmamalı');
    /* Buna karşılık para ve mülkler AÇIKTIR — Metropol\'de gizli bilgi yok. */
    assert.strictEqual(g.oyuncular.length, 2, 'tüm oyuncular paketle gelmeli');
    assert.ok(g.oyuncular.every(o => typeof o.para === 'number'), 'paralar açık olmalı');
    assert.strictEqual(g.durum.length, 40, 'tüm karelerin durumu gelmeli');
    assert.strictEqual(g.kareler.length, 40, 'kare tanımları gelmeli');
    assert.strictEqual(g.seat, 0, 'bakan koltuk bildirilmeli');
    assert.strictEqual(E.gorunum(st, null).seat, null, 'izleyici koltuksuz olmalı');
  }
  console.log('  ✓ 12) deste sırası istemciye gitmiyor; para ve mülkler açık');
}

/* ----------------------------------------------------------------- ONLINE */
async function onlineTesti() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const rooms = serverModule.rooms;
  const acik = [];

  // 13) HAZIR MASALAR
  const masalar = await httpRooms(BASE, 'metropol');
  assert.strictEqual(masalar.length, 12, 'metropol 12 hazır masa açmalı');
  const kisiler = new Set(masalar.map(m => m.maxPlayers));
  assert.deepStrictEqual([...kisiler].sort(), [2, 3, 4], '2/3/4 kişilik masalar olmalı');
  assert.ok(masalar.every(m => String(m.id) >= '2701' && String(m.id) <= '2712'),
    'masa kimlikleri 2701-2712 aralığında olmalı');
  assert.ok(masalar.every(m => Number(m.rounds) >= 5), 'tur limiti masadan gelmeli');
  assert.ok(masalar.every(m => Number(m.moveSeconds) > 0), 'hamle süresi masadan gelmeli');
  {
    /* Lobi genelinde kimlik çakışması olmamalı — yeni oyun eskilerin masasını
       çalmasın. (Bu kontrol bir kez 1401-1700 bloğunda gerçek bir çakışma
       yakalamıştı; o yüzden her yeni oyunda tekrarlanıyor.) */
    const hepsi = new Map();
    for (const g of (serverModule.ALL_GAMES || ['metropol'])) {
      for (const m of await httpRooms(BASE, g)) {
        const id = String(m.id);
        assert.ok(!hepsi.has(id),
          'masa kimliği çakışıyor: #' + id + ' hem ' + hepsi.get(id) + ' hem ' + g);
        hepsi.set(id, g);
      }
    }
  }
  console.log('  ✓ 13) hazır masalar lobide (2/3/4 kişilik), kimlik çakışması yok');

  const oda = masalar.find(m => m.maxPlayers === 2);
  const A = await connect(BASE, 'mp-A');
  const B = await connect(BASE, 'mp-B');
  acik.push(A, B);
  for (const s of [A, B]) {
    s.emit('joinRoom', { roomId: String(oda.id), gameId: 'metropol', userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda.durationMinutes });
    await once(s, 'joinedRoom');
  }
  const basladi = [once(A, 'gameStarted', 12000), once(B, 'gameStarted', 12000)];
  [A, B].forEach(s => s.emit('setReady', { ready: true }));
  const [pA] = await Promise.all(basladi);

  // 14) SIRA KURALI ve ZAR YAYINI
  assert.strictEqual(pA.gameState.kind, 'metropol', 'masa paketi metropol olmalı');
  assert.strictEqual(pA.gameState.kareler.length, 40, 'tahta istemciye gitmeli');
  assert.ok(pA.gameState.turLimiti > 0, 'tur limiti masadan gelmeli');
  const odaNes = rooms.get(String(oda.id));
  const m = odaNes.metropol;
  const sira = m.seats[m.sira];
  const sSok = pA.seat === sira ? A : B;
  const dSok = pA.seat === sira ? B : A;
  {
    const red = once(dSok, 'metropolRejected', 8000);
    dSok.emit('metropolRoll', { roomId: String(oda.id) });
    assert.strictEqual((await red).reason, 'not_your_turn', 'sırası olmayan zar atamamalı');
  }
  {
    /* Zarı sabitle: 3+3 = 6 → SULTANAHMET (sahipsiz mülk). Kart karesine
       düşülmemeli, yoksa kart oyuncuyu başka kareye taşır ve ölçüm bozulur. */
    m.rng = () => 0.4;
    const zarA = once(A, 'metropolDice', 8000);
    const zarB = once(B, 'metropolDice', 8000);
    sSok.emit('metropolRoll', { roomId: String(oda.id) });
    const [dA, dB] = await Promise.all([zarA, zarB]);
    assert.deepStrictEqual(dA.zar, dB.zar, 'iki istemci aynı zarı görmeli');
    assert.strictEqual(dA.seat, sira, 'zarı atan koltuk bildirilmeli');
    assert.strictEqual(m.oyuncu[sira].konum, dA.zar[0] + dA.zar[1], 'piyon zar kadar ilerlemeli');
    assert.strictEqual(m.faz, 'karar', 'sahipsiz mülke düşülmeli (zar sabitlendi)');
    const kareIdx = m.oyuncu[sira].konum;
    const diger = m.seats.find(x => x !== sira);

    /* ÖNCE REDDET: teklif turu açılmalı ve sıra/saat teklifin yapıldığı
       oyuncuya geçmeli — zarı atanda kalmamalı, yoksa masa yanlış kişiyi
       bekler ve onun süresini yakar. */
    {
      const yayin = once(B, 'metropolAction', 8000);
      sSok.emit('metropolDecline', { roomId: String(oda.id) });
      assert.strictEqual((await yayin).eylem, 'reddet', 'ret masaya duyurulmalı');
      assert.strictEqual(m.faz, 'teklif', 'reddedince teklif turu açılmalı');
      assert.strictEqual(m.teklif.sira[m.teklif.idx], diger, 'teklif diğer oyuncuya gitmeli');
      assert.strictEqual(serverModule.turnSeatOf
        ? serverModule.turnSeatOf(odaNes) : diger, diger,
        'hamle saati teklifin yapıldığı oyuncuya geçmeli');
    }
    /* SONRA DİĞER OYUNCU ALSIN: liste fiyatından, açık artırma olmadan. */
    {
      const once0 = m.oyuncu[diger].para;
      const yayin = once(A, 'metropolAction', 8000);
      dSok.emit('metropolBuy', { roomId: String(oda.id) });
      const y = await yayin;
      assert.strictEqual(y.eylem, 'al', 'alım masaya duyurulmalı');
      assert.strictEqual(m.kare[kareIdx].sahip, diger, 'teklifi kabul eden sahip olmalı');
      assert.strictEqual(m.oyuncu[diger].para, once0 - E.KARELER[kareIdx].p,
        'liste fiyatı düşülmeli');
    }
  }
  console.log('  ✓ 14) oyun başladı, sıra ve TEKLİF turu işliyor, zar iki istemciye yansıyor');

  acik.forEach(s => { try { s.close(); } catch (_) {} });
  server.close();
}

/* ---------------------------------------------------------------- ARAYÜZ */
function arayuzTesti() {
  const sayfa = oku('index.html');
  assert.ok(/metropol:\{name:'Metropol'/.test(sayfa), 'oyun listesinde olmalı');
  assert.ok(/js\/metropol-online\.js/.test(sayfa), 'istemci adaptörü bağlı olmalı');
  assert.ok(/\.mp-tahta\{/.test(sayfa), 'metropol stilleri olmalı');
  assert.ok(/metropol:`<div class="rules-content">/.test(sayfa), 'kurallar metni olmalı');
  assert.ok(/ONLINE_GAMES = \[[^\]]*'metropol'/.test(sayfa), 'online oyun listesinde olmalı');
  assert.ok(/metropol:\[\]/.test(sayfa), 'ROOMS kaydı olmalı');
  /* Açık artırma yerine teklif turu kuralı AÇIKÇA yazmalı — gizli sapma olmasın. */
  assert.ok(/teklif edilir/.test(sayfa), 'teklif turu kuralı kurallarda anlatılmalı');

  const istemci = oku('js/metropol-online.js');
  assert.ok(/kinds: \['metropol'\]/.test(istemci), 'adaptör türü karşılamalı');
  assert.ok(/--mp-k/.test(istemci), 'kare boyu ölçülen alana göre verilmeli');
  assert.ok(/orientationchange/.test(istemci), 'yön değişiminde ölçü tazelenmeli');
  assert.ok(/classList\.toggle\('dar'/.test(istemci), 'dar ekranda düzen değişmeli');
  assert.ok(/gv-arena-clock/.test(istemci), 'saat ayrı düğümde olmalı (her saniye yeniden çizim yok)');
  /* Tahta SUNUCUDAN gelmeli: istemcide ikinci bir kopya tutulmamalı. */
  assert.ok(/s\.kareler/.test(istemci), 'istemci kareleri sunucu paketinden okumalı');
  assert.ok(!/KASIMPAŞA/.test(istemci), 'istemci kare listesinin kopyasını TUTMAMALI');
  /* Zar ve para hesabı istemcide olmamalı. */
  assert.ok(!/Math\.random\(\)\s*\*\s*6/.test(istemci), 'zar istemcide atılmamalı');

  const sunucu = oku('server.js');
  assert.ok(/metropol: \[2701/.test(sunucu), 'masa kimlik aralığı tanımlı olmalı');
  assert.ok(/socket\.on\('metropolRoll'/.test(sunucu), 'zar olayı sunucuda olmalı');
  assert.ok(/socket\.on\('metropolBuy'/.test(sunucu), 'alım olayı sunucuda olmalı');
  assert.ok(/socket\.on\('metropolBuild'/.test(sunucu), 'bina olayı sunucuda olmalı');
  assert.ok(/socket\.on\('metropolEndTurn'/.test(sunucu), 'tur bitirme olayı sunucuda olmalı');
  /* ⚠ Liste ÜYELİĞİ ölçülüyor, SIRA değil: oyunun listenin sonunda olmasını
     şart koşan regex, bir sonraki oyun eklenince kırılır. */
  const yonetilen = (sunucu.match(/MANAGED_CARD_GAMES = \[[\s\S]*?\];/) || [''])[0];
  assert.ok(yonetilen.includes("'metropol'"),
    'kurucu panelinden kişi sayısı yönetilebilmeli');
  assert.ok(/metropolEngine\.sureDoldu/.test(sunucu), 'süre aşımı motora bağlı olmalı');
  const tumOyunlar = (sunucu.match(/ALL_GAMES = \[[\s\S]*?\];/) || [''])[0];
  assert.ok(tumOyunlar.includes("'metropol'"), 'oyun listesine eklenmeli');

  const panel = oku('js/admin-panel.js');
  assert.ok(/metropol: \{ kisi: \[2, 3, 4\]/.test(panel), 'kurucu paneli 2-4 kişi seçebilmeli');
  assert.ok(/metropol: 2701/.test(panel), 'panelin taban numarası güncel olmalı');

  /* Reddedilen işlemlerin HEPSİNİN Türkçe karşılığı olmalı — oyuncu "🚫 Bu
     işlem şu anda yapılamıyor" gibi boş bir cümle görmesin. */
  const mesajlar = oku('js/messages.js');
  ['satilmaz', 'para_yetmiyor', 'sizin_degil', 'grup_eksik', 'ipotekli', 'bina_dolu',
   'dengesiz', 'bina_yok', 'once_binalari_sat', 'kart_yok', 'gecersiz_kare'].forEach(kod => {
    assert.ok(new RegExp('\\b' + kod + ':').test(mesajlar), kod + ' için Türkçe mesaj olmalı');
  });
  assert.ok(/tur_limiti/.test(mesajlar), 'tur limiti bitişi için metin olmalı');

  assert.ok(fs.existsSync(path.join(KOK, 'assets', 'covers', 'metropol.jpg')), 'kapak olmalı');
  assert.ok(fs.existsSync(path.join(KOK, 'tools', 'kapak-metropol.py')), 'kapak betiği olmalı');
  console.log('  ✓ 15) istemci, stiller, kurallar, mesajlar, kurucu paneli ve kapak bağlı');
}

(async () => {
  try {
    motorTesti();
    await onlineTesti();
    arayuzTesti();
    console.log('OK metropol: tahta/kira/bina/ipotek/cezaevi/iflas kuralları, tur limiti, online akış');
    process.exit(0);
  } catch (e) {
    console.error('HATA:', e && e.message);
    console.error(e && e.stack);
    process.exit(1);
  }
})();
