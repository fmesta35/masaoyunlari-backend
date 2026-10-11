'use strict';
/* ============================================================================
 * ADAM ASMACA — SAF OYUN MOTORU (sunucu yetkili)
 * ============================================================================
 * İki kişilik kelime düellosu. Bir oyuncu GİZLEYEN, diğeri TAHMİNCİ'dir ve
 * her el sonunda roller değişir.
 *
 * KURALLAR
 *   · Gizleyen, TDK sözlüğünde bulunan 3-14 harflik tek bir Türkçe kelime
 *     seçer; isterse bir ipucu yazar. Kelime sunucuda saklanır — tahminciye
 *     ve izleyiciye yalnız MASKE (açılan harfler + gizliler) gider.
 *   · Tahminci harf harf gider. Yanlış her harf bir can götürür; 6 yanlışta
 *     adam asılır ve el gizleyenin olur.
 *   · PUAN — tahminci çözerse 40 + kalan can × 10; gizleyen kazanırsa
 *     40 + açılamayan farklı harf sayısı × 5. (Yerel prototipin puanlaması
 *     birebir korundu, böylece oyunun dengesi değişmiyor.)
 *   · Maç, masanın "el sayısı" ayarı kadar el sürer. Roller her el değiştiği
 *     için el sayısı ÇİFT tutulur (iki taraf da eşit sayıda gizler).
 *   · Berabere biten maçta kazanan yoktur.
 *
 * SÜRE
 *   Sunucu hamle süresini işletir. Süresi dolan GİZLEYEN'in yerine sözlükten
 *   rastgele bir kelime seçilir (oyun durmasın); süresi dolan TAHMİNCİ bir
 *   can kaybeder — yani kendiliğinden yanlış harf saymış olur. Hiç kimse
 *   masadan atılmaz, site kuralı budur.
 *
 * Bu dosya SAF mantıktır: soket, zamanlayıcı, oda yoktur.
 * ========================================================================= */

const kelimelik = require('./kelimelik-engine.js');

const HARFLER = 'ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ';
const HARF_KUMESI = new Set([...HARFLER]);
const EN_AZ_HARF = 3;
const EN_COK_HARF = 14;
const VARSAYILAN_CAN = 6;
const VARSAYILAN_EL = 4;

/* Türkçe büyük harfe çevir ve boşluk/kesme işaretlerini at. */
function temizle(s) {
  return kelimelik.trBuyuk(String(s == null ? '' : s)).replace(/[\s'’`´-]/g, '');
}
function harfler(k) { return [...String(k || '')]; }

/* --------------------------------------------------------------- KELİME ÖLÇ
   Kelime oyuna uygun mu? Uygun değilse SEBEP kodu döner (Türkçesi
   js/messages.js'te). */
function kelimeyiOlc(ham) {
  const k = temizle(ham);
  const n = harfler(k).length;
  if (n < EN_AZ_HARF) return { ok: false, reason: 'kelime_kisa', kelime: k };
  if (n > EN_COK_HARF) return { ok: false, reason: 'kelime_uzun', kelime: k };
  if (!harfler(k).every(h => HARF_KUMESI.has(h))) {
    return { ok: false, reason: 'gecersiz_harf', kelime: k };
  }
  if (!kelimelik.sozluktekiMi(k)) {
    return { ok: false, reason: 'sozlukte_yok', kelime: k,
             oneriler: kelimelik.benzerKelimeler(k, 3) };
  }
  return { ok: true, kelime: k };
}

/* ------------------------------------------------------------------ MAÇ */
function macBaslat(opts) {
  const o = opts || {};
  const seats = (o.seats || [0, 1]).slice(0, 2);
  /* El sayısı çift olsun: roller her el değiştiği için tek sayıda elde bir
     taraf fazladan kez gizler ve maç adil olmaz. */
  let elSayisi = Math.max(2, Number(o.elSayisi) || VARSAYILAN_EL);
  if (elSayisi % 2) elSayisi += 1;
  const st = {
    kind: 'adamasmaca',
    seats,
    elSayisi,
    maxYanlis: Math.max(3, Number(o.maxYanlis) || VARSAYILAN_CAN),
    el: 1,
    skor: { [seats[0]]: 0, [seats[1]]: 0 },
    gizleyen: seats[0],
    tahminci: seats[1],
    status: 'playing',
    result: null,
    sonEl: null                      // biten elin özeti (sonuç şeridi için)
  };
  eliHazirla(st);
  return st;
}

/* Yeni el: kelime bekleme fazına geç. */
function eliHazirla(st) {
  st.faz = 'kelime';
  st.kelime = '';
  st.ipucu = '';
  st.tahminler = [];                 // denenen harfler (sırayla)
  st.dogruHarfler = [];              // kelimede bulunanlar
  st.yanlis = 0;
}

/* Sırası gelen koltuk: kelime fazında gizleyen, tahmin fazında tahminci. */
function siradaki(st) {
  if (st.status !== 'playing') return null;
  return st.faz === 'kelime' ? st.gizleyen : st.tahminci;
}

/* --------------------------------------------------------- KELİME SEÇİMİ */
function kelimeSec(st, seat, kelime, ipucu) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (st.faz !== 'kelime') return { ok: false, reason: 'wrong_phase' };
  if (seat !== st.gizleyen) return { ok: false, reason: 'not_your_turn' };
  const olcum = kelimeyiOlc(kelime);
  if (!olcum.ok) return olcum;
  st.kelime = olcum.kelime;
  st.ipucu = String(ipucu == null ? '' : ipucu).trim().slice(0, 60);
  st.faz = 'tahmin';
  return { ok: true, kelime: st.kelime };
}

/* Süresi dolan gizleyenin yerine sözlükten kelime seç (oyun durmasın). */
function kelimeyiSunucuSec(st, rng) {
  if (st.faz !== 'kelime') return null;
  let k = null;
  for (let i = 0; i < 20 && !k; i++) k = kelimelik.rastgeleKelime(4, 9, rng);
  if (!k) k = 'KELİME';
  st.kelime = temizle(k);
  st.ipucu = '';
  st.faz = 'tahmin';
  return st.kelime;
}

/* ----------------------------------------------------------------- TAHMİN */
function harfTahmin(st, seat, harf) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (st.faz !== 'tahmin') return { ok: false, reason: 'wrong_phase' };
  if (seat !== st.tahminci) return { ok: false, reason: 'not_your_turn' };
  const h = temizle(harf);
  if (harfler(h).length !== 1 || !HARF_KUMESI.has(h)) {
    return { ok: false, reason: 'gecersiz_harf' };
  }
  if (st.tahminler.indexOf(h) !== -1) return { ok: false, reason: 'harf_denendi' };
  return harfiIsle(st, h, false);
}

/* Süresi dolan tahminci: kullanılmamış bir harf onun adına YANLIŞ sayılır.
   Böylece oyun ilerler ama ceza da tahmincinin üstünde kalır. */
function sureDoldu(st, rng) {
  if (st.status !== 'playing') return null;
  if (st.faz === 'kelime') return { tur: 'kelime', kelime: kelimeyiSunucuSec(st, rng) };
  const r = rng || Math.random;
  const kalanlar = [...HARFLER].filter(h =>
    st.tahminler.indexOf(h) === -1 && harfler(st.kelime).indexOf(h) === -1);
  const havuz = kalanlar.length ? kalanlar
    : [...HARFLER].filter(h => st.tahminler.indexOf(h) === -1);
  if (!havuz.length) return { tur: 'tahmin', sonuc: eliBitir(st, false) };
  const h = havuz[Math.floor(r() * havuz.length)];
  return { tur: 'tahmin', harf: h, sonuc: harfiIsle(st, h, true) };
}

function harfiIsle(st, h, otomatik) {
  st.tahminler.push(h);
  const dogru = harfler(st.kelime).indexOf(h) !== -1;
  if (dogru) {
    st.dogruHarfler.push(h);
    if (cozulduMu(st)) {
      return { ok: true, harf: h, dogru: true, otomatik: !!otomatik, bitti: true,
               el: eliBitir(st, true) };
    }
    return { ok: true, harf: h, dogru: true, otomatik: !!otomatik, bitti: false };
  }
  st.yanlis++;
  if (st.yanlis >= st.maxYanlis) {
    return { ok: true, harf: h, dogru: false, otomatik: !!otomatik, bitti: true,
             el: eliBitir(st, false) };
  }
  return { ok: true, harf: h, dogru: false, otomatik: !!otomatik, bitti: false };
}

function cozulduMu(st) {
  return harfler(st.kelime).every(h => st.dogruHarfler.indexOf(h) !== -1);
}
/* Açılamayan FARKLI harf sayısı (gizleyenin puan bonusu). */
function acilmayanHarf(st) {
  const benzersiz = [...new Set(harfler(st.kelime))];
  return benzersiz.filter(h => st.dogruHarfler.indexOf(h) === -1).length;
}

/* --------------------------------------------------------------- EL SONU */
function eliBitir(st, tahminciKazandi) {
  const kazanan = tahminciKazandi ? st.tahminci : st.gizleyen;
  const puan = tahminciKazandi
    ? 40 + (st.maxYanlis - st.yanlis) * 10
    : 40 + acilmayanHarf(st) * 5;
  st.skor[kazanan] = (st.skor[kazanan] || 0) + puan;
  st.sonEl = {
    el: st.el, kelime: st.kelime, ipucu: st.ipucu,
    kazanan, tahminciKazandi, puan,
    yanlis: st.yanlis, kalanCan: st.maxYanlis - st.yanlis,
    acilmayan: acilmayanHarf(st),
    gizleyen: st.gizleyen, tahminci: st.tahminci
  };
  if (st.el >= st.elSayisi) {
    macBitir(st, 'finished');
  } else {
    st.el++;
    const g = st.gizleyen;
    st.gizleyen = st.tahminci;
    st.tahminci = g;
    eliHazirla(st);
  }
  return st.sonEl;
}

function macBitir(st, reason) {
  st.status = 'finished';
  st.faz = 'bitti';
  const [a, b] = st.seats;
  const winner = st.skor[a] === st.skor[b] ? null : (st.skor[a] > st.skor[b] ? a : b);
  st.winner = winner;
  st.result = { reason: reason || 'finished', winner, skor: Object.assign({}, st.skor) };
  return st.result;
}

/* Pes etme / masayı terk: karşı koltuk kazanır. */
function pesEt(st, seat) {
  if (st.status !== 'playing') return st.result;
  const rakip = st.seats.find(s => s !== seat);
  st.status = 'finished';
  st.faz = 'bitti';
  st.winner = rakip === undefined ? null : rakip;
  st.result = { reason: 'resign', winner: st.winner, skor: Object.assign({}, st.skor) };
  return st.result;
}

/* ---------------------------------------------------------------- GÖRÜNÜM
 * KELİME SIR'dır: yalnız gizleyen kendi kelimesini görür. Tahminciye ve
 * izleyiciye maske gider; el bittiğinde ya da maç bittiğinde kelime açılır.
 */
function maske(st) {
  if (!st.kelime) return [];
  return harfler(st.kelime).map(h => (st.dogruHarfler.indexOf(h) !== -1 ? h : null));
}

function gorunum(st, seat, ekstra) {
  const benimKelimem = (seat !== null && seat !== undefined && seat === st.gizleyen);
  const acik = st.status !== 'playing';
  return Object.assign({
    kind: 'adamasmaca',
    status: st.status,
    faz: st.faz,
    el: st.el, elSayisi: st.elSayisi,
    seats: st.seats.slice(),
    seat: (seat === null || seat === undefined) ? null : seat,
    gizleyen: st.gizleyen, tahminci: st.tahminci,
    turn: siradaki(st),
    maske: maske(st),
    harfSayisi: harfler(st.kelime).length,
    ipucu: st.ipucu || '',
    tahminler: st.tahminler.slice(),
    yanlis: st.yanlis, maxYanlis: st.maxYanlis,
    kalanCan: st.maxYanlis - st.yanlis,
    skor: Object.assign({}, st.skor),
    /* Kelime yalnız sahibine ya da maç bittiğinde açılır. */
    kelime: (benimKelimem || acik) ? st.kelime : null,
    sonEl: st.sonEl,
    winner: st.winner === undefined ? null : st.winner,
    result: st.result,
    alfabe: HARFLER
  }, ekstra || {});
}

module.exports = {
  HARFLER, EN_AZ_HARF, EN_COK_HARF, VARSAYILAN_CAN, VARSAYILAN_EL,
  temizle, kelimeyiOlc, macBaslat, kelimeSec, kelimeyiSunucuSec,
  harfTahmin, sureDoldu, siradaki, maske, cozulduMu, acilmayanHarf,
  eliBitir, macBitir, pesEt, gorunum
};
