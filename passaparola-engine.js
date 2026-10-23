'use strict';
/* ============================================================================
 * PASSAPAROLA — SAF OYUN MOTORU (sunucu yetkili)
 * ============================================================================
 * İki kişilik bilgi yarışması. Her oyuncunun KENDİ 27 harflik çarkı ve KENDİ
 * saati vardır; saat yalnız o oyuncunun sırasındayken işler.
 *
 * KURALLAR (yerel prototipten birebir alındı)
 *   · Çark Türk alfabesinin 27 harfinden oluşur (J yok — soru havuzunda da
 *     yok). Her harfin o harfle başlayan bir sorusu vardır.
 *   · DOĞRU cevap: harf yeşile döner, SIRA OYUNCUDA KALIR, sıradaki
 *     cevaplanmamış harfe geçilir.
 *   · YANLIŞ cevap: harf kırmızıya döner ve SIRA RAKİBE GEÇER.
 *   · PAS ("passaparola"): harf maviye döner, sona bırakılır ve SIRA RAKİBE
 *     GEÇER. Cevaplanmamış harf kalmayınca pas geçilen harflere dönülür.
 *   · HARF AL: doğru cevaptan rastgele bir harf açılır, karşılığında
 *     5 saniye yanar.
 *   · Saat biten ya da çarkını bitiren oyuncu oynayamaz; ikisi de
 *     oynayamıyorsa maç biter.
 *   · Kazanan en çok DOĞRU cevabı olandır; eşitlikte saati çok kalan kazanır,
 *     o da eşitse maç berabere biter.
 *
 * SUNUCU YETKİSİ: doğru cevap İSTEMCİYE HİÇ GÖNDERİLMEZ. İstemci yalnız
 * soruyu, harf sayısını ve açılan harfleri görür; karşılaştırma buradadır.
 * Saat de burada işler (tikle), istemci yalnız gösterir.
 * ========================================================================= */

const fs = require('fs');
const path = require('path');

const HARFLER = ['A', 'B', 'C', 'Ç', 'D', 'E', 'F', 'G', 'H', 'I', 'İ', 'K', 'L', 'M',
  'N', 'O', 'Ö', 'P', 'R', 'S', 'Ş', 'T', 'U', 'Ü', 'V', 'Y', 'Z'];
const HARF_AL_CEZASI_SN = 5;
const VARSAYILAN_SURE_SN = 120;

/* --------------------------------------------------------------- SORULAR */
let SETLER = null;
function setleriYukle(yol) {
  if (SETLER) return SETLER;
  const dosya = yol || path.join(__dirname, 'passaparola-sorular.json');
  try {
    const ham = JSON.parse(fs.readFileSync(dosya, 'utf8'));
    SETLER = (Array.isArray(ham) ? ham : []).filter(s => s && Array.isArray(s.questions) && s.questions.length);
  } catch (e) {
    /* Soru havuzu okunamazsa oyun hiç açılmamalı; sessizce boş soruyla
       oynatmak oyuncuyu şaşırtır. */
    console.error('[passaparola] SORU HAVUZU OKUNAMADI:', dosya, e && e.message);
    SETLER = [];
  }
  return SETLER;
}
/* SORU HAVUZU (kullanıcı isteği: "en az 500/1000 farklı yarışma, zorluk
   seviyeleri karışık"). passaparola-havuz.json harf başına ~35-45 soru
   taşır (1 kolay · 2 orta · 3 zor). Her maçta her harf için havuzdan
   RASTGELE bir soru seçilir → her maç yeni bir yarışmadır (27 harfin
   kombinasyonu milyarlarca farklı yarışma verir). Eski sabit setlerin
   soruları da havuza "kolay" olarak katılır. */
let HAVUZ = null;
function havuzYukle(yol) {
  if (HAVUZ) return HAVUZ;
  HAVUZ = {};
  const ekle = q => {
    if (!q || !q.letter || !q.question || !q.answer) return;
    (HAVUZ[q.letter] = HAVUZ[q.letter] || []).push(q);
  };
  try {
    const ham = JSON.parse(fs.readFileSync(yol || path.join(__dirname, 'passaparola-havuz.json'), 'utf8'));
    (Array.isArray(ham) ? ham : (ham && ham.sorular) || []).forEach(ekle);
  } catch (e) { console.warn('[passaparola] soru havuzu okunamadı, yalnız sabit setler kullanılacak:', e && e.message); }
  setleriYukle().forEach(st => st.questions.forEach(q =>
    ekle(Object.assign({ id: 'set' + st.id + '-' + q.letter, zorluk: 1 }, q))));
  return HAVUZ;
}
function havuzBoyutu() { const h = havuzYukle(); return Object.values(h).reduce((a, l) => a + l.length, 0); }
/* Son maçlarda sorulan soruları bir süre tekrar sorma (aynı oyuncular art
   arda oynarken aynı soruyla karşılaşmasın). */
const SON_SORULAN = [];
const SON_SORULAN_MAX = 900;
let yarismaSayaci = 0;
/* Zorluk karışımı: her maçta ~%35 kolay, ~%40 orta, ~%25 zor. */
function havuzdanSetKur(rng) {
  const r = rng || Math.random;
  const h = havuzYukle();
  const hedefler = HARFLER.map(() => { const x = r(); return x < 0.35 ? 1 : x < 0.75 ? 2 : 3; });
  const yakin = new Set(SON_SORULAN);
  const sorular = [];
  for (let i = 0; i < HARFLER.length; i++) {
    const liste = h[HARFLER[i]] || [];
    if (!liste.length) return null;
    const taze = liste.filter(q => !yakin.has(q.id || q.question));
    const kaynak = taze.length ? taze : liste;
    const uygun = kaynak.filter(q => Number(q.zorluk || 2) === hedefler[i]);
    const secim = (uygun.length ? uygun : kaynak);
    sorular.push(secim[Math.floor(r() * secim.length)]);
  }
  sorular.forEach(q => { SON_SORULAN.push(q.id || q.question); });
  while (SON_SORULAN.length > SON_SORULAN_MAX) SON_SORULAN.shift();
  yarismaSayaci++;
  const z = sorular.reduce((a, q) => a + Number(q.zorluk || 2), 0) / sorular.length;
  const etiket = z < 1.75 ? 'Kolay' : z < 2.25 ? 'Orta' : 'Zor';
  return { id: 'h' + Date.now().toString(36) + yarismaSayaci, name: 'Karışık Yarışma • ' + etiket, questions: sorular };
}
function setSayisi() { return setleriYukle().length + (havuzBoyutu() ? 1 : 0); }
function setAdlari() { return setleriYukle().map(s => ({ id: s.id, ad: s.name })); }

/* -------------------------------------------------------------- KARŞILAŞTIR
 * Türkçe normalleştirme: büyük/küçük, şapkalı harfler, boşluk ve noktalama
 * yok sayılır. "İstanbul", "istanbul " ve "ISTANBUL" aynı cevaptır. */
function normalize(s) {
  return String(s == null ? '' : s)
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[âà]/g, 'a').replace(/[îì]/g, 'i').replace(/[ûù]/g, 'u')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9]/g, '');
}
function cevapDogruMu(verilen, dogru, alternatifler) {
  const v = normalize(verilen);
  if (!v) return false;
  if (v === normalize(dogru)) return true;
  return (alternatifler || []).some(a => normalize(a) === v);
}

/* ------------------------------------------------------------------- MAÇ */
function macBaslat(opts) {
  const o = opts || {};
  const setler = setleriYukle();
  const seats = (o.seats || [0, 1]).slice(0, 2);
  /* Alt sınır yalnız yanlış yapılandırmaya karşı; gerçek masalar 90/120/180
     saniye kullanıyor (bkz. server.js → passaparolaSureSn). */
  const sure = Math.max(5, Number(o.sureSn) || VARSAYILAN_SURE_SN);
  /* Set seçimi: verilmemişse (ya da yoksa) rastgele. İki oyuncu AYNI seti
     oynar — sorular aynı olmazsa maç adil olmaz. */
  let set = setler.find(s => String(s.id) === String(o.setId));
  /* Set istenmediyse her maç havuzdan YENİ bir yarışma kurulur. */
  if (!set && o.setId === undefined) set = havuzdanSetKur(o.rng);
  if (!set) {
    const r = o.rng || Math.random;
    set = setler[Math.floor(r() * setler.length)] || { id: 0, name: '—', questions: [] };
  }
  const sorular = {};
  set.questions.forEach(q => { if (q && q.letter) sorular[q.letter] = q; });

  const durum = {};      // koltuk → { harf: 'bos'|'dogru'|'yanlis'|'pas' }
  const indeks = {};     // koltuk → çarkta hangi harfte
  const saat = {};       // koltuk → kalan saniye
  seats.forEach(s => {
    durum[s] = {};
    HARFLER.forEach(h => { durum[s][h] = 'bos'; });
    indeks[s] = 0;
    saat[s] = sure;
  });

  return {
    kind: 'passaparola',
    seats,
    setId: set.id,
    setAdi: set.name,
    sorular,                 // SIR: cevaplar burada, istemciye gitmez
    sureSn: sure,
    turn: seats[0],
    durum, indeks, saat,
    acilanHarfler: [],       // o anki soru için açılmış harf indeksleri
    son: null,               // son olayın özeti (ekran şeridi için)
    status: 'playing',
    winner: null,
    result: null
  };
}

/* O koltuğun şu anki harfi ve sorusu. */
function aktifHarf(st, seat) { return HARFLER[st.indeks[seat]] || null; }
function aktifSoru(st, seat) {
  const h = aktifHarf(st, seat);
  return h ? (st.sorular[h] || null) : null;
}

/* Sıradaki oynanabilir harf: önce hiç dokunulmamışlar, sonra pas geçilenler.
   Hiçbiri kalmadıysa -1. */
function sonrakiIndeks(st, seat) {
  const d = st.durum[seat];
  const bas = st.indeks[seat];
  for (let i = 1; i <= HARFLER.length; i++) {
    const k = (bas + i) % HARFLER.length;
    if (d[HARFLER[k]] === 'bos') return k;
  }
  for (let i = 1; i <= HARFLER.length; i++) {
    const k = (bas + i) % HARFLER.length;
    if (d[HARFLER[k]] === 'pas') return k;
  }
  /* Üstünde durduğumuz harf hâlâ oynanabiliyorsa (tek harf kaldıysa) kal. */
  const simdi = HARFLER[bas];
  if (d[simdi] === 'bos' || d[simdi] === 'pas') return bas;
  return -1;
}
function oynayabilirMi(st, seat) {
  if (st.saat[seat] <= 0) return false;
  const d = st.durum[seat];
  return HARFLER.some(h => d[h] === 'bos' || d[h] === 'pas');
}
function dogruSayisi(st, seat) {
  const d = st.durum[seat];
  return HARFLER.filter(h => d[h] === 'dogru').length;
}

/* ------------------------------------------------------------ SIRA GEÇİŞİ */
function siraDegis(st) {
  const rakip = st.seats.find(s => s !== st.turn);
  st.acilanHarfler = [];
  if (rakip !== undefined && oynayabilirMi(st, rakip)) {
    st.turn = rakip;
    return;
  }
  if (oynayabilirMi(st, st.turn)) return;    // rakip oynayamıyor, sıra kalır
  macBitir(st, 'finished');
}

/* Harfi işaretle ve çarkı ilerlet. */
function isaretle(st, seat, harf, sonuc) {
  st.durum[seat][harf] = sonuc;
  const k = sonrakiIndeks(st, seat);
  if (k >= 0) st.indeks[seat] = k;
  st.acilanHarfler = [];
}

/* ---------------------------------------------------------------- CEVAP */
function cevapla(st, seat, metin) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (seat !== st.turn) return { ok: false, reason: 'not_your_turn' };
  const soru = aktifSoru(st, seat);
  if (!soru) return { ok: false, reason: 'wrong_phase' };
  const yazi = String(metin == null ? '' : metin).trim();
  if (!yazi) return { ok: false, reason: 'bos_cevap' };

  const harf = aktifHarf(st, seat);
  const dogru = cevapDogruMu(yazi, soru.answer, soru.alternatives);
  isaretle(st, seat, harf, dogru ? 'dogru' : 'yanlis');
  st.son = { seat, harf, dogru, cevap: soru.answer, verilen: yazi, tur: 'cevap' };

  if (dogru) {
    /* DOĞRU: sıra oyuncuda kalır — ama çarkı bittiyse rakibe geçer. */
    if (!oynayabilirMi(st, seat)) siraDegis(st);
  } else {
    siraDegis(st);
  }
  return { ok: true, dogru, harf, cevap: soru.answer, bitti: st.status !== 'playing' };
}

/* ------------------------------------------------------------------- PAS */
function pas(st, seat) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (seat !== st.turn) return { ok: false, reason: 'not_your_turn' };
  const harf = aktifHarf(st, seat);
  if (!harf) return { ok: false, reason: 'wrong_phase' };
  isaretle(st, seat, harf, 'pas');
  st.son = { seat, harf, tur: 'pas' };
  siraDegis(st);
  return { ok: true, harf, bitti: st.status !== 'playing' };
}

/* -------------------------------------------------------------- HARF AL
   Doğru cevaptan rastgele bir harf açılır; karşılığında 5 saniye yanar.
   İlk harf zaten bilindiği için (soru o harfle başlar) 0. sıra atlanır. */
function harfAl(st, seat, rng) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (seat !== st.turn) return { ok: false, reason: 'not_your_turn' };
  const soru = aktifSoru(st, seat);
  if (!soru) return { ok: false, reason: 'wrong_phase' };
  if (st.saat[seat] <= HARF_AL_CEZASI_SN) return { ok: false, reason: 'sure_yetmez' };
  const cevap = [...String(soru.answer || '')];
  const adaylar = [];
  for (let i = 1; i < cevap.length; i++) {
    if (cevap[i] === ' ') continue;
    if (st.acilanHarfler.indexOf(i) === -1) adaylar.push(i);
  }
  if (!adaylar.length) return { ok: false, reason: 'harf_kalmadi' };
  const r = rng || Math.random;
  const sec = adaylar[Math.floor(r() * adaylar.length)];
  st.acilanHarfler = st.acilanHarfler.concat([sec]).sort((a, b) => a - b);
  st.saat[seat] = Math.max(0, st.saat[seat] - HARF_AL_CEZASI_SN);
  if (st.saat[seat] <= 0) { st.son = { seat, tur: 'sure' }; siraDegis(st); }
  return { ok: true, indeks: sec, kalanSn: st.saat[seat] };
}

/* ------------------------------------------------------------------ SAAT
   Sunucu saniyede bir çağırır. Yalnız SIRASI OLAN oyuncunun saati işler. */
function tik(st, saniye) {
  if (st.status !== 'playing') return { degisti: false };
  const sn = Math.max(0, Number(saniye) || 1);
  const seat = st.turn;
  const once = st.saat[seat];
  st.saat[seat] = Math.max(0, once - sn);
  if (once > 0 && st.saat[seat] === 0) {
    st.son = { seat, tur: 'sure' };
    siraDegis(st);
    return { degisti: true, sureBitti: true, seat, bitti: st.status !== 'playing' };
  }
  return { degisti: st.saat[seat] !== once };
}

/* ---------------------------------------------------------------- BİTİŞ */
function macBitir(st, reason) {
  st.status = 'finished';
  const [a, b] = st.seats;
  const da = dogruSayisi(st, a), db = dogruSayisi(st, b);
  let winner = null;
  if (da !== db) winner = da > db ? a : b;
  else if (st.saat[a] !== st.saat[b]) winner = st.saat[a] > st.saat[b] ? a : b;
  st.winner = winner;
  st.result = {
    reason: reason || 'finished', winner,
    dogru: { [a]: da, [b]: db },
    saat: { [a]: st.saat[a], [b]: st.saat[b] },
    /* Beraberlik SAATLE bozulduysa sonuç ekranı bunu yazsın. */
    sureFarki: da === db && winner !== null
  };
  return st.result;
}
function pesEt(st, seat) {
  if (st.status !== 'playing') return st.result;
  const rakip = st.seats.find(s => s !== seat);
  st.status = 'finished';
  st.winner = rakip === undefined ? null : rakip;
  st.result = { reason: 'resign', winner: st.winner,
    dogru: { [st.seats[0]]: dogruSayisi(st, st.seats[0]), [st.seats[1]]: dogruSayisi(st, st.seats[1]) },
    saat: Object.assign({}, st.saat) };
  return st.result;
}

/* --------------------------------------------------------------- GÖRÜNÜM
 * CEVAP SIR'dır. İstemciye yalnız soru metni, cevabın harf sayısı ve
 * açılmış harfler gider; maç bitince son sorunun cevabı da açılır. */
function cevapMaskesi(st, seat) {
  const soru = aktifSoru(st, seat);
  if (!soru) return [];
  return [...String(soru.answer || '')].map((ch, i) => {
    if (ch === ' ') return ' ';
    if (i === 0) return ch;                       // ilk harf zaten bilinir
    return st.acilanHarfler.indexOf(i) !== -1 ? ch : null;
  });
}
function gorunum(st, seat, ekstra) {
  const bakan = (seat === 0 || seat === 1) ? seat : null;
  const sirada = st.turn;
  const soru = aktifSoru(st, sirada);
  const acik = st.status !== 'playing';
  return Object.assign({
    kind: 'passaparola',
    status: st.status,
    seats: st.seats.slice(),
    seat: bakan,
    turn: sirada,
    harfler: HARFLER.slice(),
    setAdi: st.setAdi,
    sureSn: st.sureSn,
    durum: st.seats.reduce((a, s) => { a[s] = Object.assign({}, st.durum[s]); return a; }, {}),
    aktifHarf: st.seats.reduce((a, s) => { a[s] = aktifHarf(st, s); return a; }, {}),
    saat: Object.assign({}, st.saat),
    dogru: st.seats.reduce((a, s) => { a[s] = dogruSayisi(st, s); return a; }, {}),
    soru: soru ? soru.question : null,
    harfSayisi: soru ? [...String(soru.answer || '')].length : 0,
    maske: cevapMaskesi(st, sirada),
    /* Cevap YALNIZ maç bitince açılır — kimse için erken görünmez. */
    cevap: acik && soru ? soru.answer : null,
    harfAlCezasi: HARF_AL_CEZASI_SN,
    son: st.son,
    winner: st.winner,
    result: st.result
  }, ekstra || {});
}

module.exports = {
  HARFLER, HARF_AL_CEZASI_SN, VARSAYILAN_SURE_SN,
  setleriYukle, setSayisi, setAdlari, normalize, cevapDogruMu, havuzYukle, havuzBoyutu, havuzdanSetKur, HARFLER,
  macBaslat, cevapla, pas, harfAl, tik, macBitir, pesEt,
  aktifHarf, aktifSoru, sonrakiIndeks, oynayabilirMi, dogruSayisi,
  cevapMaskesi, gorunum
};
