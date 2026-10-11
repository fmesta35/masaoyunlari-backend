'use strict';
/* ============================================================================
 * FARK BULMACA — SAF OYUN MOTORU (sunucu yetkili)
 * ============================================================================
 * İki oyuncuya AYNI sahnenin iki kopyası gösterilir: biri özgün (A), diğerinde
 * 7 nesne değiştirilmiştir (B). Farkları önce bulan eli kazanır.
 *
 * KURALLAR (yerel prototipten alındı)
 *   · Dört sahne var, her birinde 13 farklanabilir nesne; her el bunlardan
 *     7'si TOHUMLA seçilir, böylece iki oyuncu birebir aynı resmi görür.
 *   · El, kısa bir geri sayımın ardından süreli başlar. 7 farkı önce bulan
 *     eli alır; süre dolarsa ÇOK fark bulan kazanır (eşitse el berabere).
 *   · Maç 3 elin 2'sini alanındır.
 *
 * NEYİ GİZLEYEBİLİRİZ, NEYİ GİZLEYEMEYİZ
 *   Farkların hangileri olduğu İSTEMCİYE GİTMEK ZORUNDA: B kopyasını çizen
 *   istemcidir, yani bilgi zaten resmin içinde. Bu oyunun doğasında var.
 *   Gizlenemeyeni gizlemiş gibi yapmak yerine DOĞRULAMAYI sıkı tutuyoruz:
 *     · her tıklama sunucuda ölçülür (nokta gerçekten o farkın alanında mı),
 *     · aynı fark iki kez sayılmaz,
 *     · YANLIŞ tıklamada kısa bir kilit uygulanır. Prototipte ceza yoktu ve
 *       ekrana rastgele tıklayarak farkları süpürmek mümkündü; kilit bunu
 *       pratikte işe yaramaz hale getirir.
 *   Sahne ve tohum da sunucudan gelir; istemci kendi sahnesini seçemez.
 *
 * Bu dosya SAF mantıktır: soket, zamanlayıcı, oda yoktur.
 * ========================================================================= */

const S = require('./js/fark-sahneler.js');

const EL_BASINA_FARK = 7;
const KAZANMA_SAYISI = 2;            // 3 elin 2'si
const GERI_SAYIM_MS = 3000;
const EL_ARASI_MS = 5000;
const YANLIS_KILIT_MS = 1500;
const VARSAYILAN_EL_SN = 90;

function simdi() { return Date.now(); }

/* ------------------------------------------------------------------- MAÇ */
function macBaslat(opts) {
  const o = opts || {};
  const seats = (o.seats || [0, 1]).slice(0, 2);
  const rng = o.rng || Math.random;
  const st = {
    kind: 'fark',
    seats,
    /* Alt sınır yalnız yanlış yapılandırmaya karşı; gerçek masalar
       60/90/120 saniye kullanıyor (bkz. server.js → farkElSuresi). */
    elSuresiSn: Math.max(5, Number(o.elSuresiSn) || VARSAYILAN_EL_SN),
    kazanmaSayisi: KAZANMA_SAYISI,
    el: 0,
    skor: { [seats[0]]: 0, [seats[1]]: 0 },
    /* Sahneler tekrar etmesin diye karıştırılmış bir sıra tutulur. */
    sahneSirasi: karistir([...Array(S.sahneSayisi()).keys()], rng),
    sahneId: null,
    tohum: 0,
    farkIdleri: [],
    bulunan: { [seats[0]]: [], [seats[1]]: [] },
    kilitBitis: { [seats[0]]: 0, [seats[1]]: 0 },
    faz: 'gerisayim',                // gerisayim | oyun | elSonu | bitti
    fazBitis: 0,
    elKazanani: null,
    status: 'playing',
    winner: null,
    result: null,
    _rng: rng
  };
  eliKur(st, simdi());
  return st;
}
function karistir(dizi, rng) {
  for (let i = dizi.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [dizi[i], dizi[j]] = [dizi[j], dizi[i]];
  }
  return dizi;
}

/* Yeni el: sahne ve tohum seç, geri sayımı başlat. */
function eliKur(st, t) {
  st.el += 1;
  st.sahneId = st.sahneSirasi[(st.el - 1) % st.sahneSirasi.length];
  st.tohum = Math.floor(st._rng() * 2147483647) || 1;
  st.farkIdleri = S.farkSec(S.sahneFarkSayisi(st.sahneId), EL_BASINA_FARK, st.tohum);
  st.seats.forEach(s => { st.bulunan[s] = []; st.kilitBitis[s] = 0; });
  st.elKazanani = null;
  st.faz = 'gerisayim';
  st.fazBitis = t + GERI_SAYIM_MS;
}

/* --------------------------------------------------------------- ZAMAN
   Sunucu düzenli çağırır; fazlar burada ilerler. Döner: ne değiştiyse. */
function tik(st, t) {
  if (st.status !== 'playing') return { degisti: false };
  const an = t || simdi();
  if (an < st.fazBitis) return { degisti: false };

  if (st.faz === 'gerisayim') {
    st.faz = 'oyun';
    st.fazBitis = an + st.elSuresiSn * 1000;
    return { degisti: true, olay: 'elBasladi' };
  }
  if (st.faz === 'oyun') {
    /* Süre doldu: çok bulan eli alır, eşitse el berabere. */
    return eliBitir(st, an, null);
  }
  if (st.faz === 'elSonu') {
    if (bittiMi(st)) { macBitir(st, 'finished'); return { degisti: true, olay: 'macBitti' }; }
    eliKur(st, an);
    return { degisti: true, olay: 'yeniEl' };
  }
  return { degisti: false };
}

function bittiMi(st) {
  return st.seats.some(s => st.skor[s] >= st.kazanmaSayisi);
}

/* --------------------------------------------------------------- TIKLAMA */
function tikla(st, seat, x, y, t) {
  const an = t || simdi();
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (st.seats.indexOf(seat) === -1) return { ok: false, reason: 'not_in_room' };
  if (st.faz !== 'oyun') return { ok: false, reason: 'wrong_phase' };
  if (an < (st.kilitBitis[seat] || 0)) {
    return { ok: false, reason: 'tikla_kilitli',
             kalanMs: st.kilitBitis[seat] - an };
  }
  const px = Number(x), py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py) ||
      px < 0 || py < 0 || px > S.GORUNUM_EN || py > S.GORUNUM_BOY) {
    return { ok: false, reason: 'gecersiz_hamle' };
  }
  /* Yalnız BU ELDEKİ farklar sayılır; bulunmuşlar elenir. */
  const kalanlar = st.farkIdleri.filter(id => st.bulunan[seat].indexOf(id) === -1);
  const bulundu = S.farkBul(st.sahneId, px, py, kalanlar);
  if (bulundu === null) {
    /* ZATEN BULUNMUŞ bir farka yeniden dokunmak CEZALANDIRILMAZ: çift
       dokunma ya da işareti gösterme isteği hata sayılmamalı. Ceza yalnız
       gerçekten boş bir yere tıklayana. */
    if (S.farkBul(st.sahneId, px, py, st.bulunan[seat]) !== null) {
      return { ok: true, dogru: false, zaten: true };
    }
    st.kilitBitis[seat] = an + YANLIS_KILIT_MS;
    return { ok: true, dogru: false, kilitMs: YANLIS_KILIT_MS };
  }
  st.bulunan[seat].push(bulundu);
  const tam = st.bulunan[seat].length >= st.farkIdleri.length;
  if (tam) {
    const r = eliBitir(st, an, seat);
    return { ok: true, dogru: true, farkId: bulundu, tamamladi: true, el: r };
  }
  return { ok: true, dogru: true, farkId: bulundu, tamamladi: false,
           kalan: st.farkIdleri.length - st.bulunan[seat].length };
}

/* --------------------------------------------------------------- EL SONU */
function eliBitir(st, t, kazanan) {
  const an = t || simdi();
  if (kazanan === null || kazanan === undefined) {
    const [a, b] = st.seats;
    const na = st.bulunan[a].length, nb = st.bulunan[b].length;
    kazanan = na === nb ? null : (na > nb ? a : b);
  }
  st.elKazanani = kazanan;
  if (kazanan !== null && kazanan !== undefined) st.skor[kazanan] += 1;
  st.faz = 'elSonu';
  st.fazBitis = an + EL_ARASI_MS;
  /* Maç bittiyse ara beklemeye gerek yok: hemen kapat. */
  if (bittiMi(st)) { macBitir(st, 'finished'); return { degisti: true, olay: 'macBitti', kazanan }; }
  return { degisti: true, olay: 'elBitti', kazanan };
}

function macBitir(st, reason) {
  st.status = 'finished';
  st.faz = 'bitti';
  const [a, b] = st.seats;
  const winner = st.skor[a] === st.skor[b] ? null : (st.skor[a] > st.skor[b] ? a : b);
  st.winner = winner;
  st.result = { reason: reason || 'finished', winner, skor: Object.assign({}, st.skor), el: st.el };
  return st.result;
}
function pesEt(st, seat) {
  if (st.status !== 'playing') return st.result;
  const rakip = st.seats.find(s => s !== seat);
  st.status = 'finished';
  st.faz = 'bitti';
  st.winner = rakip === undefined ? null : rakip;
  st.result = { reason: 'resign', winner: st.winner, skor: Object.assign({}, st.skor), el: st.el };
  return st.result;
}

/* --------------------------------------------------------------- GÖRÜNÜM
   Rakibin BULDUĞU farkların kimlikleri gönderilmez — yalnız SAYISI. Yoksa
   oyuncu rakibin ekranından kopya çeker. Sahne ve farklar (resmin kendisi)
   zaten herkese açıktır. */
function gorunum(st, seat, ekstra) {
  const bakan = (seat === 0 || seat === 1) ? seat : null;
  const rakip = bakan === null ? null : st.seats.find(s => s !== bakan);
  const an = simdi();
  return Object.assign({
    kind: 'fark',
    status: st.status,
    faz: st.faz,
    kalanMs: Math.max(0, st.fazBitis - an),
    el: st.el, kazanmaSayisi: st.kazanmaSayisi,
    seats: st.seats.slice(),
    seat: bakan,
    sahneId: st.sahneId,
    sahneAdi: (S.SAHNE_BILGI[st.sahneId] || {}).ad || '',
    sahneAlt: (S.SAHNE_BILGI[st.sahneId] || {}).alt || '',
    tohum: st.tohum,
    farkIdleri: st.farkIdleri.slice(),
    toplamFark: st.farkIdleri.length,
    /* Kendi bulduklarım: kimlikleriyle (ekranda işaretlemek için). */
    bulunan: bakan === null ? [] : st.bulunan[bakan].slice(),
    /* Rakibinki: yalnız SAYI. */
    rakipBulunan: rakip === null || rakip === undefined ? 0 : st.bulunan[rakip].length,
    bulunanSayilari: st.seats.reduce((a, s) => { a[s] = st.bulunan[s].length; return a; }, {}),
    kilitKalanMs: bakan === null ? 0 : Math.max(0, (st.kilitBitis[bakan] || 0) - an),
    skor: Object.assign({}, st.skor),
    elKazanani: st.elKazanani,
    /* El bitince farkların adları açıklanır (özet şeridi). */
    farkAdlari: (st.faz === 'elSonu' || st.status !== 'playing')
      ? st.farkIdleri.map(id => {
          const d = (S.FARK_KONUMLARI[st.sahneId] || []).find(x => x.id === id);
          return { id, ad: d ? d.ad : '', cx: d ? d.cx : 0, cy: d ? d.cy : 0, r: d ? d.r : 0 };
        })
      : null,
    winner: st.winner,
    result: st.result
  }, ekstra || {});
}

module.exports = {
  EL_BASINA_FARK, KAZANMA_SAYISI, GERI_SAYIM_MS, EL_ARASI_MS,
  YANLIS_KILIT_MS, VARSAYILAN_EL_SN,
  macBaslat, tik, tikla, eliBitir, macBitir, pesEt, gorunum, bittiMi,
  sahneler: S
};
